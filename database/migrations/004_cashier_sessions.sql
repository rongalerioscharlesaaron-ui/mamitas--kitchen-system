-- A cashier session is one shift at one drawer: opening cash and Time IN at the start,
-- counted cash and Time OUT at the end.
CREATE TABLE cashier_sessions (
    id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cashier_id      INTEGER       NOT NULL REFERENCES users (id),
    opened_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    opening_cash    NUMERIC(10,2) NOT NULL CHECK (opening_cash >= 0),
    closed_at       TIMESTAMPTZ,
    expected_cash   NUMERIC(10,2),
    counted_cash    NUMERIC(10,2) CHECK (counted_cash >= 0),
    cash_difference NUMERIC(10,2),
    close_note      TEXT,
    CONSTRAINT sessions_close_all_or_none CHECK (
        (closed_at IS NULL AND expected_cash IS NULL AND counted_cash IS NULL AND cash_difference IS NULL)
        OR (closed_at IS NOT NULL AND expected_cash IS NOT NULL
            AND counted_cash IS NOT NULL AND cash_difference IS NOT NULL)
    ),
    CONSTRAINT sessions_close_after_open CHECK (closed_at IS NULL OR closed_at >= opened_at)
);

-- A cashier can have only one open session at a time
CREATE UNIQUE INDEX sessions_one_open_per_cashier ON cashier_sessions (cashier_id) WHERE closed_at IS NULL;
CREATE INDEX sessions_opened_idx ON cashier_sessions (opened_at DESC);

ALTER TABLE orders ADD COLUMN session_id INTEGER REFERENCES cashier_sessions (id);
CREATE INDEX orders_session_idx ON orders (session_id);

-- Every new order must belong to its cashier's open session
CREATE OR REPLACE FUNCTION fn_require_session() RETURNS trigger AS $$
BEGIN
    IF NEW.session_id IS NULL THEN
        RAISE EXCEPTION 'An order needs an open cash session' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM cashier_sessions
     WHERE id = NEW.session_id AND cashier_id = NEW.cashier_id AND closed_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The cash session is closed or belongs to another cashier' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_require_session
    BEFORE INSERT ON orders
    FOR EACH ROW EXECUTE FUNCTION fn_require_session();

-- One row per session with its totals. Estimated cash = opening cash + cash sales
-- (change given back is already left out, because an order's total is what the till keeps).
CREATE OR REPLACE VIEW v_session_summary AS
SELECT s.id AS session_id,
       s.cashier_id,
       u.full_name AS cashier,
       s.opened_at,
       (s.opened_at AT TIME ZONE 'Asia/Singapore')::date AS opened_date,
       s.opening_cash,
       s.closed_at,
       s.expected_cash,
       s.counted_cash,
       s.cash_difference,
       s.close_note,
       COUNT(o.id) AS orders,
       COALESCE(SUM(o.total), 0) AS net_sales,
       COALESCE(SUM(o.total) FILTER (WHERE p.method = 'cash'), 0)   AS cash_sales,
       COALESCE(SUM(o.total) FILTER (WHERE p.method = 'paynow'), 0) AS paynow_sales,
       COALESCE(SUM(o.total) FILTER (WHERE p.method = 'card'), 0)   AS card_sales,
       s.opening_cash + COALESCE(SUM(o.total) FILTER (WHERE p.method = 'cash'), 0) AS expected_now
  FROM cashier_sessions s
  JOIN users u ON u.id = s.cashier_id
  LEFT JOIN orders o ON o.session_id = s.id
  LEFT JOIN payments p ON p.order_id = o.id
 GROUP BY s.id, u.full_name;

GRANT SELECT, INSERT, UPDATE ON cashier_sessions TO mk_app;
GRANT SELECT ON v_session_summary TO mk_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mk_app;