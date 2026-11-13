-- Mamitas Kitchen: opening stock, low-stock levels, and dish prices.
-- Generated from Mamitas_Kitchen_Opening_Stock.xlsx: 106 ingredients and 37 dishes.
--
-- Every quantity, shelf life, and price here is an ESTIMATE (standard reorder-point rules).
-- Load it, then correct the figures in the app: Inventory pages for stock and low-stock
-- levels, and Menu, then Edit (as the owner) for prices.
--
-- What it does, all in one transaction (nothing is saved if any row is wrong):
--   1. sets the low-stock level of every ingredient and dish
--   2. sets the price of every dish
--   3. creates one opening batch per item (batch IDs from B-0001), received today,
--      with the expiry date counted from today
--   4. records each opening batch in the stock movement log as "Opening stock"
--
-- Run once, on an empty stock, from the repository root:
--   psql -U postgres -h localhost -d mamitas_kitchen -f database/seeds/05_opening_stock.sql
\set ON_ERROR_STOP on
BEGIN;

-- Guard: this file only loads opening stock into a system that has no stock yet
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM inventory_batches) THEN
        RAISE EXCEPTION 'Stock already exists (% batches). This file only loads opening stock into an empty system. To start clean, run database/seeds/03_real_menu_and_ingredients.sql first.',
            (SELECT COUNT(*) FROM inventory_batches);
    END IF;
END
$$;

CREATE TEMP TABLE opening (
    ord    INTEGER       PRIMARY KEY,
    name   TEXT          NOT NULL,
    kind   TEXT          NOT NULL,   -- 'ingredient' or 'food'
    qty    NUMERIC(12,3) NOT NULL,   -- opening stock
    low    NUMERIC(12,3) NOT NULL,   -- low-stock level
    shelf  INTEGER,                  -- shelf life in days, empty = no expiry date
    price  NUMERIC(10,2)             -- dishes only
) ON COMMIT DROP;

