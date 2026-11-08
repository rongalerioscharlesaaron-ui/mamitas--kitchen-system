-- Lets the POS safely retry or double-click: the same request ID can only create one order.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS orders_client_request_key
    ON orders (client_request_id)
    WHERE client_request_id IS NOT NULL;