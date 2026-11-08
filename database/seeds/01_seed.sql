-- Sample data for development. DEMO PASSWORDS: replace before any real use.
\set ON_ERROR_STOP on
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- Users (passwords are hashed with bcrypt) ----------
INSERT INTO users (username, password_hash, full_name, role) VALUES
  ('cashier', crypt('cashier123', gen_salt('bf', 10)), 'Cashier',       'cashier'),
  ('kitchen', crypt('kitchen123', gen_salt('bf', 10)), 'Kitchen Staff', 'kitchen'),
  ('owner',   crypt('owner123',   gen_salt('bf', 10)), 'Owner',         'owner');

-- ---------- Categories ----------
INSERT INTO categories (name, kind) VALUES
  ('Wet ingredients', 'ingredient'),
  ('Dry ingredients', 'ingredient'),
  ('Meat',            'ingredient'),
  ('Main dishes',     'food'),
  ('Sides',           'food'),
  ('Desserts',        'food'),
  ('Food trays',      'food_tray');

-- ---------- Items (prices are placeholders) ----------
INSERT INTO items (name, item_type, category_id, unit, min_level, has_expiry, price)
SELECT v.name, v.item_type::item_type, c.id, v.unit, v.min_level, v.has_expiry, v.price::numeric(10,2)
FROM (VALUES
  ('Cooking Oil',       'ingredient', 'Wet ingredients', 'L',        5,  TRUE,  NULL),
  ('Soy Sauce',         'ingredient', 'Wet ingredients', 'L',        3,  TRUE,  NULL),
  ('Vinegar',           'ingredient', 'Wet ingredients', 'L',        3,  FALSE, NULL),
  ('Rice',              'ingredient', 'Dry ingredients', 'kg',       10, FALSE, NULL),
  ('Garlic',            'ingredient', 'Dry ingredients', 'kg',       2,  TRUE,  NULL),
  ('Salt',              'ingredient', 'Dry ingredients', 'kg',       2,  FALSE, NULL),
  ('Chicken Thigh',     'ingredient', 'Meat',            'kg',       8,  TRUE,  NULL),
  ('Pork Belly',        'ingredient', 'Meat',            'kg',       6,  TRUE,  NULL),
  ('Pork Adobo Tray',   'food_tray',  'Food trays',      'trays',    3,  FALSE, 38),
  ('Pancit Bihon Tray', 'food_tray',  'Food trays',      'trays',    3,  FALSE, 32),
  ('Leche Flan Tray',   'food_tray',  'Food trays',      'trays',    2,  FALSE, 28),
  ('Chicken Adobo',     'food',       'Main dishes',     'servings', 10, FALSE, 8.5),
  ('Fried Chicken',     'food',       'Main dishes',     'servings', 10, FALSE, 8),
  ('Pancit Bihon',      'food',       'Main dishes',     'servings', 8,  FALSE, 7.5),
  ('Garlic Rice',       'food',       'Sides',           'servings', 10, FALSE, 2.5),
  ('Leche Flan',        'food',       'Desserts',        'servings', 6,  FALSE, 3.5)
) AS v(name, item_type, category, unit, min_level, has_expiry, price)
JOIN categories c ON c.name = v.category;

-- ---------- Batches (day offsets are relative to today) ----------
INSERT INTO inventory_batches
    (batch_code, item_id, qty_received, qty_remaining, received_date, expiry_date, created_by)
SELECT v.code, i.id, v.recv, v.remaining,
       CURRENT_DATE + v.received_off,
       CASE WHEN v.expiry_off IS NULL THEN NULL ELSE CURRENT_DATE + v.expiry_off END,
       (SELECT id FROM users WHERE username = 'kitchen')
FROM (VALUES
  ('B-0001', 'Rice',              25, 25, -10, NULL),
  ('B-0002', 'Cooking Oil',       4,  4,  -20, 120),
  ('B-0003', 'Chicken Thigh',     6,  6,  -2,  2),
  ('B-0004', 'Chicken Thigh',     3,  2,  -8,  -1),
  ('B-0005', 'Garlic',            1,  1,  -6,  1),
  ('B-0006', 'Soy Sauce',         6,  6,  -30, 200),
  ('B-0007', 'Pork Adobo Tray',   8,  5,  -1,  1),
  ('B-0008', 'Pancit Bihon Tray', 5,  2,  -1,  2),
  ('B-0009', 'Chicken Adobo',     26, 24, 0,   1),
  ('B-0010', 'Fried Chicken',     8,  8,  0,   1),
  ('B-0011', 'Pancit Bihon',      5,  5,  0,   1),
  ('B-0012', 'Garlic Rice',       30, 30, 0,   1),
  ('B-0013', 'Leche Flan',        14, 12, -1,  3),
  ('B-0014', 'Vinegar',           8,  8,  -15, NULL),
  ('B-0015', 'Salt',              3,  3,  -12, NULL),
  ('B-0016', 'Pork Belly',        10, 10, -1,  4)
) AS v(code, item_name, recv, remaining, received_off, expiry_off)
JOIN items i ON i.name = v.item_name;

