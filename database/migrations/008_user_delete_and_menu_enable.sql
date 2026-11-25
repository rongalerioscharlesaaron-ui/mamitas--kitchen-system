-- =====================================================================
-- 008: delete staff users, and enable / disable menu items
--
-- Users:  a deleted user is hidden, cannot sign in, and their username can be used again.
--         The row is kept (soft delete) because orders, cash sessions, stock movements and the
--         activity log all point at it, and the app is never allowed to DELETE rows.
-- Menu:   a disabled food or food tray is hidden from the POS and cannot be sold or cooked.
--         Its stock and history stay as they are. Only the owner can switch it (admin page).
--
-- Needs migration 007 (it adds servings_per_tray to the stock view). Safe to run more than once.
--   psql -U postgres -h localhost -d mamitas_kitchen -v ON_ERROR_STOP=1 -1 \
--        -f database/migrations/008_user_delete_and_menu_enable.sql
-- =====================================================================

-- ---------- Users: soft delete ----------
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- A username is unique only among users that are not deleted, so the name can be reused
DROP INDEX IF EXISTS users_username_unique;
CREATE UNIQUE INDEX users_username_unique ON users (lower(username)) WHERE deleted_at IS NULL;

-- ---------- Menu items: enabled / disabled ----------
ALTER TABLE items ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Ingredients are never on the menu, so they cannot be disabled
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_enabled_menu_only;
ALTER TABLE items ADD CONSTRAINT items_enabled_menu_only CHECK (item_type <> 'ingredient' OR is_enabled);

-- The menu pages read it from this view (new columns can only be added at the end)
CREATE OR REPLACE VIEW v_item_stock AS
SELECT i.id AS item_id,
       i.name,
       i.item_type,
       c.name AS category,
       i.unit,
       i.min_level,
       i.price,
       i.has_expiry,
       COALESCE(SUM(b.qty_remaining), 0) AS qty_on_hand,
       COALESCE(SUM(b.qty_remaining)
                FILTER (WHERE b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE), 0) AS qty_usable,
       COUNT(b.id) FILTER (WHERE b.qty_remaining > 0) AS open_batches,
       MIN(b.expiry_date) FILTER (WHERE b.qty_remaining > 0 AND b.expiry_date IS NOT NULL) AS next_expiry,
       i.servings_per_tray,
       i.is_enabled
FROM items i
JOIN categories c ON c.id = i.category_id
LEFT JOIN inventory_batches b ON b.item_id = i.id
WHERE i.is_active
GROUP BY i.id, c.name;

-- A disabled item cannot be sold, whatever path the order came through
CREATE OR REPLACE FUNCTION fn_require_enabled_item() RETURNS trigger AS $$
DECLARE
    v_name    TEXT;
    v_enabled BOOLEAN;
BEGIN
    SELECT name, is_enabled INTO v_name, v_enabled FROM items WHERE id = NEW.item_id;
    IF FOUND AND NOT v_enabled THEN
        RAISE EXCEPTION '"%" is disabled and cannot be sold', v_name USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS order_items_require_enabled ON order_items;
CREATE TRIGGER order_items_require_enabled
    BEFORE INSERT ON order_items
    FOR EACH ROW EXECUTE FUNCTION fn_require_enabled_item();

