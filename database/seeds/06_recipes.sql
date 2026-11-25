-- Mamitas Kitchen: recipes (what ONE TRAY of each dish uses).
-- Generated from "Mamita's Kitchen Singapore - Standard Dish Ingredients & Inventory Units" (PDF):
-- 37 dishes, 364 recipe lines. Standard yield: 1 tray = 10 servings.
--
-- How the app uses a recipe when trays of a dish are added to the menu (migration 007):
--   * a normal line        -> qty_per_tray x trays is taken from inventory, oldest batch first (FIFO)
--   * an "or" line         -> lines with the same alt_group are choices (alt_rank 1 is tried first).
--                             The first choice that has enough stock is used. (21 such groups)
--   * an optional line     -> listed here, but NOT taken from inventory (18 such lines)
--
-- Needs migration 007 and the real items from 03_real_menu_and_ingredients.sql.
-- Safe to run again: the recipes of every dish listed here are replaced. Nothing is saved if a
-- dish or ingredient name is wrong, or a unit does not match the one in the system.
--   psql -U postgres -h localhost -d mamitas_kitchen -f database/seeds/06_recipes.sql
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE recipe_src (
    dish         TEXT          NOT NULL,
    ingredient   TEXT          NOT NULL,
    qty_per_tray NUMERIC(12,3) NOT NULL,
    unit         TEXT          NOT NULL,   -- must equal the ingredient's unit in the system
    alt_group    SMALLINT,
    alt_rank     SMALLINT,
    is_optional  BOOLEAN       NOT NULL
) ON COMMIT DROP;

