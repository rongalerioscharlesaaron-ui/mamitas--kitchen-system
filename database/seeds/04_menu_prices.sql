-- Type the real price of each dish (SGD, GST-inclusive), then run this file.
-- Dishes left at 0.01 are still placeholders.
\set ON_ERROR_STOP on

UPDATE items AS i
   SET price = v.price
  FROM (VALUES
    ('Kare-Kare (Pork Pata)',       0.01),
    ('Kaldereta Spareribs',         0.01),
    ('Binagoongan',                 0.01),
    ('Sarsiado Bangus',             0.01),
    ('Giniling na Baboy',           0.01),
    ('Sisig Bagnet',                0.01),
    ('Pakbet',                      0.01),
    ('Chop Suey',                   0.01),
    ('Monggo',                      0.01),
    ('Lechon Kawali',               0.01),
    ('Bicol Express',               0.01),
    ('Bopis',                       0.01),
    ('Beef Mushroom',               0.01),
    ('Menudo',                      0.01),
    ('Sinigang na Baboy',           0.01),
    ('Ginataang Sitaw at Kalabasa', 0.01),
    ('Paksiw na Pata',              0.01),
    ('Pork Mechado',                0.01),
    ('Bistek Tagalog',              0.01),
    ('Paksiw na Bangus',            0.01),
    ('Beef Broccoli',               0.01),
    ('Chicken Afritada',            0.01),
    ('Classic Dinuguan',            0.01),
    ('Pork Shanghai',               0.01),
    ('Vegetable Spring Roll',       0.01),
    ('Vegetable Okoy',              0.01),
    ('Torta Talong',                0.01),
    ('Kwek-Kwek',                   0.01),
    ('Embutido',                    0.01),
    ('Chicharon Bulaklak',          0.01),
    ('Beef Mami',                   0.01),
    ('Special Bulalo',              0.01),
    ('Ube Bar',                     0.01),
    ('Fruit Salad',                 0.01),
    ('Leche Flan',                  0.01),
    ('Mango Graham',                0.01),
    ('Macaroni Salad',              0.01)
  ) AS v(name, price)
 WHERE i.name = v.name AND i.item_type = 'food';

-- Dishes that still have a placeholder price:
SELECT name FROM items WHERE item_type = 'food' AND price = 0.01 ORDER BY name;