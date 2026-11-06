-- Every test here is expected to FAIL or to be rolled back. Nothing is saved.
\set ON_ERROR_STOP off

\echo '--- 1. Garlic batch without an expiry date (should FAIL) ---'
BEGIN;
INSERT INTO inventory_batches (item_id, qty_received, qty_remaining)
SELECT id, 1, 1 FROM items WHERE name = 'Garlic';
ROLLBACK;

\echo '--- 2. Rice batch with an expiry date (should FAIL) ---'
BEGIN;
INSERT INTO inventory_batches (item_id, qty_received, qty_remaining, expiry_date)
SELECT id, 1, 1, CURRENT_DATE + 30 FROM items WHERE name = 'Rice';
ROLLBACK;

\echo '--- 3. 2.5 servings of Chicken Adobo (should FAIL) ---'
BEGIN;
INSERT INTO inventory_batches (item_id, qty_received, qty_remaining)
SELECT id, 2.5, 2.5 FROM items WHERE name = 'Chicken Adobo';
ROLLBACK;

\echo '--- 4. Negative stock (should FAIL) ---'
BEGIN;
UPDATE inventory_batches SET qty_remaining = -1 WHERE batch_code = 'B-0001';
ROLLBACK;

\echo '--- 5. Editing the movement history (should FAIL) ---'
BEGIN;
UPDATE stock_movements SET qty = 99 WHERE id = (SELECT MIN(id) FROM stock_movements);
ROLLBACK;

\echo '--- 6. Ingredient with a price (should FAIL) ---'
BEGIN;
INSERT INTO items (name, item_type, category_id, unit, price)
SELECT 'Test Item', 'ingredient', id, 'kg', 5 FROM categories WHERE name = 'Meat';
ROLLBACK;

\echo '--- 7. Food placed in the Meat category (should FAIL) ---'
BEGIN;
INSERT INTO items (name, item_type, category_id, unit, price)
SELECT 'Bad Food', 'food', id, 'servings', 5 FROM categories WHERE name = 'Meat';
ROLLBACK;

\echo '--- 8. FIFO: take 3 kg of Chicken Thigh. B-0003 should drop to 3, expired B-0004 stays 2 ---'
BEGIN;
SELECT fn_consume_stock(
    (SELECT id FROM items WHERE name = 'Chicken Thigh'), 3, NULL,
    (SELECT id FROM users WHERE username = 'kitchen'), 'Test');
SELECT batch_code, qty_remaining FROM inventory_batches
WHERE item_id = (SELECT id FROM items WHERE name = 'Chicken Thigh') ORDER BY batch_code;
ROLLBACK;

\echo '--- 9. Selling 30 Chicken Adobo when only 24 exist (should FAIL: short by 6) ---'
BEGIN;
SELECT fn_consume_stock(
    (SELECT id FROM items WHERE name = 'Chicken Adobo'), 30, NULL,
    (SELECT id FROM users WHERE username = 'kitchen'), 'Test');
ROLLBACK;

\echo '--- Done ---'