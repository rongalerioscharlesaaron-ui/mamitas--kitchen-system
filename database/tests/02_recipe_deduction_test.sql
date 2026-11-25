-- Tests for recipe deduction (migration 007). Nothing is saved: every test is rolled back.
--
-- Needs the REAL data and a user named 'kitchen':
--   03_real_menu_and_ingredients.sql, 05_opening_stock.sql, 06_recipes.sql
-- (the numbers below come from the opening stock: e.g. 7.5 kg Pork Pata, 12 servings of Kare-Kare)
--
--   psql -U postgres -h localhost -d mamitas_kitchen -f database/tests/02_recipe_deduction_test.sql
--
-- Every line should say PASS.
\set ON_ERROR_STOP off
\set QUIET on
SET client_min_messages = notice;

CREATE FUNCTION pg_temp.check(p_name TEXT, p_ok BOOLEAN, p_detail TEXT DEFAULT '') RETURNS VOID AS $$
BEGIN
    IF p_ok THEN RAISE NOTICE 'PASS  %', p_name;
    ELSE RAISE NOTICE 'FAIL  %   (%)', p_name, p_detail;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Stock of an item that can be used today, by name
CREATE FUNCTION pg_temp.usable(p_name TEXT) RETURNS NUMERIC AS $$
    SELECT fn_usable_qty((SELECT id FROM items WHERE name = p_name));
$$ LANGUAGE sql;

-- Did running this SQL raise an error whose message contains the text?
CREATE FUNCTION pg_temp.raises(p_sql TEXT, p_needle TEXT) RETURNS BOOLEAN AS $$
BEGIN
    EXECUTE p_sql;
    RETURN FALSE;
EXCEPTION WHEN OTHERS THEN
    RETURN position(p_needle IN SQLERRM) > 0;
END;
$$ LANGUAGE plpgsql;

\echo '--- 1. Add 2 trays of Kare-Kare: every ingredient comes off x2, servings go up by 20 ---'
BEGIN;
DO $$
DECLARE
    v_kitchen  INTEGER := (SELECT id FROM users WHERE username = 'kitchen');
    v_dish     INTEGER := (SELECT id FROM items WHERE name = 'Kare-Kare (Pork Pata)');
    v_dish_was NUMERIC := pg_temp.usable('Kare-Kare (Pork Pata)');
    v_moves    BIGINT  := (SELECT COUNT(*) FROM stock_movements);
    v_result   JSONB;
    r          RECORD;
BEGIN
    CREATE TEMP TABLE before_stock ON COMMIT DROP AS
        SELECT i.name, fn_usable_qty(i.id) AS qty FROM items i WHERE i.item_type = 'ingredient';

    v_result := fn_add_menu_trays(v_dish, 2, v_kitchen);

    PERFORM pg_temp.check('Kare-Kare servings go up by 20 (2 trays x 10)',
        pg_temp.usable('Kare-Kare (Pork Pata)') = v_dish_was + 20,
        format('was %s, now %s', v_dish_was, pg_temp.usable('Kare-Kare (Pork Pata)')));
    PERFORM pg_temp.check('The result reports 2 trays, 20 servings, a recipe, and 11 ingredients used',
        (v_result->>'trays')::INT = 2 AND (v_result->>'servings')::INT = 20
        AND (v_result->>'hasRecipe')::BOOLEAN AND jsonb_array_length(v_result->'used') = 11,
        v_result::TEXT);

    FOR r IN SELECT * FROM (VALUES
            ('Pork Pata', 3.0), ('Eggplant', 0.6), ('Sitaw (String Beans)', 4.0), ('Pechay', 2.0),
            ('Banana Blossom', 2.0), ('Peanut Butter', 0.5), ('Bagoong Alamang', 0.3),
            ('Annatto (Atsuete)', 0.03), ('Garlic', 0.08), ('Onion', 0.2), ('Salt', 0.02)
         ) AS e(name, delta)
    LOOP
        PERFORM pg_temp.check(format('%s goes down by %s', r.name, r.delta),
            (SELECT qty FROM before_stock WHERE name = r.name) - pg_temp.usable(r.name) = r.delta,
            format('was %s, now %s', (SELECT qty FROM before_stock WHERE name = r.name), pg_temp.usable(r.name)));
    END LOOP;

    PERFORM pg_temp.check('Exactly those 11 ingredients changed, no others',
        (SELECT COUNT(*) FROM before_stock b WHERE pg_temp.usable(b.name) <> b.qty) = 11);

    PERFORM pg_temp.check('The log has 11 USED rows (no order) and 1 IN row of 20 servings',
        (SELECT COUNT(*) FROM stock_movements WHERE id > 0 AND movement_type = 'USED' AND order_id IS NULL
            AND reason = 'Cooked 2 trays of Kare-Kare (Pork Pata)' AND user_id = v_kitchen) = 11
        AND (SELECT COUNT(*) FROM stock_movements WHERE item_id = v_dish AND movement_type = 'IN'
            AND qty = 20 AND reason = '2 trays cooked (20 servings)') = 1
        AND (SELECT COUNT(*) FROM stock_movements) = v_moves + 12);

    PERFORM pg_temp.check('The new servings batch expires today',
        (SELECT expiry_date = received_date FROM inventory_batches WHERE id = (v_result->>'batchId')::INT));
