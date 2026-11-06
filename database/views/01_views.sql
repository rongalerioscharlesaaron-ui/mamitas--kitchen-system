-- Ready-made queries for the dashboards and pages

-- Stock per item: on hand (all batches) and usable (not expired)
CREATE OR REPLACE VIEW v_item_stock AS
SELECT i.id AS item_id,
       i.name,
       i.item_type,
       c.name AS category,
       i.unit,
       i.min_level,
       i.price,
       i.has_expiry,
       COALESCE(SUM(b.qty_remaining), 0) AS qty_on_hand,
       COALESCE(SUM(b.qty_remaining)
                FILTER (WHERE b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE), 0) AS qty_usable,
       COUNT(b.id) FILTER (WHERE b.qty_remaining > 0) AS open_batches,
       MIN(b.expiry_date) FILTER (WHERE b.qty_remaining > 0 AND b.expiry_date IS NOT NULL) AS next_expiry
FROM items i
JOIN categories c ON c.id = i.category_id
LEFT JOIN inventory_batches b ON b.item_id = i.id
WHERE i.is_active
GROUP BY i.id, c.name;

-- One row per batch with its expiry status ("soon" means within 3 days)
CREATE OR REPLACE VIEW v_batch_status AS
SELECT b.id AS batch_id,
       b.batch_code,
       b.item_id,
       i.name AS item_name,
       i.item_type,
       c.name AS category,
       i.unit,
       b.qty_received,
       b.qty_remaining,
       b.received_date,
       b.expiry_date,
       CASE WHEN b.expiry_date IS NULL THEN NULL
            ELSE b.expiry_date - CURRENT_DATE END AS days_left,
       CASE WHEN b.expiry_date IS NULL THEN 'none'
            WHEN b.expiry_date < CURRENT_DATE THEN 'expired'
            WHEN b.expiry_date <= CURRENT_DATE + 3 THEN 'soon'
            ELSE 'ok' END AS expiry_status
FROM inventory_batches b
JOIN items i ON i.id = b.item_id
JOIN categories c ON c.id = i.category_id;

-- Sales per day (Singapore time)
CREATE OR REPLACE VIEW v_daily_sales AS
SELECT (o.created_at AT TIME ZONE 'Asia/Singapore')::date AS sales_date,
       COUNT(*) AS orders,
       SUM(o.total) AS sales,
       ROUND(AVG(o.total), 2) AS average_order
FROM orders o
GROUP BY 1;

-- Units sold and revenue per item per day (top sellers)
CREATE OR REPLACE VIEW v_item_sales AS
SELECT (o.created_at AT TIME ZONE 'Asia/Singapore')::date AS sales_date,
       oi.item_id,
       oi.item_name,
       SUM(oi.qty) AS qty_sold,
       SUM(oi.line_total) AS revenue
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
GROUP BY 1, oi.item_id, oi.item_name;