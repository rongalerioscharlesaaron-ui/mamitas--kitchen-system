-- Tests for migration 008: enabling / disabling menu items, and deleting users. Nothing is saved:
-- every test is rolled back.
--
-- Needs the REAL data and a user named 'kitchen':
--   03_real_menu_and_ingredients.sql, 05_opening_stock.sql, 06_recipes.sql
--
--   psql -U postgres -h localhost -d mamitas_kitchen -f database/tests/03_user_delete_and_menu_enable_test.sql
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

-- Did running this SQL raise an error whose message contains the text?
CREATE FUNCTION pg_temp.raises(p_sql TEXT, p_needle TEXT) RETURNS BOOLEAN AS $$
BEGIN
    EXECUTE p_sql;
    RETURN FALSE;
EXCEPTION WHEN OTHERS THEN
    RETURN position(p_needle IN SQLERRM) > 0;
END;
$$ LANGUAGE plpgsql;

\echo '--- 1. A menu item is enabled by default, and the stock view shows it ---'
BEGIN;
DO $$
BEGIN
    PERFORM pg_temp.check('Every food and tray starts enabled',
        (SELECT COUNT(*) FROM items WHERE item_type <> 'ingredient' AND NOT is_enabled) = 0);
    PERFORM pg_temp.check('v_item_stock has is_enabled (true for Kare-Kare)',
        (SELECT is_enabled FROM v_item_stock WHERE name = 'Kare-Kare (Pork Pata)'));
    PERFORM pg_temp.check('Ingredients are always enabled in the view',
        (SELECT bool_and(is_enabled) FROM v_item_stock WHERE item_type = 'ingredient'));
END
$$;
ROLLBACK;

\echo '--- 2. Disable: the view shows it, and the stock stays ---'
BEGIN;
DO $$
DECLARE
    v_dish   INTEGER := (SELECT id FROM items WHERE name = 'Kare-Kare (Pork Pata)');
    v_before NUMERIC := (SELECT qty_usable FROM v_item_stock WHERE name = 'Kare-Kare (Pork Pata)');
BEGIN
    UPDATE items SET is_enabled = FALSE WHERE id = v_dish;
    PERFORM pg_temp.check('v_item_stock now says disabled',
        NOT (SELECT is_enabled FROM v_item_stock WHERE item_id = v_dish));
    PERFORM pg_temp.check('The servings already cooked are still there (12)',
        (SELECT qty_usable FROM v_item_stock WHERE item_id = v_dish) = v_before AND v_before = 12);
END
$$;
ROLLBACK;

\echo '--- 3. Adding trays of a disabled dish is refused, and nothing changes; enabling it again works ---'
BEGIN;
DO $$
DECLARE
    v_kitchen INTEGER := (SELECT id FROM users WHERE username = 'kitchen');
    v_dish    INTEGER := (SELECT id FROM items WHERE name = 'Kare-Kare (Pork Pata)');
    v_moves   BIGINT  := (SELECT COUNT(*) FROM stock_movements);
    v_sum     NUMERIC := (SELECT SUM(qty_remaining) FROM inventory_batches);
    v_msg     TEXT;
BEGIN
    UPDATE items SET is_enabled = FALSE WHERE id = v_dish;
    BEGIN
        PERFORM fn_add_menu_trays(v_dish, 1, v_kitchen);
        v_msg := 'NO ERROR';
    EXCEPTION WHEN OTHERS THEN
        v_msg := SQLERRM;
    END;
    PERFORM pg_temp.check('Refused with a clear message',
        position('"Kare-Kare (Pork Pata)" is disabled' IN v_msg) > 0, v_msg);
    PERFORM pg_temp.check('No ingredient was taken, no servings added, nothing logged',
        (SELECT COUNT(*) FROM stock_movements) = v_moves
        AND (SELECT SUM(qty_remaining) FROM inventory_batches) = v_sum);

    UPDATE items SET is_enabled = TRUE WHERE id = v_dish;
    PERFORM fn_add_menu_trays(v_dish, 1, v_kitchen);
    PERFORM pg_temp.check('Enabled again: 1 tray works (12 -> 22 servings)',
        (SELECT qty_usable FROM v_item_stock WHERE item_id = v_dish) = 22);
END
$$;
ROLLBACK;

\echo '--- 4. A disabled item cannot be sold, whatever path the order takes ---'
BEGIN;
DO $$
DECLARE
    v_cashier INTEGER;
    v_session INTEGER;
    v_order   INTEGER;
    v_dish    INTEGER := (SELECT id FROM items WHERE name = 'Kare-Kare (Pork Pata)');
    v_other   INTEGER := (SELECT id FROM items WHERE name = 'Binagoongan');
    v_msg     TEXT;
