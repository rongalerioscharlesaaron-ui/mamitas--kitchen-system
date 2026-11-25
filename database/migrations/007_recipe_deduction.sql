-- =====================================================================
-- 007: recipes, and cooking by the tray
--
-- A dish is cooked and added to the menu by the TRAY: 1 tray = servings_per_tray servings (10).
-- Adding trays of a dish takes the ingredients of its recipe out of inventory, oldest batch
-- first (FIFO), in the same transaction. If any ingredient is short, nothing is saved.
--
-- Safe to run more than once. On an existing database run it on its own, then load the recipes
-- with database/seeds/06_recipes.sql:
--   psql -U postgres -h localhost -d mamitas_kitchen -v ON_ERROR_STOP=1 -1 \
--        -f database/migrations/007_recipe_deduction.sql
-- =====================================================================

-- ---------- Servings per tray (used by foods only) ----------
ALTER TABLE items ADD COLUMN IF NOT EXISTS servings_per_tray SMALLINT NOT NULL DEFAULT 10;
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_servings_per_tray_positive;
ALTER TABLE items ADD CONSTRAINT items_servings_per_tray_positive CHECK (servings_per_tray > 0);

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
       i.servings_per_tray
FROM items i
JOIN categories c ON c.id = i.category_id
LEFT JOIN inventory_batches b ON b.item_id = i.id
WHERE i.is_active
GROUP BY i.id, c.name;

-- ---------- Recipes: what one tray of a dish uses ----------
-- is_optional: listed in the recipe but not always used. It is NOT taken from inventory.
-- alt_group / alt_rank: lines that share an alt_group are "this OR that" choices. The first choice
-- that has enough stock is used (alt_rank 1 is tried first).
CREATE TABLE IF NOT EXISTS recipe_ingredients (
    id                  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    menu_item_id        INTEGER       NOT NULL REFERENCES items (id),
    ingredient_item_id  INTEGER       NOT NULL REFERENCES items (id),
    qty_per_tray        NUMERIC(12,3) NOT NULL CHECK (qty_per_tray > 0),
    is_optional         BOOLEAN       NOT NULL DEFAULT FALSE,
    alt_group           SMALLINT,
    alt_rank            SMALLINT,
    CONSTRAINT recipe_one_line_per_ingredient UNIQUE (menu_item_id, ingredient_item_id),
    CONSTRAINT recipe_alt_columns_together CHECK ((alt_group IS NULL) = (alt_rank IS NULL)),
    CONSTRAINT recipe_alt_rank_unique UNIQUE (menu_item_id, alt_group, alt_rank)
);

-- A recipe belongs to a food (sold per serving) and lists only ingredients
CREATE OR REPLACE FUNCTION fn_check_recipe_rules() RETURNS trigger AS $$
DECLARE
    menu_type  item_type;
    ingr_type  item_type;
BEGIN
    SELECT item_type INTO menu_type FROM items WHERE id = NEW.menu_item_id;
    SELECT item_type INTO ingr_type FROM items WHERE id = NEW.ingredient_item_id;

    IF menu_type IS DISTINCT FROM 'food' THEN
        RAISE EXCEPTION 'A recipe can only belong to a food (sold per serving)'
            USING ERRCODE = '23514';
    END IF;
    IF ingr_type IS DISTINCT FROM 'ingredient' THEN
        RAISE EXCEPTION 'A recipe can only list ingredients'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS recipe_rules ON recipe_ingredients;
CREATE TRIGGER recipe_rules
    BEFORE INSERT OR UPDATE OF menu_item_id, ingredient_item_id
    ON recipe_ingredients
    FOR EACH ROW EXECUTE FUNCTION fn_check_recipe_rules();

-- ---------- Small helpers ----------
-- 3.000 -> 3, 0.080 -> 0.08 (for readable messages)
CREATE OR REPLACE FUNCTION fn_fmt_qty(p NUMERIC) RETURNS TEXT AS $$
    SELECT CASE WHEN p IS NULL THEN '0'
                WHEN position('.' IN p::text) > 0 THEN rtrim(rtrim(p::text, '0'), '.')
                ELSE p::text END;
$$ LANGUAGE sql IMMUTABLE;

-- Stock of an item that can still be used today (batches that have not expired)
CREATE OR REPLACE FUNCTION fn_usable_qty(p_item_id INTEGER) RETURNS NUMERIC AS $$
    SELECT COALESCE(SUM(qty_remaining), 0)
      FROM inventory_batches
     WHERE item_id = p_item_id
       AND qty_remaining > 0
       AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE);
$$ LANGUAGE sql STABLE;

-- ---------- Add trays of a dish and take its ingredients ----------
-- 1. Works out what the trays need: every required line of the recipe times the number of trays.
--    For an "or" group, the first choice with enough stock is used. Optional lines are skipped.
-- 2. If anything is short it raises ONE error that lists every shortage, and changes nothing.
-- 3. Otherwise takes the ingredients oldest batch first (fn_consume_stock, logged as USED),
--    then adds a batch of servings (trays x servings_per_tray) for today and logs it as IN.
-- A dish with no recipe still gets its servings; hasRecipe is false so the app can say so.
-- Call it inside a transaction so everything rolls back together.
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

-- ---------- Permissions for the app user ----------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mk_app') THEN
        GRANT SELECT ON recipe_ingredients TO mk_app;
        REVOKE EXECUTE ON FUNCTION fn_add_menu_trays(INTEGER, INTEGER, INTEGER, TEXT) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION fn_add_menu_trays(INTEGER, INTEGER, INTEGER, TEXT) TO mk_app;
    END IF;
END
$$;