END
$$;
ROLLBACK;

\echo '--- 2. FIFO: an older batch (received yesterday) is used up before the batch received today ---'
BEGIN;
DO $$
DECLARE
    v_kitchen INTEGER := (SELECT id FROM users WHERE username = 'kitchen');
    v_pata    INTEGER := (SELECT id FROM items WHERE name = 'Pork Pata');
    v_old     INTEGER;
    v_new     INTEGER;
    v_open    INTEGER;
BEGIN
    -- the opening batch (7.5 kg, received today) already exists. Add one received yesterday and one today.
    INSERT INTO inventory_batches (item_id, qty_received, qty_remaining, received_date, expiry_date)
    VALUES (v_pata, 1, 1, CURRENT_DATE - 1, CURRENT_DATE + 3) RETURNING id INTO v_old;
    INSERT INTO inventory_batches (item_id, qty_received, qty_remaining, received_date, expiry_date)
    VALUES (v_pata, 5, 5, CURRENT_DATE, CURRENT_DATE + 4) RETURNING id INTO v_new;
    SELECT id INTO v_open FROM inventory_batches WHERE item_id = v_pata AND id NOT IN (v_old, v_new);

    -- 3 trays of Kare-Kare need 4.5 kg Pork Pata: 1 from yesterday's batch, 3.5 from the opening batch
    PERFORM fn_add_menu_trays((SELECT id FROM items WHERE name = 'Kare-Kare (Pork Pata)'), 3, v_kitchen);

    PERFORM pg_temp.check('Yesterday''s batch is emptied first (1 kg -> 0)',
        (SELECT qty_remaining FROM inventory_batches WHERE id = v_old) = 0);
    PERFORM pg_temp.check('Then the opening batch (7.5 kg -> 4)',
        (SELECT qty_remaining FROM inventory_batches WHERE id = v_open) = 4);
    PERFORM pg_temp.check('The newest batch is untouched (5 kg)',
        (SELECT qty_remaining FROM inventory_batches WHERE id = v_new) = 5);
    PERFORM pg_temp.check('The log shows 1 kg from the old batch, then 3.5 kg from the opening batch',
        (SELECT string_agg(batch_id::TEXT || ':' || qty::TEXT, ' ' ORDER BY id)
           FROM stock_movements WHERE item_id = v_pata AND movement_type = 'USED')
        = v_old::TEXT || ':1.000 ' || v_open::TEXT || ':3.500');
END
$$;
ROLLBACK;

\echo '--- 3. FIFO on the same day: the batch added first is used first ---'
BEGIN;
DO $$
DECLARE
    v_kitchen INTEGER := (SELECT id FROM users WHERE username = 'kitchen');
    v_belly   INTEGER := (SELECT id FROM items WHERE name = 'Pork Belly');
    v_open    INTEGER;
    v_new     INTEGER;