-- ---------- Orders ----------
INSERT INTO orders (order_number, order_type, status, total, gst_amount, cashier_id, created_at, completed_at)
SELECT v.num, v.otype::order_type, v.status::order_status, v.total, 0, u.id,
       CURRENT_DATE + v.created::time,
       CASE WHEN v.done IS NULL THEN NULL ELSE CURRENT_DATE + v.done::time END
FROM (VALUES
  ('0011', 'dine_in',  'completed', 24.00, '07:40', '08:00'),
  ('0012', 'takeaway', 'completed', 76.00, '08:05', '08:30'),
  ('0013', 'takeaway', 'preparing', 64.00, '08:20', NULL)
) AS v(num, otype, status, total, created, done)
JOIN users u ON u.username = 'cashier';

INSERT INTO order_items (order_id, item_id, item_name, unit_price, qty)
SELECT o.id, i.id, i.name, i.price, v.qty
FROM (VALUES
  ('0011', 'Chicken Adobo',     2),
  ('0011', 'Leche Flan',        2),
  ('0012', 'Pork Adobo Tray',   2),
  ('0013', 'Pancit Bihon Tray', 2)
) AS v(num, item_name, qty)
JOIN orders o ON o.order_number = v.num
JOIN items  i ON i.name = v.item_name;

INSERT INTO payments (order_id, method, amount_due, amount_tendered, change_given)
SELECT o.id, v.method::payment_method, v.due, v.tendered, v.chg
FROM (VALUES
  ('0011', 'cash',   24.00, 30.00, 6.00),
  ('0012', 'card',   76.00, 76.00, 0.00),
  ('0013', 'paynow', 64.00, 64.00, 0.00)
) AS v(num, method, due, tendered, chg)
JOIN orders o ON o.order_number = v.num;

-- ---------- Stock movement history ----------
INSERT INTO stock_movements (item_id, batch_id, movement_type, qty, reason, order_id, user_id, created_at)
SELECT b.item_id, b.id, v.mtype::movement_type, v.qty, v.reason, o.id, u.id,
       (CURRENT_DATE - v.days_ago) + v.hr * INTERVAL '1 hour'
FROM (VALUES
  ('B-0007', 'USED',       2,  'Order #0012',             0,  8,  'cashier', '0012'),
  ('B-0008', 'USED',       2,  'Order #0013',             0,  8,  'cashier', '0013'),
  ('B-0008', 'DAMAGED',    1,  'Dropped during delivery', 1,  15, 'kitchen', NULL),
  ('B-0008', 'IN',         5,  'Stock in',                1,  14, 'kitchen', NULL),
  ('B-0007', 'IN',         8,  'Stock in',                1,  9,  'kitchen', NULL),
  ('B-0003', 'IN',         6,  'New batch',               2,  10, 'kitchen', NULL),
  ('B-0007', 'DAMAGED',    1,  'Container leaked',        3,  16, 'kitchen', NULL),
  ('B-0004', 'SPOILED',    1,  'Spoiled (smell)',         4,  11, 'owner',   NULL),
  ('B-0005', 'IN',         1,  'New batch',               6,  9,  'kitchen', NULL),
  ('B-0004', 'IN',         3,  'New batch',               8,  9,  'kitchen', NULL),
  ('B-0001', 'IN',         25, 'Stock in',                10, 9,  'kitchen', NULL),
  ('B-0002', 'IN',         4,  'New batch',               20, 9,  'kitchen', NULL),
  ('B-0006', 'IN',         6,  'New batch',               30, 9,  'kitchen', NULL),
  ('B-0009', 'IN',         26, 'Stock in',                0,  7,  'kitchen', NULL),
  ('B-0009', 'USED',       2,  'Order #0011',             0,  8,  'cashier', '0011'),
  ('B-0010', 'IN',         8,  'Stock in',                0,  7,  'kitchen', NULL),
  ('B-0011', 'IN',         5,  'Stock in',                0,  7,  'kitchen', NULL),
  ('B-0012', 'IN',         30, 'Stock in',                0,  7,  'kitchen', NULL),
  ('B-0013', 'IN',         14, 'Stock in',                1,  15, 'kitchen', NULL),
  ('B-0013', 'USED',       2,  'Order #0011',             0,  8,  'cashier', '0011'),
  ('B-0014', 'IN',         8,  'Stock in',                15, 9,  'kitchen', NULL),
  ('B-0015', 'IN',         3,  'Stock in',                12, 9,  'kitchen', NULL),
  ('B-0016', 'IN',         10, 'New batch',               1,  10, 'kitchen', NULL)
) AS v(code, mtype, qty, reason, days_ago, hr, uname, order_no)
JOIN inventory_batches b ON b.batch_code = v.code
JOIN users u ON u.username = v.uname
LEFT JOIN orders o ON o.order_number = v.order_no;

-- Continue the numbering after the sample data
SELECT setval('batch_code_seq', (SELECT COUNT(*) FROM inventory_batches));
UPDATE counters SET last_value = 13 WHERE name = 'order_number';

COMMIT;