INSERT INTO recipe_src (dish, ingredient, qty_per_tray, unit, alt_group, alt_rank, is_optional) VALUES
  -- Kare-Kare (Pork Pata)
  ('Kare-Kare (Pork Pata)', 'Pork Pata', 1.5, 'kg', NULL, NULL, FALSE),
  ('Kare-Kare (Pork Pata)', 'Eggplant', 0.3, 'kg', NULL, NULL, FALSE),
  ('Kare-Kare (Pork Pata)', 'Sitaw (String Beans)', 2, 'bunch', NULL, NULL, FALSE),
  ('Kare-Kare (Pork Pata)', 'Pechay', 1, 'bunch', NULL, NULL, FALSE),
  ('Kare-Kare (Pork Pata)', 'Banana Blossom', 1, 'pcs', NULL, NULL, FALSE),
  ('Kare-Kare (Pork Pata)', 'Peanut Butter', 0.25, 'kg', NULL, NULL, FALSE),
  ('Kare-Kare (Pork Pata)', 'Bagoong Alamang', 0.15, 'kg', NULL, NULL, FALSE),
  ('Kare-Kare (Pork Pata)', 'Annatto (Atsuete)', 0.015, 'kg', NULL, NULL, FALSE),
  ('Kare-Kare (Pork Pata)', 'Garlic', 0.04, 'kg', NULL, NULL, FALSE),
  ('Kare-Kare (Pork Pata)', 'Onion', 0.1, 'kg', NULL, NULL, FALSE),
  ('Kare-Kare (Pork Pata)', 'Salt', 0.01, 'kg', NULL, NULL, FALSE),
  -- Kaldereta Spareribs
  ('Kaldereta Spareribs', 'Pork Spareribs', 1.5, 'kg', NULL, NULL, FALSE),
  ('Kaldereta Spareribs', 'Potatoes', 0.3, 'kg', NULL, NULL, FALSE),
  ('Kaldereta Spareribs', 'Carrots', 0.2, 'kg', NULL, NULL, FALSE),
  ('Kaldereta Spareribs', 'Bell Pepper', 0.1, 'kg', NULL, NULL, FALSE),
  ('Kaldereta Spareribs', 'Onion', 0.1, 'kg', NULL, NULL, FALSE),
  ('Kaldereta Spareribs', 'Garlic', 0.04, 'kg', NULL, NULL, FALSE),
  ('Kaldereta Spareribs', 'Tomato Sauce', 0.25, 'L', NULL, NULL, FALSE),
  ('Kaldereta Spareribs', 'Liver Spread', 0.085, 'kg', NULL, NULL, FALSE),
  ('Kaldereta Spareribs', 'Soy Sauce', 0.06, 'L', NULL, NULL, FALSE),
  ('Kaldereta Spareribs', 'Bay Leaves', 0.05, 'pack', NULL, NULL, FALSE),
  ('Kaldereta Spareribs', 'Black Pepper', 0.005, 'kg', NULL, NULL, FALSE),
  ('Kaldereta Spareribs', 'Chili Peppers', 0.015, 'kg', NULL, NULL, TRUE),
  -- Binagoongan
  ('Binagoongan', 'Pork Belly', 1.5, 'kg', NULL, NULL, FALSE),
  ('Binagoongan', 'Garlic', 0.04, 'kg', NULL, NULL, FALSE),
  ('Binagoongan', 'Onion', 0.1, 'kg', NULL, NULL, FALSE),
  ('Binagoongan', 'Tomato', 0.15, 'kg', NULL, NULL, FALSE),
  ('Binagoongan', 'Chili Peppers', 0.02, 'kg', NULL, NULL, TRUE),
  ('Binagoongan', 'Bagoong Alamang', 0.15, 'kg', NULL, NULL, FALSE),
  ('Binagoongan', 'Vinegar', 0.045, 'L', NULL, NULL, FALSE),
  ('Binagoongan', 'Black Pepper', 0.005, 'kg', NULL, NULL, FALSE),
  ('Binagoongan', 'Cooking Oil', 0.045, 'L', NULL, NULL, FALSE),
  -- Sarsiado Bangus
  ('Sarsiado Bangus', 'Bangus', 1.2, 'kg', NULL, NULL, FALSE),
  ('Sarsiado Bangus', 'Tomato', 0.3, 'kg', NULL, NULL, FALSE),
  ('Sarsiado Bangus', 'Onion', 0.15, 'kg', NULL, NULL, FALSE),
  ('Sarsiado Bangus', 'Garlic', 0.04, 'kg', NULL, NULL, FALSE),
  ('Sarsiado Bangus', 'Eggs', 3, 'pcs', NULL, NULL, FALSE),
  ('Sarsiado Bangus', 'Spring Onion', 0.5, 'bunch', NULL, NULL, FALSE),
  ('Sarsiado Bangus', 'Fish Sauce', 0.03, 'L', NULL, NULL, FALSE),
  ('Sarsiado Bangus', 'Salt', 0.01, 'kg', NULL, NULL, FALSE),
  ('Sarsiado Bangus', 'Black Pepper', 0.005, 'kg', NULL, NULL, FALSE),
  ('Sarsiado Bangus', 'Cooking Oil', 0.1, 'L', NULL, NULL, FALSE),
  -- Giniling na Baboy
  ('Giniling na Baboy', 'Ground Pork', 1.2, 'kg', NULL, NULL, FALSE),
  ('Giniling na Baboy', 'Potatoes', 0.25, 'kg', NULL, NULL, FALSE),
  ('Giniling na Baboy', 'Carrots', 0.2, 'kg', NULL, NULL, FALSE),
  ('Giniling na Baboy', 'Bell Pepper', 0.1, 'kg', NULL, NULL, FALSE),
  ('Giniling na Baboy', 'Green Peas', 0.1, 'kg', NULL, NULL, TRUE),
  ('Giniling na Baboy', 'Garlic', 0.04, 'kg', NULL, NULL, FALSE),
  ('Giniling na Baboy', 'Onion', 0.1, 'kg', NULL, NULL, FALSE),
  ('Giniling na Baboy', 'Tomato', 0.15, 'kg', NULL, NULL, FALSE),
  ('Giniling na Baboy', 'Tomato Sauce', 0.25, 'L', NULL, NULL, FALSE),
  ('Giniling na Baboy', 'Soy Sauce', 0.045, 'L', NULL, NULL, FALSE),
  ('Giniling na Baboy', 'Fish Sauce', 0.03, 'L', NULL, NULL, FALSE),
  ('Giniling na Baboy', 'Salt', 0.005, 'kg', NULL, NULL, FALSE),
  ('Giniling na Baboy', 'Black Pepper', 0.005, 'kg', NULL, NULL, FALSE),
  -- Sisig Bagnet
  ('Sisig Bagnet', 'Bagnet (Crispy Pork Belly)', 1.2, 'kg', NULL, NULL, FALSE),
  ('Sisig Bagnet', 'Onion', 0.25, 'kg', NULL, NULL, FALSE),
  ('Sisig Bagnet', 'Chili Peppers', 0.025, 'kg', NULL, NULL, FALSE),
  ('Sisig Bagnet', 'Calamansi', 0.1, 'kg', NULL, NULL, FALSE),
  ('Sisig Bagnet', 'Soy Sauce', 0.045, 'L', NULL, NULL, FALSE),
  ('Sisig Bagnet', 'Calamansi Juice', 0.045, 'L', NULL, NULL, FALSE),
  ('Sisig Bagnet', 'Mayonnaise', 0.1, 'kg', NULL, NULL, TRUE),
  ('Sisig Bagnet', 'Black Pepper', 0.005, 'kg', NULL, NULL, FALSE),
  -- Pakbet
  ('Pakbet', 'Pork Belly', 0.5, 'kg', NULL, NULL, FALSE),
  ('Pakbet', 'Ampalaya', 0.25, 'kg', NULL, NULL, FALSE),
  ('Pakbet', 'Eggplant', 0.25, 'kg', NULL, NULL, FALSE),
  ('Pakbet', 'Okra', 0.2, 'kg', NULL, NULL, FALSE),
  ('Pakbet', 'Sitaw (String Beans)', 2, 'bunch', NULL, NULL, FALSE),
  ('Pakbet', 'Kalabasa (Squash)', 0.3, 'kg', NULL, NULL, FALSE),
  ('Pakbet', 'Tomato', 0.15, 'kg', NULL, NULL, FALSE),
  ('Pakbet', 'Onion', 0.1, 'kg', NULL, NULL, FALSE),
  ('Pakbet', 'Garlic', 0.04, 'kg', NULL, NULL, FALSE),
  ('Pakbet', 'Bagoong Isda', 0.06, 'kg', 1, 1, FALSE),
  ('Pakbet', 'Bagoong Alamang', 0.08, 'kg', 1, 2, FALSE),
  ('Pakbet', 'Salt', 0.005, 'kg', NULL, NULL, FALSE),
  ('Pakbet', 'Black Pepper', 0.005, 'kg', NULL, NULL, FALSE),
  -- Chop Suey
  ('Chop Suey', 'Cabbage', 0.3, 'kg', NULL, NULL, FALSE),
  ('Chop Suey', 'Carrots', 0.15, 'kg', NULL, NULL, FALSE),
  ('Chop Suey', 'Cauliflower', 0.2, 'kg', NULL, NULL, FALSE),
  ('Chop Suey', 'Broccoli', 0.2, 'kg', NULL, NULL, FALSE),
  ('Chop Suey', 'Bell Pepper', 0.1, 'kg', NULL, NULL, FALSE),
  ('Chop Suey', 'Sayote', 0.2, 'kg', NULL, NULL, FALSE),
  ('Chop Suey', 'Pork', 0.5, 'kg', 1, 1, FALSE),
  ('Chop Suey', 'Chicken', 0.5, 'kg', 1, 2, FALSE),
  ('Chop Suey', 'Shrimp', 0.25, 'kg', NULL, NULL, TRUE),
  ('Chop Suey', 'Oyster Sauce', 0.06, 'L', NULL, NULL, FALSE),
  ('Chop Suey', 'Soy Sauce', 0.03, 'L', NULL, NULL, FALSE),
  ('Chop Suey', 'Garlic', 0.03, 'kg', NULL, NULL, FALSE),
  ('Chop Suey', 'Onion', 0.1, 'kg', NULL, NULL, FALSE),
  ('Chop Suey', 'Cornstarch', 0.015, 'kg', NULL, NULL, FALSE),
  ('Chop Suey', 'Black Pepper', 0.005, 'kg', NULL, NULL, FALSE),
  -- Monggo
  ('Monggo', 'Mung Beans', 0.4, 'kg', NULL, NULL, FALSE),
  ('Monggo', 'Pork', 0.5, 'kg', NULL, NULL, FALSE),
  ('Monggo', 'Malunggay', 1, 'bunch', 1, 1, FALSE),
  ('Monggo', 'Spinach', 1, 'bunch', 1, 2, FALSE),
  ('Monggo', 'Tomato', 0.15, 'kg', NULL, NULL, FALSE),
  ('Monggo', 'Onion', 0.1, 'kg', NULL, NULL, FALSE),
  ('Monggo', 'Garlic', 0.04, 'kg', NULL, NULL, FALSE),
  ('Monggo', 'Fish Sauce', 0.045, 'L', NULL, NULL, FALSE),
  ('Monggo', 'Salt', 0.01, 'kg', NULL, NULL, FALSE),
  ('Monggo', 'Black Pepper', 0.005, 'kg', NULL, NULL, FALSE),
  -- Lechon Kawali
  ('Lechon Kawali', 'Pork Belly', 1.5, 'kg', NULL, NULL, FALSE),
  ('Lechon Kawali', 'Garlic', 0.05, 'kg', NULL, NULL, FALSE),
  ('Lechon Kawali', 'Bay Leaves', 0.05, 'pack', NULL, NULL, FALSE),
  ('Lechon Kawali', 'Salt', 0.02, 'kg', NULL, NULL, FALSE),
  ('Lechon Kawali', 'Black Pepper', 0.01, 'kg', NULL, NULL, FALSE),
  ('Lechon Kawali', 'Vinegar', 0.15, 'L', 1, 1, FALSE),
  ('Lechon Kawali', 'Liver Spread', 0.15, 'kg', 1, 2, FALSE),
  -- Bicol Express
  ('Bicol Express', 'Pork Belly', 1.5, 'kg', NULL, NULL, FALSE),
  ('Bicol Express', 'Coconut Milk', 0.5, 'L', NULL, NULL, FALSE),
  ('Bicol Express', 'Chili Peppers', 0.05, 'kg', NULL, NULL, FALSE),
  ('Bicol Express', 'Garlic', 0.04, 'kg', NULL, NULL, FALSE),
  ('Bicol Express', 'Onion', 0.1, 'kg', NULL, NULL, FALSE),
  ('Bicol Express', 'Bagoong Alamang', 0.1, 'kg', NULL, NULL, FALSE),
  ('Bicol Express', 'Fish Sauce', 0.03, 'L', NULL, NULL, FALSE),
  ('Bicol Express', 'Black Pepper', 0.005, 'kg', NULL, NULL, FALSE),
  -- Bopis
  ('Bopis', 'Pork Lungs', 0.8, 'kg', NULL, NULL, FALSE),
  ('Bopis', 'Pork Heart', 0.4, 'kg', NULL, NULL, FALSE),
  ('Bopis', 'Carrots', 0.15, 'kg', NULL, NULL, FALSE),
  ('Bopis', 'Bell Pepper', 0.1, 'kg', NULL, NULL, FALSE),
  ('Bopis', 'Onion', 0.1, 'kg', NULL, NULL, FALSE),
  ('Bopis', 'Garlic', 0.04, 'kg', NULL, NULL, FALSE),
  ('Bopis', 'Chili Peppers', 0.02, 'kg', NULL, NULL, FALSE),
  ('Bopis', 'Vinegar', 0.06, 'L', NULL, NULL, FALSE),
  ('Bopis', 'Fish Sauce', 0.045, 'L', NULL, NULL, FALSE),
  ('Bopis', 'Bay Leaves', 0.05, 'pack', NULL, NULL, FALSE),
  ('Bopis', 'Black Pepper', 0.005, 'kg', NULL, NULL, FALSE),
  -- Beef Mushroom
  ('Beef Mushroom', 'Beef', 1.2, 'kg', NULL, NULL, FALSE),
  ('Beef Mushroom', 'Mushrooms', 0.3, 'kg', NULL, NULL, FALSE),
  ('Beef Mushroom', 'Onion', 0.15, 'kg', NULL, NULL, FALSE),
  ('Beef Mushroom', 'Garlic', 0.04, 'kg', NULL, NULL, FALSE),
  ('Beef Mushroom', 'Soy Sauce', 0.06, 'L', NULL, NULL, FALSE),
  ('Beef Mushroom', 'Oyster Sauce', 0.06, 'L', NULL, NULL, FALSE),
  ('Beef Mushroom', 'Beef Broth', 0.25, 'L', NULL, NULL, FALSE),
  ('Beef Mushroom', 'Cornstarch', 0.015, 'kg', NULL, NULL, FALSE),
  ('Beef Mushroom', 'Black Pepper', 0.005, 'kg', NULL, NULL, FALSE),
  -- Menudo
  ('Menudo', 'Pork', 1, 'kg', NULL, NULL, FALSE),
  ('Menudo', 'Pork Liver', 0.25, 'kg', NULL, NULL, FALSE),
  ('Menudo', 'Potatoes', 0.25, 'kg', NULL, NULL, FALSE),
  ('Menudo', 'Carrots', 0.2, 'kg', NULL, NULL, FALSE),
  ('Menudo', 'Bell Pepper', 0.1, 'kg', NULL, NULL, FALSE),
  ('Menudo', 'Tomato', 0.15, 'kg', NULL, NULL, FALSE),
  ('Menudo', 'Garlic', 0.04, 'kg', NULL, NULL, FALSE),
  ('Menudo', 'Onion', 0.1, 'kg', NULL, NULL, FALSE),
  ('Menudo', 'Tomato Sauce', 0.25, 'L', NULL, NULL, FALSE),
  ('Menudo', 'Soy Sauce', 0.06, 'L', NULL, NULL, FALSE),
  ('Menudo', 'Bay Leaves', 0.05, 'pack', NULL, NULL, FALSE),
  ('Menudo', 'Black Pepper', 0.005, 'kg', NULL, NULL, FALSE),
  -- Sinigang na Baboy
  ('Sinigang na Baboy', 'Pork Belly', 1.5, 'kg', NULL, NULL, FALSE),
  ('Sinigang na Baboy', 'Tomato', 0.2, 'kg', NULL, NULL, FALSE),
  ('Sinigang na Baboy', 'Onion', 0.15, 'kg', NULL, NULL, FALSE),
  ('Sinigang na Baboy', 'Radish', 0.2, 'kg', NULL, NULL, FALSE),
  ('Sinigang na Baboy', 'Kangkong', 1, 'bunch', NULL, NULL, FALSE),
  ('Sinigang na Baboy', 'Sitaw (String Beans)', 1, 'bunch', NULL, NULL, FALSE),
  ('Sinigang na Baboy', 'Eggplant', 0.2, 'kg', NULL, NULL, FALSE),
  ('Sinigang na Baboy', 'Gabi (Taro)', 0.15, 'kg', NULL, NULL, TRUE),
  ('Sinigang na Baboy', 'Tamarind', 0.044, 'kg', 1, 1, FALSE),
  ('Sinigang na Baboy', 'Sinigang Mix', 2, 'pack', 1, 2, FALSE),
  ('Sinigang na Baboy', 'Fish Sauce', 0.06, 'L', NULL, NULL, FALSE),
  ('Sinigang na Baboy', 'Salt', 0.01, 'kg', NULL, NULL, FALSE),
  -- Ginataang Sitaw at Kalabasa
  ('Ginataang Sitaw at Kalabasa', 'Sitaw (String Beans)', 3, 'bunch', NULL, NULL, FALSE),
  ('Ginataang Sitaw at Kalabasa', 'Kalabasa (Squash)', 0.5, 'kg', NULL, NULL, FALSE),
  ('Ginataang Sitaw at Kalabasa', 'Pork', 0.4, 'kg', 1, 1, FALSE),
  ('Ginataang Sitaw at Kalabasa', 'Shrimp', 0.4, 'kg', 1, 2, TRUE),
  ('Ginataang Sitaw at Kalabasa', 'Garlic', 0.03, 'kg', NULL, NULL, FALSE),
  ('Ginataang Sitaw at Kalabasa', 'Onion', 0.1, 'kg', NULL, NULL, FALSE),
  ('Ginataang Sitaw at Kalabasa', 'Coconut Milk', 0.4, 'L', NULL, NULL, FALSE),
  ('Ginataang Sitaw at Kalabasa', 'Fish Sauce', 0.03, 'L', NULL, NULL, FALSE),
  ('Ginataang Sitaw at Kalabasa', 'Salt', 0.005, 'kg', NULL, NULL, FALSE),
  ('Ginataang Sitaw at Kalabasa', 'Chili Peppers', 0.015, 'kg', NULL, NULL, TRUE),
  -- Paksiw na Pata
  ('Paksiw na Pata', 'Pork Pata', 1.5, 'kg', NULL, NULL, FALSE),
  ('Paksiw na Pata', 'Garlic', 0.05, 'kg', NULL, NULL, FALSE),
  ('Paksiw na Pata', 'Onion', 0.1, 'kg', NULL, NULL, FALSE),
  ('Paksiw na Pata', 'Bay Leaves', 0.05, 'pack', NULL, NULL, FALSE),
  ('Paksiw na Pata', 'Vinegar', 0.12, 'L', NULL, NULL, FALSE),
  ('Paksiw na Pata', 'Soy Sauce', 0.09, 'L', NULL, NULL, FALSE),
  ('Paksiw na Pata', 'Brown Sugar', 0.06, 'kg', NULL, NULL, FALSE),
  ('Paksiw na Pata', 'Whole Peppercorn', 0.005, 'kg', NULL, NULL, FALSE),
  -- Pork Mechado
  ('Pork Mechado', 'Beef', 1.3, 'kg', 1, 1, FALSE),
  ('Pork Mechado', 'Pork', 1.3, 'kg', 1, 2, FALSE),
  ('Pork Mechado', 'Potatoes', 0.3, 'kg', NULL, NULL, FALSE),
  ('Pork Mechado', 'Carrots', 0.2, 'kg', NULL, NULL, FALSE),
  ('Pork Mechado', 'Bell Pepper', 0.1, 'kg', NULL, NULL, FALSE),
  ('Pork Mechado', 'Garlic', 0.04, 'kg', NULL, NULL, FALSE),
  ('Pork Mechado', 'Onion', 0.1, 'kg', NULL, NULL, FALSE),
  ('Pork Mechado', 'Tomato Sauce', 0.25, 'L', NULL, NULL, FALSE),
  ('Pork Mechado', 'Soy Sauce', 0.06, 'L', NULL, NULL, FALSE),
  ('Pork Mechado', 'Calamansi Juice', 0.03, 'L', NULL, NULL, FALSE),
  ('Pork Mechado', 'Bay Leaves', 0.05, 'pack', NULL, NULL, FALSE),
  ('Pork Mechado', 'Black Pepper', 0.005, 'kg', NULL, NULL, FALSE),
  -- Bistek Tagalog
  ('Bistek Tagalog', 'Beef Slices', 1.2, 'kg', NULL, NULL, FALSE),
  ('Bistek Tagalog', 'Onion', 0.25, 'kg', NULL, NULL, FALSE),
  ('Bistek Tagalog', 'Garlic', 0.04, 'kg', NULL, NULL, FALSE),
  ('Bistek Tagalog', 'Soy Sauce', 0.09, 'L', NULL, NULL, FALSE),
  ('Bistek Tagalog', 'Calamansi Juice', 0.06, 'L', NULL, NULL, FALSE),
  ('Bistek Tagalog', 'Black Pepper', 0.005, 'kg', NULL, NULL, FALSE),
  -- Paksiw na Bangus
  ('Paksiw na Bangus', 'Bangus', 1.2, 'kg', NULL, NULL, FALSE),
  ('Paksiw na Bangus', 'Ginger', 0.05, 'kg', NULL, NULL, FALSE),
  ('Paksiw na Bangus', 'Garlic', 0.04, 'kg', NULL, NULL, FALSE),
  ('Paksiw na Bangus', 'Onion', 0.1, 'kg', NULL, NULL, FALSE),
  ('Paksiw na Bangus', 'Eggplant', 0.2, 'kg', NULL, NULL, FALSE),
  ('Paksiw na Bangus', 'Okra', 0.15, 'kg', NULL, NULL, FALSE),
  ('Paksiw na Bangus', 'Long Green Chili', 0.03, 'kg', NULL, NULL, FALSE),
  ('Paksiw na Bangus', 'Vinegar', 0.15, 'L', NULL, NULL, FALSE),
  ('Paksiw na Bangus', 'Whole Peppercorn', 0.005, 'kg', NULL, NULL, FALSE),
  ('Paksiw na Bangus', 'Salt', 0.01, 'kg', 1, 1, FALSE),
  ('Paksiw na Bangus', 'Fish Sauce', 0.03, 'L', 1, 2, FALSE),
  -- Beef Broccoli
  ('Beef Broccoli', 'Beef Slices', 1.2, 'kg', NULL, NULL, FALSE),
  ('Beef Broccoli', 'Broccoli', 0.5, 'kg', NULL, NULL, FALSE),
  ('Beef Broccoli', 'Garlic', 0.04, 'kg', NULL, NULL, FALSE),
  ('Beef Broccoli', 'Onion', 0.1, 'kg', NULL, NULL, FALSE),
  ('Beef Broccoli', 'Oyster Sauce', 0.075, 'L', NULL, NULL, FALSE),
  ('Beef Broccoli', 'Soy Sauce', 0.045, 'L', NULL, NULL, FALSE),
  ('Beef Broccoli', 'Cornstarch', 0.015, 'kg', NULL, NULL, FALSE),
  ('Beef Broccoli', 'Sesame Oil', 0.01, 'L', NULL, NULL, TRUE),
  ('Beef Broccoli', 'Black Pepper', 0.005, 'kg', NULL, NULL, FALSE),
  -- Chicken Afritada
  ('Chicken Afritada', 'Chicken', 1.5, 'kg', NULL, NULL, FALSE),
  ('Chicken Afritada', 'Potatoes', 0.3, 'kg', NULL, NULL, FALSE),
  ('Chicken Afritada', 'Carrots', 0.2, 'kg', NULL, NULL, FALSE),
  ('Chicken Afritada', 'Bell Pepper', 0.1, 'kg', NULL, NULL, FALSE),
  ('Chicken Afritada', 'Garlic', 0.04, 'kg', NULL, NULL, FALSE),
  ('Chicken Afritada', 'Onion', 0.1, 'kg', NULL, NULL, FALSE),
  ('Chicken Afritada', 'Tomato Sauce', 0.25, 'L', NULL, NULL, FALSE),
  ('Chicken Afritada', 'Fish Sauce', 0.03, 'L', 1, 1, FALSE),
  ('Chicken Afritada', 'Soy Sauce', 0.045, 'L', 1, 2, FALSE),
  ('Chicken Afritada', 'Bay Leaves', 0.05, 'pack', NULL, NULL, FALSE),
  ('Chicken Afritada', 'Black Pepper', 0.005, 'kg', NULL, NULL, FALSE),
  -- Classic Dinuguan
  ('Classic Dinuguan', 'Pork Belly', 1, 'kg', NULL, NULL, FALSE),
  ('Classic Dinuguan', 'Pork Intestines', 0.3, 'kg', NULL, NULL, FALSE),
  ('Classic Dinuguan', 'Pork Blood', 0.5, 'kg', NULL, NULL, FALSE),
  ('Classic Dinuguan', 'Garlic', 0.04, 'kg', NULL, NULL, FALSE),
  ('Classic Dinuguan', 'Onion', 0.1, 'kg', NULL, NULL, FALSE),
  ('Classic Dinuguan', 'Vinegar', 0.12, 'L', NULL, NULL, FALSE),
  ('Classic Dinuguan', 'Fish Sauce', 0.045, 'L', NULL, NULL, FALSE),
  ('Classic Dinuguan', 'Black Pepper', 0.005, 'kg', NULL, NULL, FALSE),
  ('Classic Dinuguan', 'Long Green Chili', 0.025, 'kg', NULL, NULL, TRUE),
  -- Pork Shanghai
  ('Pork Shanghai', 'Ground Pork', 0.8, 'kg', NULL, NULL, FALSE),
  ('Pork Shanghai', 'Carrots', 0.15, 'kg', NULL, NULL, FALSE),
  ('Pork Shanghai', 'Onion', 0.1, 'kg', NULL, NULL, FALSE),
  ('Pork Shanghai', 'Garlic', 0.03, 'kg', NULL, NULL, FALSE),
  ('Pork Shanghai', 'Spring Onion', 0.5, 'bunch', NULL, NULL, FALSE),
  ('Pork Shanghai', 'Eggs', 1, 'pcs', NULL, NULL, FALSE),
  ('Pork Shanghai', 'Lumpia Wrappers', 0.5, 'pack', NULL, NULL, FALSE),
  ('Pork Shanghai', 'Soy Sauce', 0.03, 'L', NULL, NULL, FALSE),
  ('Pork Shanghai', 'Salt', 0.005, 'kg', NULL, NULL, FALSE),
  ('Pork Shanghai', 'Black Pepper', 0.005, 'kg', NULL, NULL, FALSE),
  ('Pork Shanghai', 'Sweet Chili Sauce', 0.15, 'L', 1, 1, FALSE),
  ('Pork Shanghai', 'Banana Ketchup', 0.15, 'L', 1, 2, FALSE),
  -- Vegetable Spring Roll
  ('Vegetable Spring Roll', 'Cabbage', 0.3, 'kg', NULL, NULL, FALSE),
  ('Vegetable Spring Roll', 'Carrots', 0.2, 'kg', NULL, NULL, FALSE),
  ('Vegetable Spring Roll', 'Bean Sprouts', 0.25, 'kg', NULL, NULL, FALSE),
  ('Vegetable Spring Roll', 'Green Beans', 0.15, 'kg', NULL, NULL, FALSE),
  ('Vegetable Spring Roll', 'Onion', 0.1, 'kg', NULL, NULL, FALSE),
  ('Vegetable Spring Roll', 'Garlic', 0.03, 'kg', NULL, NULL, FALSE),
  ('Vegetable Spring Roll', 'Lumpia Wrappers', 0.35, 'pack', NULL, NULL, FALSE),
  ('Vegetable Spring Roll', 'Soy Sauce', 0.03, 'L', NULL, NULL, FALSE),
  ('Vegetable Spring Roll', 'Salt', 0.005, 'kg', NULL, NULL, FALSE),
  ('Vegetable Spring Roll', 'Black Pepper', 0.005, 'kg', NULL, NULL, FALSE),
  ('Vegetable Spring Roll', 'Sweet Chili Sauce', 0.15, 'L', NULL, NULL, FALSE),
  -- Vegetable Okoy
  ('Vegetable Okoy', 'Bean Sprouts', 0.3, 'kg', NULL, NULL, FALSE),
  ('Vegetable Okoy', 'Kalabasa (Squash)', 0.25, 'kg', 1, 1, FALSE),
  ('Vegetable Okoy', 'Sweet Potato', 0.25, 'kg', 1, 2, FALSE),
  ('Vegetable Okoy', 'Carrots', 0.15, 'kg', NULL, NULL, FALSE),
  ('Vegetable Okoy', 'Spring Onion', 0.5, 'bunch', NULL, NULL, FALSE),
  ('Vegetable Okoy', 'All-Purpose Flour', 0.15, 'kg', NULL, NULL, FALSE),
  ('Vegetable Okoy', 'Cornstarch', 0.05, 'kg', NULL, NULL, FALSE),
  ('Vegetable Okoy', 'Salt', 0.01, 'kg', NULL, NULL, FALSE),
  ('Vegetable Okoy', 'Black Pepper', 0.005, 'kg', NULL, NULL, FALSE),
  ('Vegetable Okoy', 'Vinegar', 0.15, 'L', NULL, NULL, FALSE),
  -- Torta Talong
  ('Torta Talong', 'Eggplant', 1, 'kg', NULL, NULL, FALSE),
  ('Torta Talong', 'Eggs', 6, 'pcs', NULL, NULL, FALSE),
  ('Torta Talong', 'Cooking Oil', 0.15, 'L', NULL, NULL, FALSE),
  ('Torta Talong', 'Salt', 0.01, 'kg', NULL, NULL, FALSE),
  ('Torta Talong', 'Black Pepper', 0.005, 'kg', NULL, NULL, FALSE),
  ('Torta Talong', 'Banana Ketchup', 0.1, 'L', NULL, NULL, TRUE),
  -- Kwek-Kwek
  ('Kwek-Kwek', 'Quail Eggs', 30, 'pcs', NULL, NULL, FALSE),
  ('Kwek-Kwek', 'All-Purpose Flour', 0.2, 'kg', NULL, NULL, FALSE),
  ('Kwek-Kwek', 'Cornstarch', 0.05, 'kg', NULL, NULL, FALSE),
  ('Kwek-Kwek', 'Annatto (Atsuete)', 0.01, 'kg', NULL, NULL, FALSE),
  ('Kwek-Kwek', 'Salt', 0.01, 'kg', NULL, NULL, FALSE),
  ('Kwek-Kwek', 'Black Pepper', 0.005, 'kg', NULL, NULL, FALSE),
  ('Kwek-Kwek', 'Vinegar', 0.2, 'L', 1, 1, FALSE),
  ('Kwek-Kwek', 'Sweet Chili Sauce', 0.2, 'L', 1, 2, FALSE),
  -- Embutido
  ('Embutido', 'Ground Pork', 1, 'kg', NULL, NULL, FALSE),
  ('Embutido', 'Carrots', 0.15, 'kg', NULL, NULL, FALSE),
  ('Embutido', 'Onion', 0.1, 'kg', NULL, NULL, FALSE),
  ('Embutido', 'Garlic', 0.03, 'kg', NULL, NULL, FALSE),
  ('Embutido', 'Eggs', 3, 'pcs', NULL, NULL, FALSE),
  ('Embutido', 'Raisins', 0.05, 'kg', NULL, NULL, FALSE),
  ('Embutido', 'Pickle Relish', 0.06, 'jar', NULL, NULL, FALSE),
  ('Embutido', 'Hotdog', 0.2, 'pack', NULL, NULL, FALSE),
  ('Embutido', 'Cheese', 0.1, 'kg', NULL, NULL, TRUE),
  ('Embutido', 'Soy Sauce', 0.03, 'L', NULL, NULL, FALSE),
  ('Embutido', 'Salt', 0.01, 'kg', NULL, NULL, FALSE),
  ('Embutido', 'Black Pepper', 0.005, 'kg', NULL, NULL, FALSE),
  -- Chicharon Bulaklak
  ('Chicharon Bulaklak', 'Pork Intestines', 1.5, 'kg', NULL, NULL, FALSE),
  ('Chicharon Bulaklak', 'Salt', 0.02, 'kg', NULL, NULL, FALSE),
  ('Chicharon Bulaklak', 'Garlic', 0.04, 'kg', NULL, NULL, FALSE),
  ('Chicharon Bulaklak', 'Bay Leaves', 0.05, 'pack', NULL, NULL, FALSE),
  ('Chicharon Bulaklak', 'Black Pepper', 0.01, 'kg', NULL, NULL, FALSE),
  ('Chicharon Bulaklak', 'Vinegar', 0.15, 'L', NULL, NULL, FALSE),
  -- Beef Mami
  ('Beef Mami', 'Beef Brisket', 1, 'kg', 1, 1, FALSE),
  ('Beef Mami', 'Beef Shank (with Marrow)', 1, 'kg', 1, 2, FALSE),
  ('Beef Mami', 'Egg Noodles', 1, 'kg', NULL, NULL, FALSE),
  ('Beef Mami', 'Beef Broth', 2.5, 'L', NULL, NULL, FALSE),
  ('Beef Mami', 'Cabbage', 0.25, 'kg', NULL, NULL, FALSE),
  ('Beef Mami', 'Carrots', 0.15, 'kg', NULL, NULL, FALSE),
  ('Beef Mami', 'Garlic', 0.04, 'kg', NULL, NULL, FALSE),
  ('Beef Mami', 'Onion', 0.1, 'kg', NULL, NULL, FALSE),
  ('Beef Mami', 'Spring Onion', 0.5, 'bunch', NULL, NULL, FALSE),
  ('Beef Mami', 'Eggs', 5, 'pcs', NULL, NULL, TRUE),
  ('Beef Mami', 'Star Anise', 0.05, 'pack', NULL, NULL, FALSE),
  ('Beef Mami', 'Beef Seasoning Cube', 0.2, 'pack', NULL, NULL, FALSE),
  ('Beef Mami', 'Salt', 0.01, 'kg', NULL, NULL, FALSE),
  ('Beef Mami', 'Black Pepper', 0.005, 'kg', NULL, NULL, FALSE),
  ('Beef Mami', 'Soy Sauce', 0.045, 'L', 2, 1, FALSE),
  ('Beef Mami', 'Fish Sauce', 0.045, 'L', 2, 2, FALSE),
  -- Special Bulalo
  ('Special Bulalo', 'Beef Shank (with Marrow)', 2, 'kg', NULL, NULL, FALSE),
  ('Special Bulalo', 'Cabbage', 0.3, 'kg', 1, 1, FALSE),
  ('Special Bulalo', 'Pechay', 1, 'bunch', 1, 2, FALSE),
  ('Special Bulalo', 'Corn', 3, 'pcs', NULL, NULL, FALSE),
  ('Special Bulalo', 'Onion', 0.15, 'kg', NULL, NULL, FALSE),
  ('Special Bulalo', 'Whole Peppercorn', 0.01, 'kg', NULL, NULL, FALSE),
  ('Special Bulalo', 'Fish Sauce', 0.06, 'L', NULL, NULL, FALSE),
  ('Special Bulalo', 'Salt', 0.015, 'kg', NULL, NULL, FALSE),
  ('Special Bulalo', 'Calamansi', 0.1, 'kg', NULL, NULL, FALSE),
  ('Special Bulalo', 'Chili Peppers', 0.015, 'kg', NULL, NULL, FALSE),
  -- Ube Bar
  ('Ube Bar', 'Ube Halaya', 0.4, 'kg', 1, 1, FALSE),
  ('Ube Bar', 'Ube (Purple Yam)', 0.4, 'kg', 1, 2, FALSE),
  ('Ube Bar', 'All-Purpose Flour', 0.25, 'kg', NULL, NULL, FALSE),
  ('Ube Bar', 'Eggs', 3, 'pcs', NULL, NULL, FALSE),
  ('Ube Bar', 'Butter', 0.12, 'kg', 2, 1, FALSE),
  ('Ube Bar', 'Cooking Oil', 0.12, 'L', 2, 2, FALSE),
  ('Ube Bar', 'White Sugar', 0.15, 'kg', NULL, NULL, FALSE),
  ('Ube Bar', 'Milk', 0.12, 'L', NULL, NULL, FALSE),
  ('Ube Bar', 'Vanilla Extract', 0.005, 'bottle', NULL, NULL, FALSE),
  ('Ube Bar', 'Condensed Milk', 0.06, 'can', 3, 1, FALSE),
  ('Ube Bar', 'Ube Flavoring', 0.005, 'bottle', 3, 2, FALSE),
  -- Fruit Salad
  ('Fruit Salad', 'Canned Fruit Cocktail', 1, 'can', NULL, NULL, FALSE),
  ('Fruit Salad', 'Table Cream', 2, 'can', 1, 1, FALSE),
  ('Fruit Salad', 'All-Purpose Cream', 2, 'pack', 1, 2, FALSE),
  ('Fruit Salad', 'Condensed Milk', 1, 'can', NULL, NULL, FALSE),
  ('Fruit Salad', 'Kaong', 0.15, 'jar', 2, 1, TRUE),
  ('Fruit Salad', 'Nata de Coco', 0.15, 'jar', 2, 2, TRUE),
  -- Leche Flan
  ('Leche Flan', 'Eggs', 10, 'pcs', NULL, NULL, FALSE),
  ('Leche Flan', 'Condensed Milk', 1, 'can', NULL, NULL, FALSE),
  ('Leche Flan', 'Evaporated Milk', 1, 'can', NULL, NULL, FALSE),
  ('Leche Flan', 'White Sugar', 0.15, 'kg', NULL, NULL, FALSE),
  ('Leche Flan', 'Vanilla Extract', 0.005, 'bottle', NULL, NULL, TRUE),
  -- Mango Graham
  ('Mango Graham', 'Ripe Mangoes', 1, 'kg', NULL, NULL, FALSE),
  ('Mango Graham', 'Graham Crackers', 2, 'pack', NULL, NULL, FALSE),
  ('Mango Graham', 'All-Purpose Cream', 2, 'pack', NULL, NULL, FALSE),
  ('Mango Graham', 'Condensed Milk', 1, 'can', NULL, NULL, FALSE),
  ('Mango Graham', 'Vanilla Extract', 0.005, 'bottle', NULL, NULL, TRUE),
  -- Macaroni Salad
  ('Macaroni Salad', 'Elbow Macaroni', 0.5, 'kg', NULL, NULL, FALSE),
  ('Macaroni Salad', 'Mayonnaise', 0.35, 'kg', NULL, NULL, FALSE),
  ('Macaroni Salad', 'Condensed Milk', 0.15, 'can', NULL, NULL, FALSE),
  ('Macaroni Salad', 'Table Cream', 1, 'can', NULL, NULL, FALSE),
  ('Macaroni Salad', 'Cheese', 0.15, 'kg', NULL, NULL, FALSE),
  ('Macaroni Salad', 'Canned Fruit Cocktail', 0.5, 'can', 1, 1, FALSE),
  ('Macaroni Salad', 'Chicken', 0.25, 'kg', 1, 2, FALSE),
  ('Macaroni Salad', 'Salt', 0.005, 'kg', NULL, NULL, FALSE),
  ('Macaroni Salad', 'White Sugar', 0.03, 'kg', NULL, NULL, FALSE),
  ('Macaroni Salad', 'Pickle Relish', 0.06, 'jar', NULL, NULL, TRUE);