BEGIN
    SELECT id INTO v_open FROM inventory_batches WHERE item_id = v_belly;
    INSERT INTO inventory_batches (item_id, qty_received, qty_remaining, received_date, expiry_date)
    VALUES (v_belly, 5, 5, CURRENT_DATE, CURRENT_DATE + 4) RETURNING id INTO v_new;

    -- 6 trays of Lechon Kawali need 9 kg Pork Belly: all 7.5 kg of the first batch, then 1.5 kg
    PERFORM fn_add_menu_trays((SELECT id FROM items WHERE name = 'Lechon Kawali'), 6, v_kitchen);

    PERFORM pg_temp.check('The first batch is used up (7.5 -> 0)',
        (SELECT qty_remaining FROM inventory_batches WHERE id = v_open) = 0);
    PERFORM pg_temp.check('The second batch gives the rest (5 -> 3.5)',
        (SELECT qty_remaining FROM inventory_batches WHERE id = v_new) = 3.5);
END
$$;
ROLLBACK;

\echo '--- 4. Not enough stock: ONE error listing every shortage, and nothing changes ---'
BEGIN;
DO $$
DECLARE
    v_kitchen  INTEGER := (SELECT id FROM users WHERE username = 'kitchen');
    v_dish     INTEGER := (SELECT id FROM items WHERE name = 'Kare-Kare (Pork Pata)');
    v_dish_was NUMERIC := pg_temp.usable('Kare-Kare (Pork Pata)');
    v_moves    BIGINT  := (SELECT COUNT(*) FROM stock_movements);
    v_batches  BIGINT  := (SELECT COUNT(*) FROM inventory_batches);
    v_sum_was  NUMERIC := (SELECT SUM(qty_remaining) FROM inventory_batches);
    v_msg      TEXT;
BEGIN
    BEGIN
        PERFORM fn_add_menu_trays(v_dish, 10, v_kitchen);   -- needs 15 kg Pork Pata, only 7.5 kg
        v_msg := 'NO ERROR';
    EXCEPTION WHEN OTHERS THEN
        v_msg := SQLERRM;
    END;

    PERFORM pg_temp.check('10 trays is refused', v_msg <> 'NO ERROR', v_msg);
    PERFORM pg_temp.check('The message names Pork Pata with the amount needed and what is there',
        position('Pork Pata needs 15 kg, only 7.5 kg available' IN v_msg) > 0, v_msg);
    PERFORM pg_temp.check('...and the other short ingredients too (Sitaw, Pechay, Banana Blossom)',
        position('Sitaw (String Beans) needs 20 bunch, only 9 bunch available' IN v_msg) > 0
        AND position('Pechay needs 10 bunch, only 6 bunch available' IN v_msg) > 0
        AND position('Banana Blossom needs 10 pcs, only 3 pcs available' IN v_msg) > 0, v_msg);
    PERFORM pg_temp.check('...but not an ingredient that is fine (Eggplant)',
        position('Eggplant' IN v_msg) = 0, v_msg);
    PERFORM pg_temp.check('Nothing was saved: no servings, no batch, no log rows, no stock taken',
        pg_temp.usable('Kare-Kare (Pork Pata)') = v_dish_was
        AND (SELECT COUNT(*) FROM stock_movements) = v_moves
        AND (SELECT COUNT(*) FROM inventory_batches) = v_batches
        AND (SELECT SUM(qty_remaining) FROM inventory_batches) = v_sum_was);
END
$$;
ROLLBACK;

\echo '--- 5. "Or" choices (Chop Suey: Pork OR Chicken, 0.5 kg per tray) ---'
BEGIN;
DO $$
DECLARE
    v_kitchen INTEGER := (SELECT id FROM users WHERE username = 'kitchen');
    v_dish    INTEGER := (SELECT id FROM items WHERE name = 'Chop Suey');
    v_pork    NUMERIC;
    v_chicken NUMERIC;
    v_shrimp  NUMERIC := pg_temp.usable('Shrimp');
    v_msg     TEXT;
