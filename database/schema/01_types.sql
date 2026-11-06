-- Mamitas Kitchen: fixed lists of allowed values
CREATE TYPE user_role      AS ENUM ('cashier', 'kitchen', 'owner');
CREATE TYPE item_type      AS ENUM ('ingredient', 'food', 'food_tray');
CREATE TYPE movement_type  AS ENUM ('IN', 'USED', 'DAMAGED', 'SPOILED', 'ADJUSTMENT');
CREATE TYPE order_type     AS ENUM ('dine_in', 'takeaway');
CREATE TYPE order_status   AS ENUM ('preparing', 'completed');
CREATE TYPE payment_method AS ENUM ('cash', 'paynow', 'card');