-- Adding trays of a disabled dish is refused too (same function as migration 007, plus that check)
CREATE OR REPLACE FUNCTION fn_add_menu_trays(
    p_item_id INTEGER,
    p_trays   INTEGER,
    p_user_id INTEGER,
    p_reason  TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_item        items%ROWTYPE;
    v_servings    INTEGER;
    v_tray_word   TEXT;
    v_plan        JSONB   := '[]'::jsonb;      -- ingredients to take: [{id, name, unit, qty}]
    v_used        JSONB   := '[]'::jsonb;      -- what was really taken
    v_short       TEXT[]  := ARRAY[]::TEXT[];  -- one message per shortage
    v_tried       TEXT[];
    v_picked      BOOLEAN;
    v_have        NUMERIC;
    v_batch_id    INTEGER;
    v_batch_code  TEXT;
    g             RECORD;
    r             RECORD;
BEGIN
    IF p_trays IS NULL OR p_trays < 1 THEN
        RAISE EXCEPTION 'Trays must be a whole number of at least 1';
    END IF;

    SELECT * INTO v_item FROM items WHERE id = p_item_id AND is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Item not found';
    END IF;
    IF v_item.item_type <> 'food' THEN
        RAISE EXCEPTION '"%" is not a dish sold per serving, so it is not added by the tray', v_item.name;
    END IF;
    IF NOT v_item.is_enabled THEN
        RAISE EXCEPTION '"%" is disabled. Ask the owner to enable it before adding trays', v_item.name;
    END IF;

    v_servings  := p_trays * v_item.servings_per_tray;
    v_tray_word := CASE WHEN p_trays = 1 THEN 'tray' ELSE 'trays' END;

    -- Required lines with a single choice
    FOR r IN
        SELECT ri.ingredient_item_id AS id, i.name, i.unit, ri.qty_per_tray * p_trays AS need
          FROM recipe_ingredients ri
          JOIN items i ON i.id = ri.ingredient_item_id
         WHERE ri.menu_item_id = p_item_id
           AND NOT ri.is_optional
           AND ri.alt_group IS NULL
         ORDER BY ri.id
    LOOP
        v_have := fn_usable_qty(r.id);
        IF v_have < r.need THEN
            v_short := v_short || format('%s needs %s %s, only %s %s available',
                                         r.name, fn_fmt_qty(r.need), r.unit, fn_fmt_qty(v_have), r.unit);
        ELSE
            v_plan := v_plan || jsonb_build_object('id', r.id, 'name', r.name, 'unit', r.unit, 'qty', r.need);
        END IF;
    END LOOP;

    -- "This or that" groups: the first choice with enough stock wins
    FOR g IN
        SELECT DISTINCT alt_group
          FROM recipe_ingredients
         WHERE menu_item_id = p_item_id
           AND NOT is_optional
           AND alt_group IS NOT NULL
         ORDER BY alt_group
    LOOP
        v_picked := FALSE;
        v_tried  := ARRAY[]::TEXT[];
        FOR r IN
            SELECT ri.ingredient_item_id AS id, i.name, i.unit, ri.qty_per_tray * p_trays AS need
              FROM recipe_ingredients ri
              JOIN items i ON i.id = ri.ingredient_item_id
             WHERE ri.menu_item_id = p_item_id
               AND NOT ri.is_optional
               AND ri.alt_group = g.alt_group
             ORDER BY ri.alt_rank
        LOOP
            v_have := fn_usable_qty(r.id);
            IF v_have >= r.need THEN
                v_plan   := v_plan || jsonb_build_object('id', r.id, 'name', r.name, 'unit', r.unit, 'qty', r.need);
                v_picked := TRUE;
                EXIT;
            END IF;
            v_tried := v_tried || format('%s needs %s %s, only %s %s available',
                                         r.name, fn_fmt_qty(r.need), r.unit, fn_fmt_qty(v_have), r.unit);
        END LOOP;
        IF NOT v_picked THEN
            v_short := v_short || ('none of these has enough: ' || array_to_string(v_tried, ' / '));
        END IF;
    END LOOP;

    IF cardinality(v_short) > 0 THEN
        RAISE EXCEPTION 'Not enough ingredients for % % of %: %',
            p_trays, v_tray_word, v_item.name, array_to_string(v_short, '; ');
    END IF;

    -- Take the ingredients, oldest batch first. Always in the same order (by item id), so two
    -- cooks at the same moment lock the same batches in the same order and cannot deadlock.
    FOR r IN
        SELECT (e->>'id')::INTEGER AS id, e->>'name' AS name, e->>'unit' AS unit, (e->>'qty')::NUMERIC AS qty
          FROM jsonb_array_elements(v_plan) AS e
         ORDER BY 1
    LOOP
        PERFORM fn_consume_stock(
            r.id, r.qty, NULL, p_user_id,
            format('Cooked %s %s of %s', p_trays, v_tray_word, v_item.name));
        v_used := v_used || jsonb_build_object('name', r.name, 'unit', r.unit, 'qty', r.qty);
    END LOOP;

    -- The servings, available until the end of today (the batch rules set the expiry date)
    INSERT INTO inventory_batches (item_id, qty_received, qty_remaining, created_by)
    VALUES (p_item_id, v_servings, v_servings, p_user_id)
    RETURNING id, batch_code INTO v_batch_id, v_batch_code;

    INSERT INTO stock_movements (item_id, batch_id, movement_type, qty, reason, user_id)
    VALUES (p_item_id, v_batch_id, 'IN', v_servings,
            COALESCE(p_reason, format('%s %s cooked (%s servings)', p_trays, v_tray_word, v_servings)),
            p_user_id);

    RETURN jsonb_build_object(
        'batchId',         v_batch_id,
        'batchCode',       v_batch_code,
        'trays',           p_trays,
        'servings',        v_servings,
        'servingsPerTray', v_item.servings_per_tray,
        'hasRecipe',       jsonb_array_length(v_plan) > 0,
        'used',            v_used
    );
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mk_app') THEN
        GRANT EXECUTE ON FUNCTION fn_add_menu_trays(INTEGER, INTEGER, INTEGER, TEXT) TO mk_app;
    END IF;
END
$$;