BEGIN
    v_pork := pg_temp.usable('Pork');
    v_chicken := pg_temp.usable('Chicken');

    PERFORM fn_add_menu_trays(v_dish, 1, v_kitchen);
    PERFORM pg_temp.check('The first choice (Pork) is used when it has enough: 0.5 kg off',
        v_pork - pg_temp.usable('Pork') = 0.5);
    PERFORM pg_temp.check('Chicken is not touched', pg_temp.usable('Chicken') = v_chicken);
    PERFORM pg_temp.check('Shrimp is optional in the recipe, so it is NOT taken',
        pg_temp.usable('Shrimp') = v_shrimp);

    -- run out of Pork: the next choice takes over
    UPDATE inventory_batches SET qty_remaining = 0 WHERE item_id = (SELECT id FROM items WHERE name = 'Pork');
    PERFORM fn_add_menu_trays(v_dish, 1, v_kitchen);
    PERFORM pg_temp.check('With no Pork left, Chicken is used instead: 0.5 kg off',
        v_chicken - pg_temp.usable('Chicken') = 0.5);

    -- run out of both
    UPDATE inventory_batches SET qty_remaining = 0 WHERE item_id = (SELECT id FROM items WHERE name = 'Chicken');
    BEGIN
        PERFORM fn_add_menu_trays(v_dish, 1, v_kitchen);
        v_msg := 'NO ERROR';
    EXCEPTION WHEN OTHERS THEN
        v_msg := SQLERRM;
    END;
    PERFORM pg_temp.check('With neither, the error lists both choices',
        position('none of these has enough' IN v_msg) > 0 AND position('Pork needs 0.5 kg' IN v_msg) > 0
        AND position('Chicken needs 0.5 kg' IN v_msg) > 0, v_msg);
END
$$;
ROLLBACK;

\echo '--- 6. Expired ingredient batches do not count ---'
BEGIN;
DO $$
DECLARE
    v_kitchen INTEGER := (SELECT id FROM users WHERE username = 'kitchen');
    v_msg     TEXT;
BEGIN
    UPDATE inventory_batches SET received_date = CURRENT_DATE - 5, expiry_date = CURRENT_DATE - 1
     WHERE item_id = (SELECT id FROM items WHERE name = 'Garlic');
    BEGIN
        PERFORM fn_add_menu_trays((SELECT id FROM items WHERE name = 'Kare-Kare (Pork Pata)'), 1, v_kitchen);
        v_msg := 'NO ERROR';
    EXCEPTION WHEN OTHERS THEN
        v_msg := SQLERRM;
    END;
    PERFORM pg_temp.check('Expired Garlic cannot be used: "Garlic needs 0.04 kg, only 0 kg available"',
        position('Garlic needs 0.04 kg, only 0 kg available' IN v_msg) > 0, v_msg);
END
$$;
ROLLBACK;

\echo '--- 7. A dish with no recipe still gets its servings, and nothing is taken ---'
BEGIN;
DO $$
DECLARE
    v_kitchen INTEGER := (SELECT id FROM users WHERE username = 'kitchen');
    v_dish    INTEGER;
    v_used    BIGINT  := (SELECT COUNT(*) FROM stock_movements WHERE movement_type = 'USED');
    v_result  JSONB;
BEGIN
    INSERT INTO items (name, item_type, category_id, unit, price)
    SELECT 'Test Dish Without Recipe', 'food', id, 'servings', 5 FROM categories WHERE name = 'Main dishes'
    RETURNING id INTO v_dish;

    v_result := fn_add_menu_trays(v_dish, 2, v_kitchen);
    PERFORM pg_temp.check('20 servings are added', pg_temp.usable('Test Dish Without Recipe') = 20, v_result::TEXT);
    PERFORM pg_temp.check('hasRecipe is false and nothing was listed as used',
        NOT (v_result->>'hasRecipe')::BOOLEAN AND jsonb_array_length(v_result->'used') = 0, v_result::TEXT);
    PERFORM pg_temp.check('No ingredient was taken',
        (SELECT COUNT(*) FROM stock_movements WHERE movement_type = 'USED') = v_used);