INSERT INTO opening (ord, name, kind, qty, low, shelf, price) VALUES
 (1, 'Eggs', 'ingredient', 240, 120, 21, NULL),
 (2, 'Quail Eggs', 'ingredient', 300, 150, 14, NULL),
 (3, 'Milk', 'ingredient', 3, 2, 5, NULL),
 (4, 'Butter', 'ingredient', 1.8, 0.9, 60, NULL),
 (5, 'Cheese', 'ingredient', 1.8, 0.9, 45, NULL),
 (6, 'Condensed Milk', 'ingredient', 28, 10, 365, NULL),
 (7, 'Evaporated Milk', 'ingredient', 14, 5, 365, NULL),
 (8, 'Table Cream', 'ingredient', 14, 5, 365, NULL),
 (9, 'All-Purpose Cream', 'ingredient', 14, 5, 120, NULL),
 (10, 'Cooking Oil', 'ingredient', 84, 30, 365, NULL),
 (11, 'Sesame Oil', 'ingredient', 1.4, 0.5, 365, NULL),
 (12, 'Soy Sauce', 'ingredient', 21, 7.5, 365, NULL),
 (13, 'Fish Sauce', 'ingredient', 11.2, 4, 730, NULL),
 (14, 'Oyster Sauce', 'ingredient', 8.4, 3, 365, NULL),
 (15, 'Vinegar', 'ingredient', 14, 5, NULL, NULL),
 (16, 'Tomato Sauce', 'ingredient', 21, 7.5, 365, NULL),
 (17, 'Liver Spread', 'ingredient', 4.2, 1.5, 365, NULL),
 (18, 'Peanut Butter', 'ingredient', 7, 2.5, 180, NULL),
 (19, 'Bagoong Alamang', 'ingredient', 8.4, 3, 180, NULL),
 (20, 'Bagoong Isda', 'ingredient', 1.4, 0.5, 180, NULL),
 (21, 'Mayonnaise', 'ingredient', 7, 2.5, 120, NULL),
 (22, 'Banana Ketchup', 'ingredient', 4.2, 1.5, 365, NULL),
 (23, 'Sweet Chili Sauce', 'ingredient', 4.2, 1.5, 365, NULL),
 (24, 'Calamansi Juice', 'ingredient', 5.6, 2, 180, NULL),
 (25, 'Coconut Milk', 'ingredient', 21, 7.5, 365, NULL),
 (26, 'Beef Broth', 'ingredient', 42, 15, 365, NULL),
 (27, 'Vanilla Extract', 'ingredient', 2, 1, 730, NULL),
 (28, 'Pickle Relish', 'ingredient', 2, 1, 365, NULL),
 (29, 'Ube Flavoring', 'ingredient', 2, 1, 365, NULL),
 (30, 'Ube Halaya', 'ingredient', 2.4, 1.2, 60, NULL),
 (31, 'Canned Fruit Cocktail', 'ingredient', 14, 5, 730, NULL),
 (32, 'Nata de Coco', 'ingredient', 2, 1, 365, NULL),
 (33, 'Kaong', 'ingredient', 2, 1, 365, NULL),
 (34, 'Eggplant', 'ingredient', 6, 4, 5, NULL),
 (35, 'Sitaw (String Beans)', 'ingredient', 9, 6, 5, NULL),
 (36, 'Pechay', 'ingredient', 6, 4, 3, NULL),
 (37, 'Banana Blossom', 'ingredient', 3, 2, 5, NULL),
 (38, 'Potatoes', 'ingredient', 18, 9, 30, NULL),
 (39, 'Carrots', 'ingredient', 15, 7.5, 14, NULL),
 (40, 'Bell Pepper', 'ingredient', 4.5, 3, 7, NULL),
 (41, 'Onion', 'ingredient', 18, 9, 30, NULL),
 (42, 'Garlic', 'ingredient', 9, 4.5, 30, NULL),
 (43, 'Tomato', 'ingredient', 6, 4, 7, NULL),
 (44, 'Chili Peppers', 'ingredient', 0.9, 0.6, 7, NULL),
 (45, 'Long Green Chili', 'ingredient', 0.6, 0.4, 7, NULL),
 (46, 'Calamansi', 'ingredient', 6, 3, 10, NULL),
 (47, 'Spring Onion', 'ingredient', 6, 4, 4, NULL),
 (48, 'Ampalaya', 'ingredient', 1.5, 1, 5, NULL),
 (49, 'Okra', 'ingredient', 1.5, 1, 5, NULL),
 (50, 'Kalabasa (Squash)', 'ingredient', 6, 3, 14, NULL),
 (51, 'Cabbage', 'ingredient', 12, 6, 10, NULL),
 (52, 'Cauliflower', 'ingredient', 1.5, 1, 7, NULL),
 (53, 'Broccoli', 'ingredient', 3.6, 2.4, 5, NULL),
 (54, 'Sayote', 'ingredient', 3, 1.5, 10, NULL),
 (55, 'Malunggay', 'ingredient', 3, 2, 3, NULL),
 (56, 'Spinach', 'ingredient', 3, 2, 3, NULL),
 (57, 'Radish', 'ingredient', 3, 1.5, 10, NULL),
 (58, 'Kangkong', 'ingredient', 3, 2, 3, NULL),
 (59, 'Gabi (Taro)', 'ingredient', 3, 1.5, 14, NULL),
 (60, 'Ginger', 'ingredient', 1.8, 0.9, 21, NULL),
 (61, 'Bean Sprouts', 'ingredient', 2.4, 1.6, 2, NULL),
 (62, 'Green Beans', 'ingredient', 1.2, 0.8, 5, NULL),
 (63, 'Sweet Potato', 'ingredient', 3, 1.5, 14, NULL),
 (64, 'Mushrooms', 'ingredient', 2.4, 1.6, 5, NULL),
 (65, 'Green Peas', 'ingredient', 2.8, 1, 180, NULL),
 (66, 'Corn', 'ingredient', 12, 8, 5, NULL),
 (67, 'Ripe Mangoes', 'ingredient', 4.5, 3, 5, NULL),
 (68, 'Tamarind', 'ingredient', 2.8, 1, 90, NULL),
 (69, 'Ube (Purple Yam)', 'ingredient', 1.8, 0.9, 14, NULL),
 (70, 'Salt', 'ingredient', 7, 2.5, NULL, NULL),
 (71, 'White Sugar', 'ingredient', 14, 5, NULL, NULL),
 (72, 'Brown Sugar', 'ingredient', 2.8, 1, NULL, NULL),
 (73, 'Black Pepper', 'ingredient', 2.1, 0.8, NULL, NULL),
 (74, 'Whole Peppercorn', 'ingredient', 0.7, 0.3, NULL, NULL),
 (75, 'Cornstarch', 'ingredient', 5.6, 2, NULL, NULL),
 (76, 'Bay Leaves', 'ingredient', 2, 1, NULL, NULL),
 (77, 'Star Anise', 'ingredient', 2, 1, NULL, NULL),
 (78, 'All-Purpose Flour', 'ingredient', 14, 5, 180, NULL),
 (79, 'Annatto (Atsuete)', 'ingredient', 0.7, 0.3, 365, NULL),
 (80, 'Mung Beans', 'ingredient', 8.4, 3, 365, NULL),
 (81, 'Egg Noodles', 'ingredient', 14, 5, 180, NULL),
 (82, 'Elbow Macaroni', 'ingredient', 11.2, 4, 365, NULL),
 (83, 'Lumpia Wrappers', 'ingredient', 14, 5, 90, NULL),
 (84, 'Graham Crackers', 'ingredient', 14, 5, 180, NULL),
 (85, 'Raisins', 'ingredient', 1.4, 0.5, 180, NULL),
 (86, 'Sinigang Mix', 'ingredient', 14, 5, 365, NULL),
 (87, 'Beef Seasoning Cube', 'ingredient', 5, 2, 365, NULL),
 (88, 'Pork Pata', 'ingredient', 7.5, 5, 4, NULL),
 (89, 'Pork Spareribs', 'ingredient', 3, 2, 4, NULL),
 (90, 'Pork Belly', 'ingredient', 7.5, 5, 4, NULL),
 (91, 'Bagnet (Crispy Pork Belly)', 'ingredient', 3, 2, 5, NULL),
 (92, 'Pork', 'ingredient', 6, 4, 4, NULL),
 (93, 'Ground Pork', 'ingredient', 4.5, 3, 2, NULL),
 (94, 'Pork Lungs', 'ingredient', 1.2, 0.8, 2, NULL),
 (95, 'Pork Heart', 'ingredient', 1.2, 0.8, 2, NULL),
 (96, 'Pork Liver', 'ingredient', 0.9, 0.6, 2, NULL),
 (97, 'Pork Intestines', 'ingredient', 1.8, 1.2, 2, NULL),
 (98, 'Pork Blood', 'ingredient', 1.5, 1, 2, NULL),
 (99, 'Beef', 'ingredient', 3, 2, 4, NULL),
 (100, 'Beef Slices', 'ingredient', 3, 2, 3, NULL),
 (101, 'Beef Brisket', 'ingredient', 2.4, 1.6, 4, NULL),
 (102, 'Beef Shank (with Marrow)', 'ingredient', 4.5, 3, 4, NULL),
 (103, 'Chicken', 'ingredient', 4.5, 3, 3, NULL),
 (104, 'Bangus', 'ingredient', 3.6, 2.4, 3, NULL),
 (105, 'Shrimp', 'ingredient', 0.9, 0.6, 2, NULL),
 (106, 'Hotdog', 'ingredient', 2, 1, 30, NULL),
 (107, 'Kare-Kare (Pork Pata)', 'food', 12, 4, 1, 13.00),
 (108, 'Kaldereta Spareribs', 'food', 12, 4, 1, 12.00),
 (109, 'Binagoongan', 'food', 12, 4, 1, 10.50),
 (110, 'Sarsiado Bangus', 'food', 12, 4, 1, 10.50),
 (111, 'Giniling na Baboy', 'food', 12, 4, 1, 9.00),
 (112, 'Sisig Bagnet', 'food', 12, 4, 1, 11.50),
 (113, 'Pakbet', 'food', 12, 4, 1, 8.50),
 (114, 'Chop Suey', 'food', 12, 4, 1, 8.50),
 (115, 'Monggo', 'food', 12, 4, 1, 8.00),
 (116, 'Lechon Kawali', 'food', 12, 4, 1, 11.50),
 (117, 'Bicol Express', 'food', 12, 4, 1, 10.50),
 (118, 'Bopis', 'food', 12, 4, 1, 9.50),
 (119, 'Beef Mushroom', 'food', 12, 4, 1, 11.50),
 (120, 'Menudo', 'food', 12, 4, 1, 9.50),
 (121, 'Sinigang na Baboy', 'food', 12, 4, 1, 11.00),
 (122, 'Ginataang Sitaw at Kalabasa', 'food', 12, 4, 1, 8.50),
 (123, 'Paksiw na Pata', 'food', 12, 4, 1, 12.00),
 (124, 'Pork Mechado', 'food', 12, 4, 1, 10.50),
 (125, 'Bistek Tagalog', 'food', 12, 4, 1, 11.50),
 (126, 'Paksiw na Bangus', 'food', 12, 4, 1, 10.00),
 (127, 'Beef Broccoli', 'food', 12, 4, 1, 11.50),
 (128, 'Chicken Afritada', 'food', 12, 4, 1, 9.50),
 (129, 'Classic Dinuguan', 'food', 12, 4, 1, 9.50),
 (130, 'Pork Shanghai', 'food', 15, 5, 1, 6.50),
 (131, 'Vegetable Spring Roll', 'food', 15, 5, 1, 5.50),
 (132, 'Vegetable Okoy', 'food', 15, 5, 1, 5.50),
 (133, 'Torta Talong', 'food', 15, 5, 1, 5.50),
 (134, 'Kwek-Kwek', 'food', 15, 5, 1, 4.50),
 (135, 'Embutido', 'food', 15, 5, 1, 6.00),
 (136, 'Chicharon Bulaklak', 'food', 15, 5, 1, 8.50),
 (137, 'Beef Mami', 'food', 10, 3, 1, 9.50),
 (138, 'Special Bulalo', 'food', 10, 3, 1, 14.00),
 (139, 'Ube Bar', 'food', 12, 4, 3, 3.50),
 (140, 'Fruit Salad', 'food', 12, 4, 2, 3.50),
 (141, 'Leche Flan', 'food', 12, 4, 3, 3.50),
 (142, 'Mango Graham', 'food', 12, 4, 2, 4.00),
 (143, 'Macaroni Salad', 'food', 12, 4, 2, 4.00);

