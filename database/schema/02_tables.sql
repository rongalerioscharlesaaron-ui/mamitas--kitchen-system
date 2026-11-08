-- =====================================================================
-- Mamitas Kitchen: tables
-- =====================================================================

-- ---------- Users: login accounts ----------
CREATE TABLE users (
    id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username       TEXT        NOT NULL,
    password_hash  TEXT        NOT NULL,
    full_name      TEXT        NOT NULL,
    role           user_role   NOT NULL,
    is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
    failed_logins  SMALLINT    NOT NULL DEFAULT 0 CHECK (failed_logins >= 0),
    locked_until   TIMESTAMPTZ,
    last_login_at  TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_username_length CHECK (length(btrim(username)) >= 3)
);
CREATE UNIQUE INDEX users_username_unique ON users (lower(username));

-- ---------- Categories: Wet/Dry/Meat for ingredients, menu categories for foods ----------
CREATE TABLE categories (
    id    SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name  TEXT      NOT NULL UNIQUE,
    kind  item_type NOT NULL,
    CONSTRAINT categories_id_kind_key UNIQUE (id, kind)
);

-- ---------- Items: ingredients, foods (servings), and food trays ----------
CREATE TABLE items (
    id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name         TEXT          NOT NULL,
    item_type    item_type     NOT NULL,
    category_id  SMALLINT      NOT NULL,
    unit         TEXT          NOT NULL,
    min_level    NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (min_level >= 0),
    has_expiry   BOOLEAN       NOT NULL DEFAULT FALSE,
    price        NUMERIC(10,2),
    is_active    BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    -- the category must be the right kind for the item (no food inside "Meat")
    CONSTRAINT items_category_fk FOREIGN KEY (category_id, item_type)
        REFERENCES categories (id, kind),
    CONSTRAINT items_name_not_blank CHECK (length(btrim(name)) > 0),
    -- ingredients have no price; foods and trays must have one
    CONSTRAINT items_price_rule CHECK (
        (item_type = 'ingredient' AND price IS NULL)
        OR (item_type <> 'ingredient' AND price IS NOT NULL AND price > 0)
    ),
    -- foods are counted in servings, trays in trays
    CONSTRAINT items_menu_unit_rule CHECK (
        item_type = 'ingredient'
        OR (item_type = 'food' AND unit = 'servings')
        OR (item_type = 'food_tray' AND unit = 'trays')
    ),
    -- the has_expiry flag only applies to ingredients
    CONSTRAINT items_expiry_flag_rule CHECK (item_type = 'ingredient' OR has_expiry = FALSE)
);
CREATE UNIQUE INDEX items_name_unique ON items (lower(name));

-- ---------- Inventory batches: every delivery gets its own batch ID ----------
CREATE SEQUENCE batch_code_seq START 1;

CREATE TABLE inventory_batches (
    id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_code     TEXT          NOT NULL UNIQUE
                   DEFAULT ('B-' || lpad(nextval('batch_code_seq')::text, 4, '0')),
    item_id        INTEGER       NOT NULL REFERENCES items (id),
    qty_received   NUMERIC(12,3) NOT NULL CHECK (qty_received > 0),
    qty_remaining  NUMERIC(12,3) NOT NULL,
    received_date  DATE          NOT NULL DEFAULT CURRENT_DATE,
    expiry_date    DATE,
    created_by     INTEGER       REFERENCES users (id),
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT batches_remaining_range
        CHECK (qty_remaining >= 0 AND qty_remaining <= qty_received),
    CONSTRAINT batches_expiry_after_received
        CHECK (expiry_date IS NULL OR expiry_date >= received_date),
    -- lets stock movements prove that a batch really belongs to its item
    CONSTRAINT batches_id_item_key UNIQUE (id, item_id)
);

-- ---------- Orders ----------
CREATE TABLE orders (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_number  TEXT          NOT NULL UNIQUE,
    order_type    order_type    NOT NULL,
    status        order_status  NOT NULL DEFAULT 'preparing',
    total         NUMERIC(10,2) NOT NULL CHECK (total >= 0),
    gst_amount    NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (gst_amount >= 0),
    cashier_id    INTEGER       NOT NULL REFERENCES users (id),
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    completed_at  TIMESTAMPTZ,
    CONSTRAINT orders_completed_rule
        CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

-- Name and price are copied onto each line, so old receipts never change
-- when the menu price changes later.
CREATE TABLE order_items (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id    INTEGER       NOT NULL REFERENCES orders (id),
    item_id     INTEGER       NOT NULL REFERENCES items (id),
    item_name   TEXT          NOT NULL,
    unit_price  NUMERIC(10,2) NOT NULL CHECK (unit_price > 0),
    qty         INTEGER       NOT NULL CHECK (qty > 0),
    line_total  NUMERIC(10,2) GENERATED ALWAYS AS (unit_price * qty) STORED,
    CONSTRAINT order_items_one_line_per_item UNIQUE (order_id, item_id)
);

CREATE TABLE payments (
    id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id         INTEGER        NOT NULL UNIQUE REFERENCES orders (id),
    method           payment_method NOT NULL,
    amount_due       NUMERIC(10,2)  NOT NULL CHECK (amount_due >= 0),
    amount_tendered  NUMERIC(10,2)  NOT NULL,
    change_given     NUMERIC(10,2)  NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CONSTRAINT payments_enough CHECK (amount_tendered >= amount_due),
    CONSTRAINT payments_change CHECK (change_given = amount_tendered - amount_due),
    CONSTRAINT payments_noncash_exact CHECK (method = 'cash' OR amount_tendered = amount_due)
);

-- ---------- Stock movements: the history of every change ----------
CREATE TABLE stock_movements (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_id        INTEGER       NOT NULL,
    batch_id       INTEGER       NOT NULL,
    movement_type  movement_type NOT NULL,
    qty            NUMERIC(12,3) NOT NULL CHECK (qty > 0),
    reason         TEXT          NOT NULL,
    order_id       INTEGER       REFERENCES orders (id),
    user_id        INTEGER       REFERENCES users (id),
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    -- the batch must belong to the item
    CONSTRAINT stock_movements_batch_fk FOREIGN KEY (batch_id, item_id)
        REFERENCES inventory_batches (id, item_id)
);

-- ---------- Activity log: who did what ----------
CREATE TABLE audit_log (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     INTEGER     REFERENCES users (id),
    username    TEXT,
    action      TEXT        NOT NULL,
    entity      TEXT,
    entity_id   TEXT,
    details     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Counters: gapless order numbers ----------
CREATE TABLE counters (
    name        TEXT    PRIMARY KEY,
    last_value  INTEGER NOT NULL DEFAULT 0
);
INSERT INTO counters (name, last_value) VALUES ('order_number', 0);