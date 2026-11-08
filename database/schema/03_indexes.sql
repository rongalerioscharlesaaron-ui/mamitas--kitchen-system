-- Speeds up the queries the app runs most

-- FIFO: find the oldest batch that still has stock
CREATE INDEX batches_fifo_idx ON inventory_batches (item_id, received_date, id)
    WHERE qty_remaining > 0;

-- Expiration monitoring
CREATE INDEX batches_expiry_idx ON inventory_batches (expiry_date)
    WHERE expiry_date IS NOT NULL AND qty_remaining > 0;

CREATE INDEX movements_batch_idx   ON stock_movements (batch_id);
CREATE INDEX movements_item_idx    ON stock_movements (item_id, created_at DESC);
CREATE INDEX movements_created_idx ON stock_movements (created_at DESC);

CREATE INDEX orders_created_idx ON orders (created_at DESC);
CREATE INDEX orders_status_idx  ON orders (status);
CREATE INDEX order_items_order_idx ON order_items (order_id);
CREATE INDEX order_items_item_idx  ON order_items (item_id);

CREATE INDEX audit_created_idx ON audit_log (created_at DESC);
CREATE INDEX audit_user_idx    ON audit_log (user_id);