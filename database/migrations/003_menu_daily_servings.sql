-- Foods and food trays are freshly cooked for the day: no expiry date is entered for them.
-- A menu batch always expires on the day it is received (good until the end of that day).
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
        NEW.expiry_date := NEW.received_date;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS batches_rules ON inventory_batches;
CREATE TRIGGER batches_rules
    BEFORE INSERT OR UPDATE OF item_id, qty_received, qty_remaining, received_date, expiry_date
    ON inventory_batches
    FOR EACH ROW EXECUTE FUNCTION fn_check_batch_rules();

-- Batches that already exist follow the same rule
UPDATE inventory_batches b
   SET expiry_date = b.received_date
  FROM items i
 WHERE i.id = b.item_id
   AND i.item_type <> 'ingredient'
   AND b.expiry_date IS DISTINCT FROM b.received_date;