-- Checks: every name must exist in the system, and the expiry setting must agree with it
DO $$
DECLARE
    missing  TEXT;
    mismatch TEXT;
BEGIN
    SELECT string_agg(o.name, ', ' ORDER BY o.ord) INTO missing
      FROM opening o
      LEFT JOIN items i
             ON i.name = o.name
            AND i.item_type = CASE o.kind WHEN 'ingredient' THEN 'ingredient'::item_type
                                          ELSE 'food'::item_type END
     WHERE i.id IS NULL;
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'These names are not in the system (check spelling, or load the real items first): %', missing;
    END IF;

    SELECT string_agg(o.name, ', ' ORDER BY o.ord) INTO mismatch
      FROM opening o
      JOIN items i ON i.name = o.name AND i.item_type = 'ingredient'
     WHERE o.kind = 'ingredient' AND i.has_expiry <> (o.shelf IS NOT NULL);
    IF mismatch IS NOT NULL THEN
        RAISE EXCEPTION 'The expiry setting in this file does not match the system for: %', mismatch;
    END IF;
END
$$;

-- 1 and 2: low-stock levels and prices
UPDATE items i
   SET min_level = o.low
  FROM opening o
 WHERE o.kind = 'ingredient' AND i.name = o.name AND i.item_type = 'ingredient';

