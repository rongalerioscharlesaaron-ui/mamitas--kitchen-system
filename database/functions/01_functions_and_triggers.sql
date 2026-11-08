-- =====================================================================
-- Business rules enforced by the database
-- =====================================================================

-- Rule: batches of perishable ingredients need an expiry date, batches of
-- non-perishable ingredients must not have one, and foods/trays are whole numbers.
CREATE OR REPLACE FUNCTION fn_check_batch_rules() RETURNS trigger AS $$
DECLARE
    it items%ROWTYPE;
BEGIN
    SELECT * INTO it FROM items WHERE id = NEW.item_id;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    IF it.item_type = 'ingredient' THEN
        IF it.has_expiry AND NEW.expiry_date IS NULL THEN
            RAISE EXCEPTION 'Batch of "%" needs an expiry date', it.name
                USING ERRCODE = '23514';
        ELSIF NOT it.has_expiry AND NEW.expiry_date IS NOT NULL THEN
            RAISE EXCEPTION '"%" has no expiry date, so a batch cannot have one', it.name
                USING ERRCODE = '23514';
        END IF;
    ELSE
        IF NEW.qty_received <> trunc(NEW.qty_received)
           OR NEW.qty_remaining <> trunc(NEW.qty_remaining) THEN
            RAISE EXCEPTION 'Quantity of "%" must be a whole number of %', it.name, it.unit
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER batches_rules
    BEFORE INSERT OR UPDATE OF item_id, qty_received, qty_remaining, expiry_date
    ON inventory_batches
    FOR EACH ROW EXECUTE FUNCTION fn_check_batch_rules();

-- Rule: the movement history and the activity log can never be edited or deleted.
CREATE OR REPLACE FUNCTION fn_block_changes() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
        USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stock_movements_append_only
    BEFORE UPDATE OR DELETE ON stock_movements
    FOR EACH ROW EXECUTE FUNCTION fn_block_changes();

CREATE TRIGGER audit_log_append_only
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION fn_block_changes();

-- Gapless order numbers (0001, 0002, ...). The counter row is locked until the
-- transaction ends, and a rollback also undoes the increment, so no number is skipped.
CREATE OR REPLACE FUNCTION fn_next_order_number() RETURNS TEXT AS $$
DECLARE
    n INTEGER;
BEGIN
    UPDATE counters SET last_value = last_value + 1
    WHERE name = 'order_number'
    RETURNING last_value INTO n;
    RETURN lpad(n::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

ALTER TABLE orders ALTER COLUMN order_number SET DEFAULT fn_next_order_number();

-- Takes stock for a sale, oldest batch first (FIFO). Expired batches are skipped.
-- Locks the batches it touches, and raises an error if there is not enough stock.
-- Call it inside the order's transaction so everything rolls back together.
CREATE OR REPLACE FUNCTION fn_consume_stock(
    p_item_id  INTEGER,
    p_qty      NUMERIC,
    p_order_id INTEGER,
    p_user_id  INTEGER,
    p_reason   TEXT
) RETURNS VOID AS $$
DECLARE
    v_remaining NUMERIC := p_qty;
    v_take      NUMERIC;
    v_name      TEXT;
    b           RECORD;
BEGIN
    IF p_qty IS NULL OR p_qty <= 0 THEN
        RAISE EXCEPTION 'Quantity must be greater than 0';
    END IF;

    FOR b IN
        SELECT id, qty_remaining
        FROM inventory_batches
        WHERE item_id = p_item_id
          AND qty_remaining > 0
          AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
        ORDER BY received_date, id
        FOR UPDATE
    LOOP
        EXIT WHEN v_remaining <= 0;
        v_take := LEAST(b.qty_remaining, v_remaining);

        UPDATE inventory_batches
        SET qty_remaining = qty_remaining - v_take
        WHERE id = b.id;

        INSERT INTO stock_movements (item_id, batch_id, movement_type, qty, reason, order_id, user_id)
        VALUES (p_item_id, b.id, 'USED', v_take, p_reason, p_order_id, p_user_id);

        v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining > 0 THEN
        SELECT name INTO v_name FROM items WHERE id = p_item_id;
        RAISE EXCEPTION 'Not enough % in stock (short by %)', v_name, v_remaining;
    END IF;
END;
$$ LANGUAGE plpgsql;