BEGIN
    INSERT INTO users (username, password_hash, full_name, role)
    VALUES ('test_cashier_008', 'x', 'Test Cashier', 'cashier') RETURNING id INTO v_cashier;
    INSERT INTO cashier_sessions (cashier_id, opening_cash) VALUES (v_cashier, 100) RETURNING id INTO v_session;
    INSERT INTO orders (order_type, total, cashier_id, session_id)
    VALUES ('dine_in', 13, v_cashier, v_session) RETURNING id INTO v_order;

    UPDATE items SET is_enabled = FALSE WHERE id = v_dish;
    BEGIN
        INSERT INTO order_items (order_id, item_id, item_name, unit_price, qty) VALUES (v_order, v_dish, 'Kare-Kare', 13, 1);
        v_msg := 'NO ERROR';
    EXCEPTION WHEN OTHERS THEN
        v_msg := SQLERRM;
    END;
    PERFORM pg_temp.check('An order line for a disabled item is refused',
        position('is disabled and cannot be sold' IN v_msg) > 0, v_msg);

    INSERT INTO order_items (order_id, item_id, item_name, unit_price, qty) VALUES (v_order, v_other, 'Binagoongan', 10.5, 1);
    PERFORM pg_temp.check('An order line for an enabled item still works',
        (SELECT COUNT(*) FROM order_items WHERE order_id = v_order) = 1);

    UPDATE items SET is_enabled = TRUE WHERE id = v_dish;
    INSERT INTO order_items (order_id, item_id, item_name, unit_price, qty) VALUES (v_order, v_dish, 'Kare-Kare', 13, 1);
    PERFORM pg_temp.check('...and the item can be sold again once it is enabled',
        (SELECT COUNT(*) FROM order_items WHERE order_id = v_order) = 2);
END
$$;
ROLLBACK;

\echo '--- 5. Only menu items can be disabled ---'
BEGIN;
DO $$
BEGIN
    PERFORM pg_temp.check('Disabling an ingredient is refused by the database',
        pg_temp.raises(format('UPDATE items SET is_enabled = FALSE WHERE id = %s',
            (SELECT id FROM items WHERE name = 'Garlic')), 'items_enabled_menu_only'));
END
$$;
ROLLBACK;

\echo '--- 6. Deleted users: the username can be used again, but live duplicates are still refused ---'
BEGIN;
DO $$
DECLARE
    v_old INTEGER;
BEGIN
    INSERT INTO users (username, password_hash, full_name, role)
    VALUES ('jane', 'x', 'Jane Old', 'cashier') RETURNING id INTO v_old;

    PERFORM pg_temp.check('Two live users cannot share a username (any letter case)',
        pg_temp.raises($q$INSERT INTO users (username, password_hash, full_name, role) VALUES ('JANE', 'x', 'Jane Dup', 'cashier')$q$,
            'users_username_unique'));

    -- the same statement the app runs when an owner deletes a user
    UPDATE users
       SET deleted_at = now(), is_active = FALSE, session_version = session_version + 1,
           failed_logins = 0, locked_until = NULL
     WHERE id = v_old;

    INSERT INTO users (username, password_hash, full_name, role) VALUES ('jane', 'x', 'Jane New', 'cashier');
    PERFORM pg_temp.check('After deleting the first Jane, the name "jane" can be used again',
        (SELECT COUNT(*) FROM users WHERE lower(username) = 'jane') = 2
        AND (SELECT COUNT(*) FROM users WHERE lower(username) = 'jane' AND deleted_at IS NULL) = 1);

    PERFORM pg_temp.check('The login lookup (username, not deleted) finds only the new Jane',
        (SELECT full_name FROM users WHERE lower(username) = lower('jane') AND deleted_at IS NULL) = 'Jane New');
    PERFORM pg_temp.check('The users list (not deleted) hides the old Jane',
        NOT EXISTS (SELECT 1 FROM users WHERE id = v_old AND deleted_at IS NULL));
    PERFORM pg_temp.check('The old Jane row is still there, so her history keeps its name',
        (SELECT full_name FROM users WHERE id = v_old) = 'Jane Old');
END
$$;
ROLLBACK;

\echo '--- 7. History survives a deleted user (orders and cash sessions still point at the row) ---'
BEGIN;
DO $$
DECLARE
    v_cashier INTEGER;
    v_session INTEGER;
BEGIN
    INSERT INTO users (username, password_hash, full_name, role)
    VALUES ('test_cashier_008', 'x', 'Test Cashier', 'cashier') RETURNING id INTO v_cashier;
    INSERT INTO cashier_sessions (cashier_id, opening_cash) VALUES (v_cashier, 100) RETURNING id INTO v_session;
    INSERT INTO orders (order_type, total, cashier_id, session_id)
    VALUES ('dine_in', 5, v_cashier, v_session);
    UPDATE cashier_sessions SET closed_at = now(), expected_cash = 105, counted_cash = 105, cash_difference = 0
     WHERE id = v_session;

    UPDATE users SET deleted_at = now(), is_active = FALSE WHERE id = v_cashier;

    PERFORM pg_temp.check('The session summary still shows the deleted cashier by name',
        (SELECT cashier FROM v_session_summary WHERE session_id = v_session) = 'Test Cashier');
    PERFORM pg_temp.check('The order is still linked to the deleted cashier',
        (SELECT COUNT(*) FROM orders o JOIN users u ON u.id = o.cashier_id WHERE o.cashier_id = v_cashier AND u.deleted_at IS NOT NULL) = 1);
END
$$;
ROLLBACK;

\echo '--- 8. The app user (mk_app) can switch items and delete-mark users, but still cannot DELETE rows ---'
BEGIN;
SET LOCAL ROLE mk_app;
\echo 'Should print f (disabled as mk_app):'
UPDATE items SET is_enabled = FALSE WHERE name = 'Kare-Kare (Pork Pata)' RETURNING is_enabled;
\echo 'Should print one row (soft delete as mk_app):'
UPDATE users SET deleted_at = now(), is_active = FALSE WHERE username = 'kitchen' RETURNING username, deleted_at IS NOT NULL AS deleted;
\echo 'Should FAIL with permission denied (real DELETE is still not allowed):'
DELETE FROM users WHERE username = 'kitchen';
ROLLBACK;

\echo '--- Done: every line above should say PASS ---'
