CREATE TABLE IF NOT EXISTS shop_settings (
    id                  SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    name                TEXT          NOT NULL DEFAULT 'Mamitas’ Kitchen',
    location            TEXT          NOT NULL DEFAULT 'Singapore',
    currency            TEXT          NOT NULL DEFAULT 'SGD',
    gst_registered      BOOLEAN       NOT NULL DEFAULT FALSE,
    gst_rate            NUMERIC(5,4)  NOT NULL DEFAULT 0.0900 CHECK (gst_rate >= 0 AND gst_rate <= 1),
    gst_reg_no          TEXT          NOT NULL DEFAULT '',
    expiry_warning_days SMALLINT      NOT NULL DEFAULT 3 CHECK (expiry_warning_days BETWEEN 1 AND 30),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

INSERT INTO shop_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

GRANT SELECT, INSERT, UPDATE ON shop_settings TO mk_app;