-- Checks: every dish and ingredient must exist, and the unit in the PDF must match the system
DO $$
DECLARE
    bad TEXT;
BEGIN
    SELECT string_agg(DISTINCT s.dish, ', ') INTO bad
      FROM recipe_src s
      LEFT JOIN items i ON i.name = s.dish AND i.item_type = 'food'
     WHERE i.id IS NULL;
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'These dishes are not in the system (load the real items first): %', bad;
    END IF;

    SELECT string_agg(DISTINCT s.ingredient, ', ') INTO bad
      FROM recipe_src s
      LEFT JOIN items i ON i.name = s.ingredient AND i.item_type = 'ingredient'
     WHERE i.id IS NULL;
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'These ingredients are not in the system: %', bad;
    END IF;

    SELECT string_agg(DISTINCT s.ingredient || ' (recipe says ' || s.unit || ', system says ' || i.unit || ')', ', ')
      INTO bad
      FROM recipe_src s
      JOIN items i ON i.name = s.ingredient AND i.item_type = 'ingredient'
     WHERE i.unit <> s.unit;
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'The unit does not match the system for: %', bad;
    END IF;
END
$$;

-- Replace the recipes of the dishes above, then load them
DELETE FROM recipe_ingredients
 WHERE menu_item_id IN (SELECT i.id
                          FROM items i
                         WHERE i.item_type = 'food'
                           AND i.name IN (SELECT dish FROM recipe_src));