END
$$;
ROLLBACK;

\echo '--- 8. Bad input is refused ---'
BEGIN;
INSERT INTO items (name, item_type, category_id, unit, price)
SELECT 'Test Tray', 'food_tray', id, 'trays', 30 FROM categories WHERE name = 'Food trays';
DO $$
DECLARE
    v_kitchen INTEGER := (SELECT id FROM users WHERE username = 'kitchen');
    v_dish    INTEGER := (SELECT id FROM items WHERE name = 'Kare-Kare (Pork Pata)');
BEGIN
    PERFORM pg_temp.check('0 trays is refused',
        pg_temp.raises(format('SELECT fn_add_menu_trays(%s, 0, %s)', v_dish, v_kitchen), 'Trays must be'));
    PERFORM pg_temp.check('Negative trays are refused',
        pg_temp.raises(format('SELECT fn_add_menu_trays(%s, -2, %s)', v_dish, v_kitchen), 'Trays must be'));
    PERFORM pg_temp.check('Empty trays are refused',
        pg_temp.raises(format('SELECT fn_add_menu_trays(%s, NULL, %s)', v_dish, v_kitchen), 'Trays must be'));
    PERFORM pg_temp.check('An unknown item is refused',
        pg_temp.raises(format('SELECT fn_add_menu_trays(999999, 1, %s)', v_kitchen), 'Item not found'));
    PERFORM pg_temp.check('An ingredient is refused',
        pg_temp.raises(format('SELECT fn_add_menu_trays(%s, 1, %s)',
            (SELECT id FROM items WHERE name = 'Garlic'), v_kitchen), 'not a dish sold per serving'));
    PERFORM pg_temp.check('A food tray (sold per tray) is refused',
        pg_temp.raises(format('SELECT fn_add_menu_trays(%s, 1, %s)',
            (SELECT id FROM items WHERE name = 'Test Tray'), v_kitchen), 'not a dish sold per serving'));
    PERFORM pg_temp.check('A recipe cannot list a dish as an ingredient',
        pg_temp.raises(format('INSERT INTO recipe_ingredients (menu_item_id, ingredient_item_id, qty_per_tray) VALUES (%s, %s, 1)',
            v_dish, (SELECT id FROM items WHERE name = 'Binagoongan')), 'only list ingredients'));
    PERFORM pg_temp.check('A recipe cannot belong to an ingredient',
        pg_temp.raises(format('INSERT INTO recipe_ingredients (menu_item_id, ingredient_item_id, qty_per_tray) VALUES (%s, %s, 1)',
            (SELECT id FROM items WHERE name = 'Salt'), (SELECT id FROM items WHERE name = 'Garlic')), 'belong to a food'));
    PERFORM pg_temp.check('The same ingredient cannot be listed twice in one recipe',
        pg_temp.raises(format('INSERT INTO recipe_ingredients (menu_item_id, ingredient_item_id, qty_per_tray) VALUES (%s, %s, 1)',
            v_dish, (SELECT id FROM items WHERE name = 'Garlic')), 'recipe_one_line_per_ingredient'));
END
$$;
ROLLBACK;

\echo '--- 9. The app user (mk_app) can add trays but cannot edit recipes ---'
\echo '    (run this file as a user who can SET ROLE mk_app; skip if the role does not exist)'
BEGIN;
SET LOCAL ROLE mk_app;
\echo 'Should print 10 (servings added as mk_app):'
SELECT (fn_add_menu_trays((SELECT id FROM items WHERE name = 'Kare-Kare (Pork Pata)'), 1,
                          (SELECT id FROM users WHERE username = 'kitchen')))->>'servings' AS servings_added;
\echo 'Should FAIL with permission denied:'
UPDATE recipe_ingredients SET qty_per_tray = 99;
ROLLBACK;

\echo '--- Done: every line above should say PASS ---'