UPDATE items i
   SET min_level = o.low, price = o.price
  FROM opening o
 WHERE o.kind = 'food' AND i.name = o.name AND i.item_type = 'food';

-- 3 and 4: one opening batch per item, and its entry in the movement log
WITH new_batches AS (
    INSERT INTO inventory_batches
           (item_id, qty_received, qty_remaining, received_date, expiry_date, created_by)
    SELECT i.id, o.qty, o.qty, CURRENT_DATE,
           CASE WHEN o.shelf IS NULL THEN NULL ELSE CURRENT_DATE + o.shelf END,
           (SELECT id FROM users WHERE username = 'owner')
      FROM opening o
      JOIN items i
        ON i.name = o.name
       AND i.item_type = CASE o.kind WHEN 'ingredient' THEN 'ingredient'::item_type
                                     ELSE 'food'::item_type END
     ORDER BY o.ord
    RETURNING id, item_id, qty_received
)
INSERT INTO stock_movements (item_id, batch_id, movement_type, qty, reason, user_id)
SELECT item_id, id, 'IN', qty_received, 'Opening stock',
       (SELECT id FROM users WHERE username = 'owner')
  FROM new_batches;

INSERT INTO audit_log (username, action, entity, details)
SELECT 'script', 'stock.opening_import', 'inventory',
       jsonb_build_object('ingredients', COUNT(*) FILTER (WHERE kind = 'ingredient'),
                          'dishes',      COUNT(*) FILTER (WHERE kind = 'food'),
                          'date',        CURRENT_DATE)
  FROM opening;

COMMIT;

-- Summary
SELECT i.item_type AS kind,
       COUNT(DISTINCT i.id) AS items,
       COUNT(b.id)          AS opening_batches,
       MIN(b.batch_code)    AS first_batch,
       MAX(b.batch_code)    AS last_batch
  FROM items i
  LEFT JOIN inventory_batches b ON b.item_id = i.id
 GROUP BY i.item_type
 ORDER BY 1;