INSERT INTO recipe_ingredients (menu_item_id, ingredient_item_id, qty_per_tray, is_optional, alt_group, alt_rank)
SELECT m.id, g.id, s.qty_per_tray, s.is_optional, s.alt_group, s.alt_rank
  FROM recipe_src s
  JOIN items m ON m.name = s.dish       AND m.item_type = 'food'
  JOIN items g ON g.name = s.ingredient AND g.item_type = 'ingredient'
 ORDER BY m.id, s.alt_group NULLS FIRST, s.alt_rank;

INSERT INTO audit_log (username, action, entity, details)
SELECT 'script', 'recipes.import', 'recipe',
       jsonb_build_object('dishes', COUNT(DISTINCT dish), 'lines', COUNT(*))
  FROM recipe_src;

COMMIT;

-- Summary
SELECT COUNT(DISTINCT menu_item_id)                  AS dishes_with_recipe,
       COUNT(*)                                      AS recipe_lines,
       COUNT(*) FILTER (WHERE is_optional)           AS optional_lines,
       COUNT(*) FILTER (WHERE alt_group IS NOT NULL) AS lines_in_or_groups
  FROM recipe_ingredients;

-- Dishes that still have no recipe (a dish added later in the app has none until one is loaded)
SELECT name AS dish_without_recipe
  FROM items
 WHERE item_type = 'food' AND is_active
   AND id NOT IN (SELECT menu_item_id FROM recipe_ingredients)
 ORDER BY name;
