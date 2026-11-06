-- The backend connects as mk_app. It gets only what it needs.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mk_app') THEN
        RAISE EXCEPTION 'Role mk_app does not exist. Create it first (Stage B1, Step 4).';
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO mk_app;

-- Read and change
GRANT SELECT, INSERT, UPDATE ON users, categories, items, inventory_batches, orders TO mk_app;
GRANT SELECT, UPDATE ON counters TO mk_app;

-- Add only: no edits and no deletes
GRANT SELECT, INSERT ON order_items, payments, stock_movements, audit_log TO mk_app;

-- Nothing is ever deleted by the app (no DELETE privilege anywhere)

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mk_app;
GRANT SELECT ON v_item_stock, v_batch_status, v_daily_sales, v_item_sales TO mk_app;

REVOKE EXECUTE ON FUNCTION fn_consume_stock(INTEGER, NUMERIC, INTEGER, INTEGER, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_next_order_number() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_consume_stock(INTEGER, NUMERIC, INTEGER, INTEGER, TEXT) TO mk_app;
GRANT EXECUTE ON FUNCTION fn_next_order_number() TO mk_app;