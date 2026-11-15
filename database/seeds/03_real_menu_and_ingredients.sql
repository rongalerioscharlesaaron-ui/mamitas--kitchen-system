-- Mamitas Kitchen: real dishes and ingredients (from the owner's list).
-- WARNING: deletes ALL items, batches, stock movements, and orders in this database.
-- Users and the activity log are kept. Take a backup first.
\set ON_ERROR_STOP on
BEGIN;

TRUNCATE stock_movements, payments, order_items, orders, inventory_batches, items, categories
    RESTART IDENTITY;
ALTER SEQUENCE batch_code_seq RESTART WITH 1;
UPDATE counters SET last_value = 0 WHERE name = 'order_number';

INSERT INTO categories (name, kind) VALUES
    ('Wet ingredients',        'ingredient'),
    ('Dry ingredients',        'ingredient'),
    ('Meat',                   'ingredient'),
    ('Main dishes',            'food'),
    ('Snacks and appetizers',  'food'),
    ('Soup and noodle dishes', 'food'),
    ('Desserts',               'food'),
    ('Food trays',             'food_tray');

-- ---------- Ingredients: name, category, unit, has an expiry date ----------
INSERT INTO items (name, item_type, category_id, unit, min_level, has_expiry)
SELECT v.name, 'ingredient'::item_type, c.id, v.unit, 0, v.has_expiry
FROM (VALUES
  -- Meat
  ('Pork Pata',                  'Meat', 'kg',   TRUE),
  ('Pork Spareribs',             'Meat', 'kg',   TRUE),
  ('Pork Belly',                 'Meat', 'kg',   TRUE),
  ('Bagnet (Crispy Pork Belly)', 'Meat', 'kg',   TRUE),
  ('Pork',                       'Meat', 'kg',   TRUE),
  ('Ground Pork',                'Meat', 'kg',   TRUE),
  ('Pork Lungs',                 'Meat', 'kg',   TRUE),
  ('Pork Heart',                 'Meat', 'kg',   TRUE),
  ('Pork Liver',                 'Meat', 'kg',   TRUE),
  ('Pork Intestines',            'Meat', 'kg',   TRUE),
  ('Pork Blood',                 'Meat', 'kg',   TRUE),
  ('Beef',                       'Meat', 'kg',   TRUE),
  ('Beef Slices',                'Meat', 'kg',   TRUE),
  ('Beef Brisket',               'Meat', 'kg',   TRUE),
  ('Beef Shank (with Marrow)',   'Meat', 'kg',   TRUE),
  ('Chicken',                    'Meat', 'kg',   TRUE),
  ('Bangus',                     'Meat', 'kg',   TRUE),
  ('Shrimp',                     'Meat', 'kg',   TRUE),
  ('Hotdog',                     'Meat', 'pack', TRUE),
  -- Wet: eggs and dairy
  ('Eggs',              'Wet ingredients', 'pcs',  TRUE),
  ('Quail Eggs',        'Wet ingredients', 'pcs',  TRUE),
  ('Milk',              'Wet ingredients', 'L',    TRUE),
  ('Butter',            'Wet ingredients', 'kg',   TRUE),
  ('Cheese',            'Wet ingredients', 'kg',   TRUE),
  ('Condensed Milk',    'Wet ingredients', 'can',  TRUE),
  ('Evaporated Milk',   'Wet ingredients', 'can',  TRUE),
  ('Table Cream',       'Wet ingredients', 'can',  TRUE),
  ('All-Purpose Cream', 'Wet ingredients', 'pack', TRUE),
  -- Wet: oils, sauces, pastes, canned and bottled
  ('Cooking Oil',          'Wet ingredients', 'L',      TRUE),
  ('Sesame Oil',           'Wet ingredients', 'L',      TRUE),
  ('Soy Sauce',            'Wet ingredients', 'L',      TRUE),
  ('Fish Sauce',           'Wet ingredients', 'L',      TRUE),
  ('Oyster Sauce',         'Wet ingredients', 'L',      TRUE),
  ('Vinegar',              'Wet ingredients', 'L',      FALSE),
  ('Tomato Sauce',         'Wet ingredients', 'L',      TRUE),
  ('Liver Spread',         'Wet ingredients', 'kg',     TRUE),
  ('Peanut Butter',        'Wet ingredients', 'kg',     TRUE),
  ('Bagoong Alamang',      'Wet ingredients', 'kg',     TRUE),
  ('Bagoong Isda',         'Wet ingredients', 'kg',     TRUE),
  ('Mayonnaise',           'Wet ingredients', 'kg',     TRUE),
  ('Banana Ketchup',       'Wet ingredients', 'L',      TRUE),
  ('Sweet Chili Sauce',    'Wet ingredients', 'L',      TRUE),
  ('Calamansi Juice',      'Wet ingredients', 'L',      TRUE),
  ('Coconut Milk',         'Wet ingredients', 'L',      TRUE),
  ('Beef Broth',           'Wet ingredients', 'L',      TRUE),
  ('Vanilla Extract',      'Wet ingredients', 'bottle', TRUE),
  ('Pickle Relish',        'Wet ingredients', 'jar',    TRUE),
  ('Ube Flavoring',        'Wet ingredients', 'bottle', TRUE),
  ('Ube Halaya',           'Wet ingredients', 'kg',     TRUE),
  ('Canned Fruit Cocktail','Wet ingredients', 'can',    TRUE),
  ('Nata de Coco',         'Wet ingredients', 'jar',    TRUE),
  ('Kaong',                'Wet ingredients', 'jar',    TRUE),
  -- Wet: fresh vegetables and fruit
  ('Eggplant',              'Wet ingredients', 'kg',    TRUE),
  ('Sitaw (String Beans)',  'Wet ingredients', 'bunch', TRUE),
  ('Pechay',                'Wet ingredients', 'bunch', TRUE),
  ('Banana Blossom',        'Wet ingredients', 'pcs',   TRUE),
  ('Potatoes',              'Wet ingredients', 'kg',    TRUE),
  ('Carrots',               'Wet ingredients', 'kg',    TRUE),
  ('Bell Pepper',           'Wet ingredients', 'kg',    TRUE),
  ('Onion',                 'Wet ingredients', 'kg',    TRUE),
  ('Garlic',                'Wet ingredients', 'kg',    TRUE),
  ('Tomato',                'Wet ingredients', 'kg',    TRUE),
  ('Chili Peppers',         'Wet ingredients', 'kg',    TRUE),
  ('Long Green Chili',      'Wet ingredients', 'kg',    TRUE),
  ('Calamansi',             'Wet ingredients', 'kg',    TRUE),
  ('Spring Onion',          'Wet ingredients', 'bunch', TRUE),
  ('Ampalaya',              'Wet ingredients', 'kg',    TRUE),
  ('Okra',                  'Wet ingredients', 'kg',    TRUE),
  ('Kalabasa (Squash)',     'Wet ingredients', 'kg',    TRUE),
  ('Cabbage',               'Wet ingredients', 'kg',    TRUE),
  ('Cauliflower',           'Wet ingredients', 'kg',    TRUE),
  ('Broccoli',              'Wet ingredients', 'kg',    TRUE),
  ('Sayote',                'Wet ingredients', 'kg',    TRUE),
  ('Malunggay',             'Wet ingredients', 'bunch', TRUE),
  ('Spinach',               'Wet ingredients', 'bunch', TRUE),
  ('Radish',                'Wet ingredients', 'kg',    TRUE),
  ('Kangkong',              'Wet ingredients', 'bunch', TRUE),
  ('Gabi (Taro)',           'Wet ingredients', 'kg',    TRUE),
  ('Ginger',                'Wet ingredients', 'kg',    TRUE),
  ('Bean Sprouts',          'Wet ingredients', 'kg',    TRUE),
  ('Green Beans',           'Wet ingredients', 'kg',    TRUE),
  ('Sweet Potato',          'Wet ingredients', 'kg',    TRUE),
  ('Mushrooms',             'Wet ingredients', 'kg',    TRUE),
  ('Green Peas',            'Wet ingredients', 'kg',    TRUE),
  ('Corn',                  'Wet ingredients', 'pcs',   TRUE),
  ('Ripe Mangoes',          'Wet ingredients', 'kg',    TRUE),
  ('Tamarind',              'Wet ingredients', 'kg',    TRUE),
  ('Ube (Purple Yam)',      'Wet ingredients', 'kg',    TRUE),
  -- Dry
  ('Salt',                'Dry ingredients', 'kg',   FALSE),
  ('White Sugar',         'Dry ingredients', 'kg',   FALSE),
  ('Brown Sugar',         'Dry ingredients', 'kg',   FALSE),
  ('Black Pepper',        'Dry ingredients', 'kg',   FALSE),
  ('Whole Peppercorn',    'Dry ingredients', 'kg',   FALSE),
  ('Cornstarch',          'Dry ingredients', 'kg',   FALSE),
  ('Bay Leaves',          'Dry ingredients', 'pack', FALSE),
  ('Star Anise',          'Dry ingredients', 'pack', FALSE),
  ('All-Purpose Flour',   'Dry ingredients', 'kg',   TRUE),
  ('Annatto (Atsuete)',   'Dry ingredients', 'kg',   TRUE),
  ('Mung Beans',          'Dry ingredients', 'kg',   TRUE),
  ('Egg Noodles',         'Dry ingredients', 'kg',   TRUE),
  ('Elbow Macaroni',      'Dry ingredients', 'kg',   TRUE),
  ('Lumpia Wrappers',     'Dry ingredients', 'pack', TRUE),
  ('Graham Crackers',     'Dry ingredients', 'pack', TRUE),
  ('Raisins',             'Dry ingredients', 'kg',   TRUE),
  ('Sinigang Mix',        'Dry ingredients', 'pack', TRUE),
  ('Beef Seasoning Cube', 'Dry ingredients', 'pack', TRUE)
) AS v(name, category, unit, has_expiry)
JOIN categories c ON c.name = v.category AND c.kind = 'ingredient';

-- ---------- Dishes: sold per serving. Prices are PLACEHOLDERS (0.01) ----------
INSERT INTO items (name, item_type, category_id, unit, min_level, has_expiry, price)
SELECT v.name, 'food'::item_type, c.id, 'servings', 0, FALSE, 0.01
FROM (VALUES
  ('Kare-Kare (Pork Pata)',        'Main dishes'),
  ('Kaldereta Spareribs',          'Main dishes'),
  ('Binagoongan',                  'Main dishes'),
  ('Sarsiado Bangus',              'Main dishes'),
  ('Giniling na Baboy',            'Main dishes'),
  ('Sisig Bagnet',                 'Main dishes'),
  ('Pakbet',                       'Main dishes'),
  ('Chop Suey',                    'Main dishes'),
  ('Monggo',                       'Main dishes'),
  ('Lechon Kawali',                'Main dishes'),
  ('Bicol Express',                'Main dishes'),
  ('Bopis',                        'Main dishes'),
  ('Beef Mushroom',                'Main dishes'),
  ('Menudo',                       'Main dishes'),
  ('Sinigang na Baboy',            'Main dishes'),
  ('Ginataang Sitaw at Kalabasa',  'Main dishes'),
  ('Paksiw na Pata',               'Main dishes'),
  ('Pork Mechado',                 'Main dishes'),
  ('Bistek Tagalog',               'Main dishes'),
  ('Paksiw na Bangus',             'Main dishes'),
  ('Beef Broccoli',                'Main dishes'),
  ('Chicken Afritada',             'Main dishes'),
  ('Classic Dinuguan',             'Main dishes'),
  ('Pork Shanghai',                'Snacks and appetizers'),
  ('Vegetable Spring Roll',        'Snacks and appetizers'),
  ('Vegetable Okoy',               'Snacks and appetizers'),
  ('Torta Talong',                 'Snacks and appetizers'),
  ('Kwek-Kwek',                    'Snacks and appetizers'),
  ('Embutido',                     'Snacks and appetizers'),
  ('Chicharon Bulaklak',           'Snacks and appetizers'),
  ('Beef Mami',                    'Soup and noodle dishes'),
  ('Special Bulalo',               'Soup and noodle dishes'),
  ('Ube Bar',                      'Desserts'),
  ('Fruit Salad',                  'Desserts'),
  ('Leche Flan',                   'Desserts'),
  ('Mango Graham',                 'Desserts'),
  ('Macaroni Salad',               'Desserts')
) AS v(name, category)
JOIN categories c ON c.name = v.category AND c.kind = 'food';

-- Safety check: a typo in a category name would silently drop rows, so stop if the counts are off
DO $$
BEGIN
    IF (SELECT COUNT(*) FROM items WHERE item_type = 'ingredient') <> 106 THEN
        RAISE EXCEPTION 'Expected 106 ingredients, found %',
            (SELECT COUNT(*) FROM items WHERE item_type = 'ingredient');
    END IF;
    IF (SELECT COUNT(*) FROM items WHERE item_type = 'food') <> 37 THEN
        RAISE EXCEPTION 'Expected 37 dishes, found %',
            (SELECT COUNT(*) FROM items WHERE item_type = 'food');
    END IF;
END
$$;

COMMIT;