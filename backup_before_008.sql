--
-- PostgreSQL database dump
--

\restrict cyD1p8kYqpCLI5kjDwbQuzqnCl4muPvu9cNj9cRiMQy7Sg3Q80sNYUTN0QeIGrC

-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: item_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.item_type AS ENUM (
    'ingredient',
    'food',
    'food_tray'
);


ALTER TYPE public.item_type OWNER TO postgres;

--
-- Name: movement_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.movement_type AS ENUM (
    'IN',
    'USED',
    'DAMAGED',
    'SPOILED',
    'ADJUSTMENT'
);


ALTER TYPE public.movement_type OWNER TO postgres;

--
-- Name: order_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.order_status AS ENUM (
    'preparing',
    'completed'
);


ALTER TYPE public.order_status OWNER TO postgres;

--
-- Name: order_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.order_type AS ENUM (
    'dine_in',
    'takeaway'
);


ALTER TYPE public.order_type OWNER TO postgres;

--
-- Name: payment_method; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.payment_method AS ENUM (
    'cash',
    'paynow',
    'card'
);


ALTER TYPE public.payment_method OWNER TO postgres;

--
-- Name: user_role; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.user_role AS ENUM (
    'cashier',
    'kitchen',
    'owner'
);


ALTER TYPE public.user_role OWNER TO postgres;

--
-- Name: fn_add_menu_trays(integer, integer, integer, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_add_menu_trays(p_item_id integer, p_trays integer, p_user_id integer, p_reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_item        items%ROWTYPE;
    v_servings    INTEGER;
    v_tray_word   TEXT;
    v_plan        JSONB   := '[]'::jsonb;      -- ingredients to take: [{id, name, unit, qty}]
    v_used        JSONB   := '[]'::jsonb;      -- what was really taken
    v_short       TEXT[]  := ARRAY[]::TEXT[];  -- one message per shortage
    v_tried       TEXT[];
    v_picked      BOOLEAN;
    v_have        NUMERIC;
    v_batch_id    INTEGER;
    v_batch_code  TEXT;
    g             RECORD;
    r             RECORD;
BEGIN
    IF p_trays IS NULL OR p_trays < 1 THEN
        RAISE EXCEPTION 'Trays must be a whole number of at least 1';
    END IF;

    SELECT * INTO v_item FROM items WHERE id = p_item_id AND is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Item not found';
    END IF;
    IF v_item.item_type <> 'food' THEN
        RAISE EXCEPTION '"%" is not a dish sold per serving, so it is not added by the tray', v_item.name;
    END IF;

    v_servings  := p_trays * v_item.servings_per_tray;
    v_tray_word := CASE WHEN p_trays = 1 THEN 'tray' ELSE 'trays' END;

    -- Required lines with a single choice
    FOR r IN
        SELECT ri.ingredient_item_id AS id, i.name, i.unit, ri.qty_per_tray * p_trays AS need
          FROM recipe_ingredients ri
          JOIN items i ON i.id = ri.ingredient_item_id
         WHERE ri.menu_item_id = p_item_id
           AND NOT ri.is_optional
           AND ri.alt_group IS NULL
         ORDER BY ri.id
    LOOP
        v_have := fn_usable_qty(r.id);
        IF v_have < r.need THEN
            v_short := v_short || format('%s needs %s %s, only %s %s available',
                                         r.name, fn_fmt_qty(r.need), r.unit, fn_fmt_qty(v_have), r.unit);
        ELSE
            v_plan := v_plan || jsonb_build_object('id', r.id, 'name', r.name, 'unit', r.unit, 'qty', r.need);
        END IF;
    END LOOP;

    -- "This or that" groups: the first choice with enough stock wins
    FOR g IN
        SELECT DISTINCT alt_group
          FROM recipe_ingredients
         WHERE menu_item_id = p_item_id
           AND NOT is_optional
           AND alt_group IS NOT NULL
         ORDER BY alt_group
    LOOP
        v_picked := FALSE;
        v_tried  := ARRAY[]::TEXT[];
        FOR r IN
            SELECT ri.ingredient_item_id AS id, i.name, i.unit, ri.qty_per_tray * p_trays AS need
              FROM recipe_ingredients ri
              JOIN items i ON i.id = ri.ingredient_item_id
             WHERE ri.menu_item_id = p_item_id
               AND NOT ri.is_optional
               AND ri.alt_group = g.alt_group
             ORDER BY ri.alt_rank
        LOOP
            v_have := fn_usable_qty(r.id);
            IF v_have >= r.need THEN
                v_plan   := v_plan || jsonb_build_object('id', r.id, 'name', r.name, 'unit', r.unit, 'qty', r.need);
                v_picked := TRUE;
                EXIT;
            END IF;
            v_tried := v_tried || format('%s needs %s %s, only %s %s available',
                                         r.name, fn_fmt_qty(r.need), r.unit, fn_fmt_qty(v_have), r.unit);
        END LOOP;
        IF NOT v_picked THEN
            v_short := v_short || ('none of these has enough: ' || array_to_string(v_tried, ' / '));
        END IF;
    END LOOP;

    IF cardinality(v_short) > 0 THEN
        RAISE EXCEPTION 'Not enough ingredients for % % of %: %',
            p_trays, v_tray_word, v_item.name, array_to_string(v_short, '; ');
    END IF;

    -- Take the ingredients, oldest batch first. Always in the same order (by item id), so two
    -- cooks at the same moment lock the same batches in the same order and cannot deadlock.
    FOR r IN
        SELECT (e->>'id')::INTEGER AS id, e->>'name' AS name, e->>'unit' AS unit, (e->>'qty')::NUMERIC AS qty
          FROM jsonb_array_elements(v_plan) AS e
         ORDER BY 1
    LOOP
        PERFORM fn_consume_stock(
            r.id, r.qty, NULL, p_user_id,
            format('Cooked %s %s of %s', p_trays, v_tray_word, v_item.name));
        v_used := v_used || jsonb_build_object('name', r.name, 'unit', r.unit, 'qty', r.qty);
    END LOOP;

    -- The servings, available until the end of today (the batch rules set the expiry date)
    INSERT INTO inventory_batches (item_id, qty_received, qty_remaining, created_by)
    VALUES (p_item_id, v_servings, v_servings, p_user_id)
    RETURNING id, batch_code INTO v_batch_id, v_batch_code;

    INSERT INTO stock_movements (item_id, batch_id, movement_type, qty, reason, user_id)
    VALUES (p_item_id, v_batch_id, 'IN', v_servings,
            COALESCE(p_reason, format('%s %s cooked (%s servings)', p_trays, v_tray_word, v_servings)),
            p_user_id);

    RETURN jsonb_build_object(
        'batchId',         v_batch_id,
        'batchCode',       v_batch_code,
        'trays',           p_trays,
        'servings',        v_servings,
        'servingsPerTray', v_item.servings_per_tray,
        'hasRecipe',       jsonb_array_length(v_plan) > 0,
        'used',            v_used
    );
END;
$$;


ALTER FUNCTION public.fn_add_menu_trays(p_item_id integer, p_trays integer, p_user_id integer, p_reason text) OWNER TO postgres;

--
-- Name: fn_block_changes(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_block_changes() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
        USING ERRCODE = '42501';
END;
$$;


ALTER FUNCTION public.fn_block_changes() OWNER TO postgres;

--
-- Name: fn_check_batch_rules(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_check_batch_rules() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    it items%ROWTYPE;
BEGIN
    SELECT * INTO it FROM items WHERE id = NEW.item_id;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    IF it.item_type = 'ingredient' THEN
        IF it.has_expiry AND NEW.expiry_date IS NULL THEN
            RAISE EXCEPTION 'Batch of "%" needs an expiry date', it.name
                USING ERRCODE = '23514';
        ELSIF NOT it.has_expiry AND NEW.expiry_date IS NOT NULL THEN
            RAISE EXCEPTION '"%" has no expiry date, so a batch cannot have one', it.name
                USING ERRCODE = '23514';
        END IF;
    ELSE
        IF NEW.qty_received <> trunc(NEW.qty_received)
           OR NEW.qty_remaining <> trunc(NEW.qty_remaining) THEN
            RAISE EXCEPTION 'Quantity of "%" must be a whole number of %', it.name, it.unit
                USING ERRCODE = '23514';
        END IF;
        NEW.expiry_date := NEW.received_date;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_check_batch_rules() OWNER TO postgres;

--
-- Name: fn_check_recipe_rules(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_check_recipe_rules() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    menu_type  item_type;
    ingr_type  item_type;
BEGIN
    SELECT item_type INTO menu_type FROM items WHERE id = NEW.menu_item_id;
    SELECT item_type INTO ingr_type FROM items WHERE id = NEW.ingredient_item_id;

    IF menu_type IS DISTINCT FROM 'food' THEN
        RAISE EXCEPTION 'A recipe can only belong to a food (sold per serving)'
            USING ERRCODE = '23514';
    END IF;
    IF ingr_type IS DISTINCT FROM 'ingredient' THEN
        RAISE EXCEPTION 'A recipe can only list ingredients'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_check_recipe_rules() OWNER TO postgres;

--
-- Name: fn_consume_stock(integer, numeric, integer, integer, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_consume_stock(p_item_id integer, p_qty numeric, p_order_id integer, p_user_id integer, p_reason text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_remaining NUMERIC := p_qty;
    v_take      NUMERIC;
    v_name      TEXT;
    b           RECORD;
BEGIN
    IF p_qty IS NULL OR p_qty <= 0 THEN
        RAISE EXCEPTION 'Quantity must be greater than 0';
    END IF;

    FOR b IN
        SELECT id, qty_remaining
        FROM inventory_batches
        WHERE item_id = p_item_id
          AND qty_remaining > 0
          AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
        ORDER BY received_date, id
        FOR UPDATE
    LOOP
        EXIT WHEN v_remaining <= 0;
        v_take := LEAST(b.qty_remaining, v_remaining);

        UPDATE inventory_batches
        SET qty_remaining = qty_remaining - v_take
        WHERE id = b.id;

        INSERT INTO stock_movements (item_id, batch_id, movement_type, qty, reason, order_id, user_id)
        VALUES (p_item_id, b.id, 'USED', v_take, p_reason, p_order_id, p_user_id);

        v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining > 0 THEN
        SELECT name INTO v_name FROM items WHERE id = p_item_id;
        RAISE EXCEPTION 'Not enough % in stock (short by %)', v_name, v_remaining;
    END IF;
END;
$$;


ALTER FUNCTION public.fn_consume_stock(p_item_id integer, p_qty numeric, p_order_id integer, p_user_id integer, p_reason text) OWNER TO postgres;

--
-- Name: fn_fmt_qty(numeric); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_fmt_qty(p numeric) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
    SELECT CASE WHEN p IS NULL THEN '0'
                WHEN position('.' IN p::text) > 0 THEN rtrim(rtrim(p::text, '0'), '.')
                ELSE p::text END;
$$;


ALTER FUNCTION public.fn_fmt_qty(p numeric) OWNER TO postgres;

--
-- Name: fn_next_order_number(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_next_order_number() RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
    n INTEGER;
BEGIN
    UPDATE counters SET last_value = last_value + 1
    WHERE name = 'order_number'
    RETURNING last_value INTO n;
    RETURN lpad(n::text, 4, '0');
END;
$$;


ALTER FUNCTION public.fn_next_order_number() OWNER TO postgres;

--
-- Name: fn_require_session(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_require_session() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.fn_require_session() OWNER TO postgres;

--
-- Name: fn_usable_qty(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_usable_qty(p_item_id integer) RETURNS numeric
    LANGUAGE sql STABLE
    AS $$
    SELECT COALESCE(SUM(qty_remaining), 0)
      FROM inventory_batches
     WHERE item_id = p_item_id
       AND qty_remaining > 0
       AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE);
$$;


ALTER FUNCTION public.fn_usable_qty(p_item_id integer) OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    user_id integer,
    username text,
    action text NOT NULL,
    entity text,
    entity_id text,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip_address inet,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.audit_log OWNER TO postgres;

--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.audit_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: batch_code_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.batch_code_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.batch_code_seq OWNER TO postgres;

--
-- Name: cashier_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cashier_sessions (
    id integer NOT NULL,
    cashier_id integer NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    opening_cash numeric(10,2) NOT NULL,
    closed_at timestamp with time zone,
    expected_cash numeric(10,2),
    counted_cash numeric(10,2),
    cash_difference numeric(10,2),
    close_note text,
    CONSTRAINT cashier_sessions_counted_cash_check CHECK ((counted_cash >= (0)::numeric)),
    CONSTRAINT cashier_sessions_opening_cash_check CHECK ((opening_cash >= (0)::numeric)),
    CONSTRAINT sessions_close_after_open CHECK (((closed_at IS NULL) OR (closed_at >= opened_at))),
    CONSTRAINT sessions_close_all_or_none CHECK ((((closed_at IS NULL) AND (expected_cash IS NULL) AND (counted_cash IS NULL) AND (cash_difference IS NULL)) OR ((closed_at IS NOT NULL) AND (expected_cash IS NOT NULL) AND (counted_cash IS NOT NULL) AND (cash_difference IS NOT NULL))))
);


ALTER TABLE public.cashier_sessions OWNER TO postgres;

--
-- Name: cashier_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.cashier_sessions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.cashier_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.categories (
    id smallint NOT NULL,
    name text NOT NULL,
    kind public.item_type NOT NULL
);


ALTER TABLE public.categories OWNER TO postgres;

--
-- Name: categories_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.categories ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: counters; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.counters (
    name text NOT NULL,
    last_value integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.counters OWNER TO postgres;

--
-- Name: inventory_batches; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inventory_batches (
    id integer NOT NULL,
    batch_code text DEFAULT ('B-'::text || lpad((nextval('public.batch_code_seq'::regclass))::text, 4, '0'::text)) NOT NULL,
    item_id integer NOT NULL,
    qty_received numeric(12,3) NOT NULL,
    qty_remaining numeric(12,3) NOT NULL,
    received_date date DEFAULT CURRENT_DATE NOT NULL,
    expiry_date date,
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT batches_expiry_after_received CHECK (((expiry_date IS NULL) OR (expiry_date >= received_date))),
    CONSTRAINT batches_remaining_range CHECK (((qty_remaining >= (0)::numeric) AND (qty_remaining <= qty_received))),
    CONSTRAINT inventory_batches_qty_received_check CHECK ((qty_received > (0)::numeric))
);


ALTER TABLE public.inventory_batches OWNER TO postgres;

--
-- Name: inventory_batches_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.inventory_batches ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.inventory_batches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.items (
    id integer NOT NULL,
    name text NOT NULL,
    item_type public.item_type NOT NULL,
    category_id smallint NOT NULL,
    unit text NOT NULL,
    min_level numeric(12,3) DEFAULT 0 NOT NULL,
    has_expiry boolean DEFAULT false NOT NULL,
    price numeric(10,2),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    servings_per_tray smallint DEFAULT 10 NOT NULL,
    CONSTRAINT items_expiry_flag_rule CHECK (((item_type = 'ingredient'::public.item_type) OR (has_expiry = false))),
    CONSTRAINT items_menu_unit_rule CHECK (((item_type = 'ingredient'::public.item_type) OR ((item_type = 'food'::public.item_type) AND (unit = 'servings'::text)) OR ((item_type = 'food_tray'::public.item_type) AND (unit = 'trays'::text)))),
    CONSTRAINT items_min_level_check CHECK ((min_level >= (0)::numeric)),
    CONSTRAINT items_name_not_blank CHECK ((length(btrim(name)) > 0)),
    CONSTRAINT items_price_rule CHECK ((((item_type = 'ingredient'::public.item_type) AND (price IS NULL)) OR ((item_type <> 'ingredient'::public.item_type) AND (price IS NOT NULL) AND (price > (0)::numeric)))),
    CONSTRAINT items_servings_per_tray_positive CHECK ((servings_per_tray > 0))
);


ALTER TABLE public.items OWNER TO postgres;

--
-- Name: items_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.items ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_items (
    id integer NOT NULL,
    order_id integer NOT NULL,
    item_id integer NOT NULL,
    item_name text NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    qty integer NOT NULL,
    line_total numeric(10,2) GENERATED ALWAYS AS ((unit_price * (qty)::numeric)) STORED,
    CONSTRAINT order_items_qty_check CHECK ((qty > 0)),
    CONSTRAINT order_items_unit_price_check CHECK ((unit_price > (0)::numeric))
);


ALTER TABLE public.order_items OWNER TO postgres;

--
-- Name: order_items_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.order_items ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.order_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.orders (
    id integer NOT NULL,
    order_number text DEFAULT public.fn_next_order_number() NOT NULL,
    order_type public.order_type NOT NULL,
    status public.order_status DEFAULT 'preparing'::public.order_status NOT NULL,
    total numeric(10,2) NOT NULL,
    gst_amount numeric(10,2) DEFAULT 0 NOT NULL,
    cashier_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    client_request_id uuid,
    session_id integer,
    CONSTRAINT orders_completed_rule CHECK (((status = 'completed'::public.order_status) = (completed_at IS NOT NULL))),
    CONSTRAINT orders_gst_amount_check CHECK ((gst_amount >= (0)::numeric)),
    CONSTRAINT orders_total_check CHECK ((total >= (0)::numeric))
);


ALTER TABLE public.orders OWNER TO postgres;

--
-- Name: orders_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.orders ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.orders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payments (
    id integer NOT NULL,
    order_id integer NOT NULL,
    method public.payment_method NOT NULL,
    amount_due numeric(10,2) NOT NULL,
    amount_tendered numeric(10,2) NOT NULL,
    change_given numeric(10,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payments_amount_due_check CHECK ((amount_due >= (0)::numeric)),
    CONSTRAINT payments_change CHECK ((change_given = (amount_tendered - amount_due))),
    CONSTRAINT payments_enough CHECK ((amount_tendered >= amount_due)),
    CONSTRAINT payments_noncash_exact CHECK (((method = 'cash'::public.payment_method) OR (amount_tendered = amount_due)))
);


ALTER TABLE public.payments OWNER TO postgres;

--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.payments ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.payments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: recipe_ingredients; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.recipe_ingredients (
    id integer NOT NULL,
    menu_item_id integer NOT NULL,
    ingredient_item_id integer NOT NULL,
    qty_per_tray numeric(12,3) NOT NULL,
    is_optional boolean DEFAULT false NOT NULL,
    alt_group smallint,
    alt_rank smallint,
    CONSTRAINT recipe_alt_columns_together CHECK (((alt_group IS NULL) = (alt_rank IS NULL))),
    CONSTRAINT recipe_ingredients_qty_per_tray_check CHECK ((qty_per_tray > (0)::numeric))
);


ALTER TABLE public.recipe_ingredients OWNER TO postgres;

--
-- Name: recipe_ingredients_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.recipe_ingredients ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.recipe_ingredients_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: shop_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.shop_settings (
    id smallint DEFAULT 1 NOT NULL,
    name text DEFAULT 'Mamitasâ€™ Kitchen'::text NOT NULL,
    location text DEFAULT 'Singapore'::text NOT NULL,
    currency text DEFAULT 'SGD'::text NOT NULL,
    gst_registered boolean DEFAULT false NOT NULL,
    gst_rate numeric(5,4) DEFAULT 0.0900 NOT NULL,
    gst_reg_no text DEFAULT ''::text NOT NULL,
    expiry_warning_days smallint DEFAULT 3 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shop_settings_expiry_warning_days_check CHECK (((expiry_warning_days >= 1) AND (expiry_warning_days <= 30))),
    CONSTRAINT shop_settings_gst_rate_check CHECK (((gst_rate >= (0)::numeric) AND (gst_rate <= (1)::numeric))),
    CONSTRAINT shop_settings_id_check CHECK ((id = 1))
);


ALTER TABLE public.shop_settings OWNER TO postgres;

--
-- Name: stock_movements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stock_movements (
    id bigint NOT NULL,
    item_id integer NOT NULL,
    batch_id integer NOT NULL,
    movement_type public.movement_type NOT NULL,
    qty numeric(12,3) NOT NULL,
    reason text NOT NULL,
    order_id integer,
    user_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_movements_qty_rule CHECK ((((movement_type = 'ADJUSTMENT'::public.movement_type) AND (qty <> (0)::numeric)) OR ((movement_type <> 'ADJUSTMENT'::public.movement_type) AND (qty > (0)::numeric))))
);


ALTER TABLE public.stock_movements OWNER TO postgres;

--
-- Name: stock_movements_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.stock_movements ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.stock_movements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username text NOT NULL,
    password_hash text NOT NULL,
    full_name text NOT NULL,
    role public.user_role NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    failed_logins smallint DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    must_change_password boolean DEFAULT false NOT NULL,
    session_version integer DEFAULT 1 NOT NULL,
    CONSTRAINT users_failed_logins_check CHECK ((failed_logins >= 0)),
    CONSTRAINT users_username_length CHECK ((length(btrim(username)) >= 3))
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.users ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: v_batch_status; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_batch_status AS
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
        CASE
            WHEN (b.expiry_date IS NULL) THEN NULL::integer
            ELSE (b.expiry_date - CURRENT_DATE)
        END AS days_left,
        CASE
            WHEN (b.expiry_date IS NULL) THEN 'none'::text
            WHEN (b.expiry_date < CURRENT_DATE) THEN 'expired'::text
            WHEN (b.expiry_date <= (CURRENT_DATE + 3)) THEN 'soon'::text
            ELSE 'ok'::text
        END AS expiry_status
   FROM ((public.inventory_batches b
     JOIN public.items i ON ((i.id = b.item_id)))
     JOIN public.categories c ON ((c.id = i.category_id)));


ALTER VIEW public.v_batch_status OWNER TO postgres;

--
-- Name: v_daily_sales; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_daily_sales AS
 SELECT ((created_at AT TIME ZONE 'Asia/Singapore'::text))::date AS sales_date,
    count(*) AS orders,
    sum(total) AS sales,
    round(avg(total), 2) AS average_order
   FROM public.orders o
  GROUP BY (((created_at AT TIME ZONE 'Asia/Singapore'::text))::date);


ALTER VIEW public.v_daily_sales OWNER TO postgres;

--
-- Name: v_item_sales; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_item_sales AS
 SELECT ((o.created_at AT TIME ZONE 'Asia/Singapore'::text))::date AS sales_date,
    oi.item_id,
    oi.item_name,
    sum(oi.qty) AS qty_sold,
    sum(oi.line_total) AS revenue
   FROM (public.order_items oi
     JOIN public.orders o ON ((o.id = oi.order_id)))
  GROUP BY (((o.created_at AT TIME ZONE 'Asia/Singapore'::text))::date), oi.item_id, oi.item_name;


ALTER VIEW public.v_item_sales OWNER TO postgres;

--
-- Name: v_item_stock; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_item_stock AS
SELECT
    NULL::integer AS item_id,
    NULL::text AS name,
    NULL::public.item_type AS item_type,
    NULL::text AS category,
    NULL::text AS unit,
    NULL::numeric(12,3) AS min_level,
    NULL::numeric(10,2) AS price,
    NULL::boolean AS has_expiry,
    NULL::numeric AS qty_on_hand,
    NULL::numeric AS qty_usable,
    NULL::bigint AS open_batches,
    NULL::date AS next_expiry,
    NULL::smallint AS servings_per_tray;


ALTER VIEW public.v_item_stock OWNER TO postgres;

--
-- Name: v_session_summary; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_session_summary AS
SELECT
    NULL::integer AS session_id,
    NULL::integer AS cashier_id,
    NULL::text AS cashier,
    NULL::timestamp with time zone AS opened_at,
    NULL::date AS opened_date,
    NULL::numeric(10,2) AS opening_cash,
    NULL::timestamp with time zone AS closed_at,
    NULL::numeric(10,2) AS expected_cash,
    NULL::numeric(10,2) AS counted_cash,
    NULL::numeric(10,2) AS cash_difference,
    NULL::text AS close_note,
    NULL::bigint AS orders,
    NULL::numeric AS net_sales,
    NULL::numeric AS cash_sales,
    NULL::numeric AS paynow_sales,
    NULL::numeric AS card_sales,
    NULL::numeric AS expected_now;


ALTER VIEW public.v_session_summary OWNER TO postgres;

--
-- Data for Name: audit_log; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.audit_log (id, user_id, username, action, entity, entity_id, details, ip_address, created_at) FROM stdin;
1	5	smoke_owner	login.failed	\N	\N	{"reason": "bad_password"}	::1	2026-11-07 15:24:52.747576+08
2	5	smoke_owner	login.failed	\N	\N	{"reason": "bad_password"}	::1	2026-11-07 15:29:14.591021+08
3	\N	nobody_here	login.failed	\N	\N	{"reason": "unknown_user"}	::1	2026-11-07 15:29:15.179157+08
4	4	smoke_cashier	login.success	\N	\N	{}	::1	2026-11-07 15:29:15.219936+08
5	4	smoke_cashier	access.denied	\N	\N	{"path": "/api/audit-log", "needs": ["owner"], "method": "GET"}	::1	2026-11-07 15:29:15.23803+08
6	5	smoke_owner	login.success	\N	\N	{}	::1	2026-11-07 15:29:15.260167+08
7	4	smoke_cashier	login.failed	\N	\N	{"reason": "bad_password"}	::1	2026-11-07 15:29:15.293355+08
8	4	smoke_cashier	login.failed	\N	\N	{"reason": "bad_password"}	::1	2026-11-07 15:29:15.305833+08
9	4	smoke_cashier	login.failed	\N	\N	{"reason": "bad_password"}	::1	2026-11-07 15:29:15.315792+08
10	4	smoke_cashier	login.failed	\N	\N	{"reason": "bad_password"}	::1	2026-11-07 15:29:15.325778+08
11	4	smoke_cashier	login.failed	\N	\N	{"reason": "bad_password"}	::1	2026-11-07 15:29:15.340297+08
12	4	smoke_cashier	account.locked	\N	\N	{"minutes": 15}	::1	2026-11-07 15:29:15.341473+08
13	4	smoke_cashier	login.blocked	\N	\N	{"reason": "account_locked"}	::1	2026-11-07 15:29:15.349135+08
14	4	smoke_cashier	login.success	\N	\N	{}	::1	2026-11-07 15:29:15.366059+08
15	5	\N	logout	\N	\N	{}	::1	2026-11-07 15:29:15.385985+08
16	\N	nobody_1	login.failed	\N	\N	{"reason": "unknown_user"}	::1	2026-11-07 15:30:18.141647+08
17	\N	nobody_2	login.failed	\N	\N	{"reason": "unknown_user"}	::1	2026-11-07 15:30:18.690482+08
18	\N	nobody_3	login.failed	\N	\N	{"reason": "unknown_user"}	::1	2026-11-07 15:30:19.161827+08
19	\N	nobody_4	login.failed	\N	\N	{"reason": "unknown_user"}	::1	2026-11-07 15:30:19.64608+08
20	\N	nobody_5	login.failed	\N	\N	{"reason": "unknown_user"}	::1	2026-11-07 15:30:20.123001+08
21	\N	nobody_6	login.failed	\N	\N	{"reason": "unknown_user"}	::1	2026-11-07 15:30:20.614599+08
22	\N	nobody_7	login.failed	\N	\N	{"reason": "unknown_user"}	::1	2026-11-07 15:30:21.083783+08
23	\N	nobody_8	login.failed	\N	\N	{"reason": "unknown_user"}	::1	2026-11-07 15:30:21.560262+08
24	\N	nobody_9	login.failed	\N	\N	{"reason": "unknown_user"}	::1	2026-11-07 15:30:22.00864+08
25	\N	nobody_10	login.failed	\N	\N	{"reason": "unknown_user"}	::1	2026-11-07 15:30:22.477444+08
26	\N	nobody_11	login.failed	\N	\N	{"reason": "unknown_user"}	::1	2026-11-07 15:30:22.936662+08
27	\N	nobody_12	login.failed	\N	\N	{"reason": "unknown_user"}	::1	2026-11-07 15:30:23.394306+08
28	\N	script	user.password_reset	user	1	{"username": "cashier"}	\N	2026-11-07 15:31:37.700903+08
29	\N	script	user.password_reset	user	2	{"username": "kitchen"}	\N	2026-11-07 15:32:39.984647+08
30	\N	script	user.password_reset	user	3	{"username": "owner"}	\N	2026-11-07 15:35:25.186444+08
31	2	kitchen	login.failed	\N	\N	{"reason": "bad_password"}	::1	2026-11-10 15:24:07.519397+08
32	\N	kitchen1	login.failed	\N	\N	{"reason": "unknown_user"}	::1	2026-11-10 15:24:22.6106+08
33	2	kitchen	login.failed	\N	\N	{"reason": "bad_password"}	::1	2026-11-10 15:24:41.199148+08
34	2	kitchen	login.failed	\N	\N	{"reason": "bad_password"}	::1	2026-11-10 15:24:43.094889+08
35	2	kitchen	login.success	\N	\N	{}	::1	2026-11-10 15:24:51.830018+08
36	2	\N	logout	\N	\N	{}	::1	2026-11-10 15:26:08.472407+08
37	1	cashier	login.success	\N	\N	{}	::1	2026-11-10 15:26:26.940881+08
38	1	\N	logout	\N	\N	{}	::1	2026-11-10 15:26:47.088538+08
39	3	owner	login.success	\N	\N	{}	::1	2026-11-10 15:27:18.417082+08
40	3	\N	logout	\N	\N	{}	::1	2026-11-10 15:27:24.309873+08
41	1	cashier	login.success	\N	\N	{}	::1	2026-11-10 15:31:43.464868+08
42	1	\N	logout	\N	\N	{}	::1	2026-11-10 15:31:47.30125+08
43	2	kitchen	login.success	\N	\N	{}	::1	2026-11-10 15:37:46.482326+08
44	2	kitchen	batch.created	batch	20	{"qty": 2, "code": "B-0020", "item": "Salt", "expiry": null}	::1	2026-11-10 15:38:46.563896+08
45	2	kitchen	batch.created	batch	21	{"qty": 2, "code": "B-0021", "item": "Salt", "expiry": null}	::1	2026-11-10 15:39:07.084046+08
46	2	kitchen	batch.created	batch	22	{"qty": 10, "code": "B-0022", "item": "Fried Chicken", "expiry": "2026-11-12"}	::1	2026-11-10 15:40:08.294387+08
47	2	kitchen	batch.loss	batch	8	{"qty": 2, "code": "B-0004", "item": "Chicken Thigh", "type": "SPOILED", "reason": "Expired"}	::1	2026-11-10 15:45:02.569835+08
48	2	\N	logout	\N	\N	{}	::1	2026-11-10 15:46:44.862516+08
49	3	owner	login.success	\N	\N	{}	::1	2026-11-10 15:46:59.160865+08
50	3	\N	logout	\N	\N	{}	::1	2026-11-10 20:38:46.45125+08
51	2	kitchen	login.success	\N	\N	{}	::1	2026-11-10 20:38:50.492018+08
52	2	kitchen	batch.created	batch	1	{"qty": 1, "code": "B-0001", "item": "Vinegar", "expiry": null}	::1	2026-11-10 20:40:10.827259+08
53	2	kitchen	login.success	\N	\N	{}	::1	2026-11-12 17:00:03.035945+08
54	\N	script	stock.opening_import	inventory	\N	{"date": "2026-11-13", "dishes": 37, "ingredients": 106}	\N	2026-11-13 12:02:53.49185+08
55	2	kitchen	login.success	\N	\N	{}	::1	2026-11-13 12:03:57.062207+08
56	\N	smoke_kitchen	login.failed	\N	\N	{"reason": "unknown_user"}	::1	2026-11-13 12:41:47.818943+08
57	\N	smoke_kitchen	login.failed	\N	\N	{"reason": "unknown_user"}	::1	2026-11-13 17:58:50.540606+08
58	\N	smoke_kitchen	login.failed	\N	\N	{"reason": "unknown_user"}	::1	2026-11-13 18:01:15.314076+08
59	\N	smoke_kitchen	login.failed	\N	\N	{"reason": "unknown_user"}	::1	2026-11-13 18:03:39.645665+08
60	2	kitchen	login.success	\N	\N	{}	::1	2026-11-13 18:16:40.48782+08
61	2	kitchen	login.success	\N	\N	{}	::1	2026-11-13 18:17:07.598604+08
62	2	kitchen	item.updated	item	3	{"minLevel": {"to": 6, "from": 5}}	::1	2026-11-13 18:18:10.196682+08
63	2	kitchen	batch.adjusted	batch	90	{"to": 9.5, "code": "B-0090", "diff": 2, "from": 7.5, "item": "Pork Belly", "reason": "Recount"}	::1	2026-11-13 18:19:27.745585+08
64	2	kitchen	batch.adjusted	batch	9	{"to": 17, "code": "B-0009", "diff": 3, "from": 14, "item": "All-Purpose Cream", "reason": "Opening count correction"}	::1	2026-11-13 18:21:04.719326+08
65	2	kitchen	batch.adjusted	batch	107	{"to": 10, "code": "B-0107", "diff": -2, "from": 12, "item": "Kare-Kare (Pork Pata)", "reason": "Measuring error"}	::1	2026-11-13 18:23:09.100559+08
66	2	\N	logout	\N	\N	{}	::1	2026-11-13 18:26:12.752562+08
67	1	cashier	login.success	\N	\N	{}	::1	2026-11-13 18:26:20.400428+08
68	1	\N	logout	\N	\N	{}	::1	2026-11-13 18:26:27.588954+08
69	2	kitchen	login.success	\N	\N	{}	::1	2026-11-13 18:27:41.597822+08
70	2	\N	logout	\N	\N	{}	::1	2026-11-13 18:33:01.2606+08
71	1	cashier	login.success	\N	\N	{}	::1	2026-11-15 22:06:47.665826+08
72	1	cashier	order.placed	order	1	{"type": "dine_in", "items": 2, "total": 7.5, "method": "cash", "number": "0001"}	::1	2026-11-15 22:07:27.363005+08
73	1	cashier	order.completed	order	1	{"number": "0001"}	::1	2026-11-15 22:07:50.475738+08
74	1	\N	logout	\N	\N	{}	::1	2026-11-15 22:13:15.882571+08
75	2	kitchen	login.success	\N	\N	{}	::1	2026-11-15 22:13:20.201439+08
76	2	kitchen	batch.created	batch	144	{"qty": 10, "code": "B-0144", "item": "Beef Broccoli", "expiry": null}	::1	2026-11-15 22:14:53.379964+08
77	2	kitchen	batch.created	batch	145	{"qty": 10, "code": "B-0145", "item": "Beef Mushroom", "expiry": null}	::1	2026-11-15 22:14:58.421623+08
78	2	kitchen	batch.created	batch	146	{"qty": 10, "code": "B-0146", "item": "Bicol Express", "expiry": null}	::1	2026-11-15 22:15:01.768901+08
79	2	kitchen	batch.created	batch	147	{"qty": 10, "code": "B-0147", "item": "Binagoongan", "expiry": null}	::1	2026-11-15 22:15:05.77263+08
80	2	kitchen	batch.created	batch	148	{"qty": 10, "code": "B-0148", "item": "Bistek Tagalog", "expiry": null}	::1	2026-11-15 22:15:12.522986+08
81	2	kitchen	batch.created	batch	149	{"qty": 10, "code": "B-0149", "item": "Bopis", "expiry": null}	::1	2026-11-15 22:15:16.599435+08
82	2	kitchen	batch.created	batch	150	{"qty": 10, "code": "B-0150", "item": "Chicken Afritada", "expiry": null}	::1	2026-11-15 22:15:21.882587+08
83	2	kitchen	batch.created	batch	151	{"qty": 10, "code": "B-0151", "item": "Chop Suey", "expiry": null}	::1	2026-11-15 22:15:26.354607+08
84	2	kitchen	batch.created	batch	152	{"qty": 10, "code": "B-0152", "item": "Classic Dinuguan", "expiry": null}	::1	2026-11-15 22:15:30.03693+08
85	2	kitchen	batch.created	batch	153	{"qty": 10, "code": "B-0153", "item": "Ginataang Sitaw at Kalabasa", "expiry": null}	::1	2026-11-15 22:15:33.59763+08
86	2	kitchen	batch.created	batch	154	{"qty": 10, "code": "B-0154", "item": "Giniling na Baboy", "expiry": null}	::1	2026-11-15 22:15:37.782004+08
87	2	kitchen	batch.created	batch	155	{"qty": 10, "code": "B-0155", "item": "Kaldereta Spareribs", "expiry": "2026-11-16"}	::1	2026-11-15 22:15:51.640002+08
88	2	\N	logout	\N	\N	{}	::1	2026-11-15 22:33:30.345558+08
89	1	cashier	login.success	\N	\N	{}	::1	2026-11-15 22:33:34.682918+08
90	1	cashier	order.placed	order	2	{"type": "takeaway", "items": 3, "total": 19.5, "method": "cash", "number": "0002"}	::1	2026-11-15 22:40:24.229977+08
91	1	\N	logout	\N	\N	{}	::1	2026-11-15 22:40:30.404312+08
92	3	owner	login.success	\N	\N	{}	::1	2026-11-15 22:40:47.819344+08
93	3	\N	logout	\N	\N	{}	::1	2026-11-15 22:55:24.191673+08
94	1	cashier	login.success	\N	\N	{}	::1	2026-11-15 22:55:29.134897+08
95	1	\N	logout	\N	\N	{}	::1	2026-11-15 22:58:56.306384+08
96	2	kitchen	login.success	\N	\N	{}	::1	2026-11-16 14:54:39.584599+08
97	2	kitchen	batch.write_off	batch	61	{"qty": 2.4, "code": "B-0061", "item": "Bean Sprouts"}	::1	2026-11-16 14:55:17.740722+08
98	2	kitchen	batch.write_off	batch	93	{"qty": 4.5, "code": "B-0093", "item": "Ground Pork"}	::1	2026-11-16 14:55:20.590889+08
99	2	kitchen	batch.write_off	batch	94	{"qty": 1.2, "code": "B-0094", "item": "Pork Lungs"}	::1	2026-11-16 14:55:23.527479+08
100	2	kitchen	batch.write_off	batch	95	{"qty": 1.2, "code": "B-0095", "item": "Pork Heart"}	::1	2026-11-16 14:55:38.155831+08
101	2	kitchen	batch.write_off	batch	96	{"qty": 0.9, "code": "B-0096", "item": "Pork Liver"}	::1	2026-11-16 14:55:41.020157+08
102	2	kitchen	batch.write_off	batch	97	{"qty": 1.8, "code": "B-0097", "item": "Pork Intestines"}	::1	2026-11-16 14:55:43.723079+08
103	2	kitchen	batch.write_off	batch	98	{"qty": 1.5, "code": "B-0098", "item": "Pork Blood"}	::1	2026-11-16 14:55:45.930276+08
104	2	kitchen	batch.write_off	batch	105	{"qty": 0.9, "code": "B-0105", "item": "Shrimp"}	::1	2026-11-16 14:55:48.324258+08
105	2	\N	logout	\N	\N	{}	::1	2026-11-16 14:56:28.366542+08
106	3	owner	login.success	\N	\N	{}	::1	2026-11-16 14:56:32.565982+08
107	3	\N	logout	\N	\N	{}	::1	2026-11-16 14:57:10.547425+08
108	2	kitchen	login.success	\N	\N	{}	::1	2026-11-16 14:58:18.38039+08
109	2	\N	logout	\N	\N	{}	::1	2026-11-16 15:31:10.672895+08
110	2	kitchen	login.success	\N	\N	{}	::1	2026-11-16 15:31:12.917358+08
111	2	kitchen	menu.write_off_expired	item	\N	{"items": 37, "batches": 49, "servings": 574}	::1	2026-11-16 15:33:09.916613+08
112	2	kitchen	batch.created	batch	156	{"qty": 10, "code": "B-0156", "item": "Fruit Salad", "expiry": null}	::1	2026-11-16 15:35:49.669791+08
113	2	kitchen	batch.created	batch	157	{"qty": 5, "code": "B-0157", "item": "Leche Flan", "expiry": null}	::1	2026-11-16 15:35:56.236936+08
114	2	kitchen	batch.created	batch	158	{"qty": 10, "code": "B-0158", "item": "Macaroni Salad", "expiry": null}	::1	2026-11-16 15:36:03.234917+08
115	2	kitchen	batch.created	batch	159	{"qty": 10, "code": "B-0159", "item": "Mango Graham", "expiry": null}	::1	2026-11-16 15:36:10.599045+08
116	2	kitchen	batch.created	batch	160	{"qty": 10, "code": "B-0160", "item": "Beef Mushroom", "expiry": null}	::1	2026-11-16 15:37:55.558289+08
117	2	\N	logout	\N	\N	{}	::1	2026-11-16 15:37:58.11134+08
118	1	cashier	login.success	\N	\N	{}	::1	2026-11-16 15:38:03.224361+08
119	1	cashier	order.placed	order	3	{"type": "dine_in", "items": 3, "total": 26.5, "method": "cash", "number": "0003"}	::1	2026-11-16 15:39:05.310393+08
120	1	cashier	order.completed	order	3	{"number": "0003"}	::1	2026-11-16 15:40:27.771709+08
121	1	cashier	order.completed	order	2	{"number": "0002"}	::1	2026-11-16 15:40:29.763514+08
122	1	\N	logout	\N	\N	{}	::1	2026-11-16 15:40:41.325401+08
123	2	kitchen	login.success	\N	\N	{}	::1	2026-11-16 15:40:45.170137+08
124	2	\N	logout	\N	\N	{}	::1	2026-11-16 15:41:28.460992+08
125	1	cashier	login.success	\N	\N	{}	::1	2026-11-17 15:24:41.484976+08
126	1	cashier	session.opened	session	1	{"openingCash": 2000}	::1	2026-11-17 15:24:54.589783+08
127	1	\N	logout	\N	\N	{}	::1	2026-11-17 15:32:34.950522+08
128	1	cashier	login.success	\N	\N	{}	::1	2026-11-17 15:32:38.849786+08
129	1	\N	logout	\N	\N	{}	::1	2026-11-17 15:32:43.401662+08
130	2	kitchen	login.success	\N	\N	{}	::1	2026-11-17 15:32:48.406609+08
131	2	kitchen	menu.write_off_expired	item	\N	{"items": 5, "batches": 5, "servings": 42}	::1	2026-11-17 15:32:57.999387+08
132	2	kitchen	batch.created	batch	161	{"qty": 5, "code": "B-0161", "item": "Fruit Salad", "expiry": null}	::1	2026-11-17 15:33:37.573055+08
133	2	kitchen	batch.created	batch	162	{"qty": 7, "code": "B-0162", "item": "Leche Flan", "expiry": null}	::1	2026-11-17 15:33:49.447082+08
134	2	kitchen	batch.created	batch	163	{"qty": 9, "code": "B-0163", "item": "Macaroni Salad", "expiry": null}	::1	2026-11-17 15:33:59.158188+08
135	2	kitchen	batch.created	batch	164	{"qty": 4, "code": "B-0164", "item": "Mango Graham", "expiry": null}	::1	2026-11-17 15:34:10.648212+08
136	2	kitchen	batch.created	batch	165	{"qty": 6, "code": "B-0165", "item": "Ube Bar", "expiry": null}	::1	2026-11-17 15:34:20.88166+08
137	2	kitchen	batch.created	batch	166	{"qty": 10, "code": "B-0166", "item": "Beef Broccoli", "expiry": null}	::1	2026-11-17 15:34:51.230301+08
138	2	kitchen	batch.created	batch	167	{"qty": 8, "code": "B-0167", "item": "Beef Mushroom", "expiry": null}	::1	2026-11-17 15:35:03.50482+08
139	2	kitchen	batch.created	batch	168	{"qty": 8, "code": "B-0168", "item": "Bicol Express", "expiry": null}	::1	2026-11-17 15:35:28.629644+08
140	2	kitchen	batch.created	batch	169	{"qty": 9, "code": "B-0169", "item": "Binagoongan", "expiry": null}	::1	2026-11-17 15:35:46.207531+08
141	2	kitchen	batch.created	batch	170	{"qty": 7, "code": "B-0170", "item": "Bistek Tagalog", "expiry": null}	::1	2026-11-17 15:35:51.481773+08
142	2	kitchen	batch.created	batch	171	{"qty": 9, "code": "B-0171", "item": "Bopis", "expiry": null}	::1	2026-11-17 15:35:59.799688+08
143	2	kitchen	batch.created	batch	172	{"qty": 6, "code": "B-0172", "item": "Fruit Salad", "expiry": null}	::1	2026-11-17 15:36:16.704118+08
144	2	kitchen	batch.created	batch	173	{"qty": 9, "code": "B-0173", "item": "Chicken Afritada", "expiry": null}	::1	2026-11-17 15:36:42.194904+08
145	2	kitchen	batch.created	batch	174	{"qty": 8, "code": "B-0174", "item": "Chop Suey", "expiry": null}	::1	2026-11-17 15:36:47.825651+08
146	2	kitchen	batch.created	batch	175	{"qty": 8, "code": "B-0175", "item": "Classic Dinuguan", "expiry": null}	::1	2026-11-17 15:36:56.096612+08
147	2	kitchen	batch.created	batch	176	{"qty": 7, "code": "B-0176", "item": "Ginataang Sitaw at Kalabasa", "expiry": null}	::1	2026-11-17 15:37:02.994669+08
148	2	kitchen	batch.created	batch	177	{"qty": 8, "code": "B-0177", "item": "Giniling na Baboy", "expiry": null}	::1	2026-11-17 15:37:31.658187+08
149	2	kitchen	batch.created	batch	178	{"qty": 7, "code": "B-0178", "item": "Kaldereta Spareribs", "expiry": null}	::1	2026-11-17 15:37:37.155735+08
150	2	kitchen	batch.created	batch	179	{"qty": 9, "code": "B-0179", "item": "Kare-Kare (Pork Pata)", "expiry": null}	::1	2026-11-17 15:37:42.507568+08
151	2	kitchen	batch.created	batch	180	{"qty": 9, "code": "B-0180", "item": "Lechon Kawali", "expiry": null}	::1	2026-11-17 15:37:56.207741+08
152	2	kitchen	batch.created	batch	181	{"qty": 7, "code": "B-0181", "item": "Menudo", "expiry": null}	::1	2026-11-17 15:38:05.066141+08
153	2	kitchen	batch.created	batch	182	{"qty": 8, "code": "B-0182", "item": "Monggo", "expiry": null}	::1	2026-11-17 15:38:11.998308+08
154	2	kitchen	batch.created	batch	183	{"qty": 10, "code": "B-0183", "item": "Pakbet", "expiry": null}	::1	2026-11-17 15:38:20.106817+08
155	2	kitchen	batch.created	batch	184	{"qty": 10, "code": "B-0184", "item": "Paksiw na Bangus", "expiry": null}	::1	2026-11-17 15:38:25.411522+08
156	2	kitchen	batch.created	batch	185	{"qty": 8, "code": "B-0185", "item": "Paksiw na Pata", "expiry": null}	::1	2026-11-17 15:38:31.598826+08
157	2	kitchen	batch.created	batch	186	{"qty": 9, "code": "B-0186", "item": "Pork Mechado", "expiry": null}	::1	2026-11-17 15:38:36.96211+08
158	2	kitchen	batch.created	batch	187	{"qty": 10, "code": "B-0187", "item": "Sarsiado Bangus", "expiry": null}	::1	2026-11-17 15:38:41.524858+08
159	2	kitchen	batch.created	batch	188	{"qty": 10, "code": "B-0188", "item": "Sinigang na Baboy", "expiry": null}	::1	2026-11-17 15:38:46.922068+08
160	2	kitchen	batch.created	batch	189	{"qty": 9, "code": "B-0189", "item": "Sisig Bagnet", "expiry": null}	::1	2026-11-17 15:38:51.110725+08
161	2	kitchen	batch.created	batch	190	{"qty": 8, "code": "B-0190", "item": "Chicharon Bulaklak", "expiry": null}	::1	2026-11-17 15:38:58.157345+08
162	2	kitchen	batch.created	batch	191	{"qty": 10, "code": "B-0191", "item": "Embutido", "expiry": null}	::1	2026-11-17 15:39:09.102115+08
163	2	kitchen	batch.created	batch	192	{"qty": 9, "code": "B-0192", "item": "Kwek-Kwek", "expiry": null}	::1	2026-11-17 15:39:12.840105+08
164	2	kitchen	batch.created	batch	193	{"qty": 8, "code": "B-0193", "item": "Pork Shanghai", "expiry": null}	::1	2026-11-17 15:39:17.280839+08
165	2	kitchen	batch.created	batch	194	{"qty": 8, "code": "B-0194", "item": "Torta Talong", "expiry": null}	::1	2026-11-17 15:39:21.317988+08
300	3	\N	logout	\N	\N	{}	::1	2026-11-20 22:50:42.124185+08
166	2	kitchen	batch.created	batch	195	{"qty": 10, "code": "B-0195", "item": "Vegetable Okoy", "expiry": null}	::1	2026-11-17 15:39:27.843036+08
168	2	kitchen	batch.created	batch	197	{"qty": 8, "code": "B-0197", "item": "Beef Mami", "expiry": null}	::1	2026-11-17 15:39:36.309015+08
167	2	kitchen	batch.created	batch	196	{"qty": 9, "code": "B-0196", "item": "Vegetable Spring Roll", "expiry": null}	::1	2026-11-17 15:39:31.823222+08
169	2	kitchen	batch.created	batch	198	{"qty": 9, "code": "B-0198", "item": "Special Bulalo", "expiry": null}	::1	2026-11-17 15:39:40.973837+08
170	2	kitchen	item.created	item	144	{"name": "Pakbet Food tray", "type": "food_tray", "batch": "B-0199"}	::1	2026-11-17 15:42:12.013311+08
171	2	\N	logout	\N	\N	{}	::1	2026-11-17 15:42:50.035296+08
172	1	cashier	login.success	\N	\N	{}	::1	2026-11-17 15:42:54.72985+08
173	1	cashier	order.placed	order	4	{"type": "dine_in", "items": 2, "total": 15.5, "method": "cash", "number": "0004"}	::1	2026-11-17 15:43:22.617194+08
174	1	cashier	order.placed	order	5	{"type": "dine_in", "items": 2, "total": 14.5, "method": "paynow", "number": "0005"}	::1	2026-11-17 15:45:27.336092+08
175	1	cashier	order.completed	order	5	{"number": "0005"}	::1	2026-11-17 15:46:24.16946+08
176	1	cashier	order.completed	order	4	{"number": "0004"}	::1	2026-11-17 15:46:25.300858+08
177	1	\N	logout	\N	\N	{}	::1	2026-11-17 15:46:49.960946+08
178	3	owner	login.success	\N	\N	{}	::1	2026-11-17 15:47:00.814625+08
179	3	\N	logout	\N	\N	{}	::1	2026-11-17 15:47:48.935458+08
180	2	kitchen	login.success	\N	\N	{}	::1	2026-11-17 15:49:13.305104+08
181	2	kitchen	batch.write_off	batch	36	{"qty": 6, "code": "B-0036", "item": "Pechay"}	::1	2026-11-17 15:49:26.62987+08
182	2	kitchen	batch.write_off	batch	55	{"qty": 3, "code": "B-0055", "item": "Malunggay"}	::1	2026-11-17 15:49:28.840682+08
183	2	kitchen	batch.write_off	batch	56	{"qty": 3, "code": "B-0056", "item": "Spinach"}	::1	2026-11-17 15:49:31.40147+08
184	2	\N	logout	\N	\N	{}	::1	2026-11-17 15:53:20.418347+08
185	1	cashier	login.success	\N	\N	{}	::1	2026-11-17 15:54:47.798591+08
186	1	cashier	order.placed	order	6	{"type": "dine_in", "items": 1, "total": 3.5, "method": "cash", "number": "0006"}	::1	2026-11-17 15:55:07.160162+08
187	1	cashier	order.placed	order	7	{"type": "dine_in", "items": 2, "total": 19, "method": "cash", "number": "0007"}	::1	2026-11-17 15:55:14.817883+08
188	1	cashier	order.placed	order	8	{"type": "dine_in", "items": 2, "total": 19.5, "method": "cash", "number": "0008"}	::1	2026-11-17 15:55:21.841067+08
189	1	cashier	order.placed	order	9	{"type": "takeaway", "items": 2, "total": 18, "method": "cash", "number": "0009"}	::1	2026-11-17 15:55:37.77863+08
190	1	\N	logout	\N	\N	{}	::1	2026-11-17 15:57:15.762165+08
191	3	owner	login.success	\N	\N	{}	::1	2026-11-17 15:57:19.431209+08
192	3	\N	logout	\N	\N	{}	::1	2026-11-17 16:27:58.240589+08
193	1	cashier	login.success	\N	\N	{}	::1	2026-11-17 16:28:02.620992+08
194	1	cashier	session.closed	session	1	{"orders": 6, "counted": 2075.5, "expected": 2075.5, "netSales": 90, "difference": 0}	::1	2026-11-17 17:18:46.999662+08
195	1	\N	logout	\N	\N	{}	::1	2026-11-17 17:20:37.954899+08
196	3	owner	login.success	\N	\N	{}	::1	2026-11-17 17:20:41.697929+08
197	2	kitchen	login.success	\N	\N	{}	::1	2026-11-18 15:43:31.052545+08
198	2	\N	logout	\N	\N	{}	::1	2026-11-18 15:57:58.704726+08
199	2	kitchen	login.success	\N	\N	{}	::1	2026-11-18 15:58:01.331597+08
200	2	\N	logout	\N	\N	{}	::1	2026-11-18 15:58:02.568139+08
201	1	cashier	login.success	\N	\N	{}	::1	2026-11-18 15:58:06.93379+08
202	1	cashier	session.opened	session	2	{"openingCash": 1000}	::1	2026-11-18 16:00:27.572426+08
203	1	\N	logout	\N	\N	{}	::1	2026-11-18 16:18:35.047567+08
204	3	owner	login.success	\N	\N	{}	::1	2026-11-19 21:28:55.404646+08
205	2	kitchen	login.success	\N	\N	{}	::1	2026-11-20 16:39:27.400913+08
206	2	\N	logout	\N	\N	{}	::1	2026-11-20 17:28:28.859808+08
207	3	owner	login.success	\N	\N	{}	::1	2026-11-20 17:28:40.488382+08
208	3	\N	logout	\N	\N	{}	::1	2026-11-20 17:28:44.90576+08
209	3	owner	login.success	\N	\N	{}	::1	2026-11-20 17:28:49.583317+08
210	3	\N	logout	\N	\N	{}	::1	2026-11-20 17:28:55.666133+08
211	1	cashier	login.success	\N	\N	{}	::1	2026-11-20 17:29:15.651935+08
212	1	cashier	session.closed	session	2	{"orders": 0, "counted": 1000, "expected": 1000, "netSales": 0, "difference": 0}	::1	2026-11-20 17:29:35.964673+08
213	1	cashier	session.opened	session	3	{"openingCash": 2000}	::1	2026-11-20 17:49:10.783486+08
214	1	\N	logout	\N	\N	{}	::1	2026-11-20 17:56:39.507035+08
215	3	owner	login.success	\N	\N	{}	::1	2026-11-20 17:56:45.410721+08
216	3	\N	logout	\N	\N	{}	::1	2026-11-20 17:58:10.723243+08
217	1	cashier	login.success	\N	\N	{}	::1	2026-11-20 18:00:32.479586+08
218	1	cashier	order.completed	order	9	{"number": "0009"}	::1	2026-11-20 18:01:04.155971+08
219	1	cashier	order.completed	order	8	{"number": "0008"}	::1	2026-11-20 18:01:05.58632+08
220	1	cashier	order.completed	order	7	{"number": "0007"}	::1	2026-11-20 18:01:06.542529+08
221	1	cashier	order.completed	order	6	{"number": "0006"}	::1	2026-11-20 18:01:07.334504+08
222	1	cashier	session.closed	session	3	{"orders": 0, "counted": 2000, "expected": 2000, "netSales": 0, "difference": 0}	::1	2026-11-20 18:01:37.421728+08
223	1	\N	logout	\N	\N	{}	::1	2026-11-20 18:01:45.813561+08
224	1	cashier	login.success	\N	\N	{}	::1	2026-11-20 18:01:48.236112+08
225	1	\N	logout	\N	\N	{}	::1	2026-11-20 18:01:54.952096+08
226	2	kitchen	login.success	\N	\N	{}	::1	2026-11-20 18:01:59.145272+08
227	2	\N	logout	\N	\N	{}	::1	2026-11-20 18:02:10.360612+08
228	3	owner	login.success	\N	\N	{}	::1	2026-11-20 18:03:20.480293+08
229	3	\N	logout	\N	\N	{}	::1	2026-11-20 18:12:55.556936+08
230	2	kitchen	login.success	\N	\N	{}	::1	2026-11-20 18:13:00.573409+08
231	2	kitchen	menu.write_off_expired	item	\N	{"items": 38, "batches": 39, "servings": 306}	::1	2026-11-20 18:13:08.2319+08
232	2	kitchen	batch.created	batch	200	{"qty": 3, "code": "B-0200", "item": "Cornstarch", "expiry": null}	::1	2026-11-20 18:13:56.611634+08
233	2	kitchen	batch.created	batch	201	{"qty": 6, "code": "B-0201", "item": "All-Purpose Cream", "expiry": "2030-11-20"}	::1	2026-11-20 18:14:34.459247+08
234	2	\N	logout	\N	\N	{}	::1	2026-11-20 18:22:13.069546+08
235	3	owner	login.success	\N	\N	{}	::1	2026-11-20 18:22:20.025808+08
236	3	\N	logout	\N	\N	{}	::1	2026-11-20 18:25:11.601962+08
237	1	cashier	login.success	\N	\N	{}	::1	2026-11-20 18:25:15.816502+08
238	1	cashier	session.opened	session	4	{"openingCash": 4000}	::1	2026-11-20 18:25:25.022817+08
239	1	\N	logout	\N	\N	{}	::1	2026-11-20 18:25:27.117492+08
240	3	owner	login.success	\N	\N	{}	::1	2026-11-20 18:25:31.354707+08
241	3	\N	logout	\N	\N	{}	::1	2026-11-20 18:38:51.713602+08
242	1	cashier	login.success	\N	\N	{}	::1	2026-11-20 20:28:55.79401+08
243	1	\N	logout	\N	\N	{}	::1	2026-11-20 20:30:19.941257+08
244	1	cashier	login.success	\N	\N	{}	::1	2026-11-20 20:30:23.095897+08
245	1	\N	logout	\N	\N	{}	::1	2026-11-20 20:30:35.944091+08
246	3	owner	login.success	\N	\N	{}	::1	2026-11-20 20:30:41.594334+08
247	3	owner	session.opened	session	5	{"openingCash": 200}	::1	2026-11-20 20:41:18.171777+08
248	3	\N	logout	\N	\N	{}	::1	2026-11-20 20:41:47.775488+08
249	1	cashier	login.success	\N	\N	{}	::1	2026-11-20 20:41:52.197157+08
250	1	cashier	session.closed	session	4	{"orders": 0, "counted": 4000, "expected": 4000, "netSales": 0, "difference": 0}	::1	2026-11-20 20:41:58.003876+08
251	1	\N	logout	\N	\N	{}	::1	2026-11-20 20:42:02.041303+08
252	3	owner	login.success	\N	\N	{}	::1	2026-11-20 20:42:05.988107+08
253	3	\N	logout	\N	\N	{}	::1	2026-11-20 20:53:36.194461+08
254	3	owner	login.success	\N	\N	{}	::1	2026-11-20 20:53:38.28657+08
255	3	\N	logout	\N	\N	{}	::1	2026-11-20 21:37:06.5323+08
256	3	owner	login.success	\N	\N	{}	::1	2026-11-20 21:37:13.603054+08
257	3	owner	admin.backup_created	backup	mamitas_backup_2026-11-20-13-43-50.dump	{"size": "72.3 KB"}	::1	2026-11-20 21:43:51.723189+08
258	3	owner	admin.user_updated	user	1	{"role": "cashier", "isActive": true, "username": "cashier"}	::1	2026-11-20 21:45:39.835695+08
259	3	owner	admin.backup_downloaded	backup	mamitas_backup_2026-11-20-13-43-50.dump	{}	::1	2026-11-20 21:49:02.519483+08
260	3	owner	admin.shop_updated	shop_settings	1	{"name": "Mamitas™ Kitchen", "gstRate": 0.09, "currency": "SGD", "gstRegNo": "", "location": "Singapore", "gstRegistered": false, "expiryWarningDays": 3}	::1	2026-11-20 21:50:10.515375+08
261	3	\N	logout	\N	\N	{}	::1	2026-11-20 21:52:03.700502+08
262	1	cashier	login.success	\N	\N	{}	::1	2026-11-20 21:52:08.30732+08
263	1	\N	logout	\N	\N	{}	::1	2026-11-20 21:52:23.649343+08
264	1	cashier	login.success	\N	\N	{}	::1	2026-11-20 22:17:11.927188+08
265	4	smoke_cashier	login.failed	\N	\N	{"reason": "inactive"}	::1	2026-11-20 22:20:36.783473+08
266	4	smoke_cashier	login.failed	\N	\N	{"reason": "inactive"}	::1	2026-11-20 22:20:41.291708+08
267	1	cashier	login.success	\N	\N	{}	::1	2026-11-20 22:20:49.743921+08
268	1	cashier	session.opened	session	6	{"openingCash": 2000}	::1	2026-11-20 22:20:56.196352+08
269	3	owner	login.success	\N	\N	{}	::1	2026-11-20 22:21:09.144765+08
270	3	owner	admin.user_updated	user	4	{"role": "cashier", "isActive": false, "username": "smoke_cashier"}	::1	2026-11-20 22:21:49.969581+08
271	\N	Smoke test cashier	login.failed	\N	\N	{"reason": "unknown_user"}	::1	2026-11-20 22:22:00.924843+08
272	\N	Smoke test cashier	login.failed	\N	\N	{"reason": "unknown_user"}	::1	2026-11-20 22:22:05.201593+08
273	4	smoke_cashier	login.failed	\N	\N	{"reason": "inactive"}	::1	2026-11-20 22:22:14.006148+08
274	1	cashier	login.failed	\N	\N	{"reason": "bad_password"}	::1	2026-11-20 22:22:46.261367+08
275	1	cashier	login.success	\N	\N	{}	::1	2026-11-20 22:22:48.758421+08
276	3	owner	login.success	\N	\N	{}	::1	2026-11-20 22:22:57.944899+08
277	3	owner	admin.user_updated	user	1	{"role": "cashier", "isActive": true, "username": "cashier"}	::1	2026-11-20 22:23:42.870662+08
278	1	cashier	login.success	\N	\N	{}	::1	2026-11-20 22:23:54.14643+08
279	1	cashier	login.success	\N	\N	{}	::1	2026-11-20 22:23:57.67981+08
280	1	cashier	login.success	\N	\N	{}	::1	2026-11-20 22:24:00.359705+08
281	3	owner	login.success	\N	\N	{}	::1	2026-11-20 22:24:26.599739+08
282	3	owner	admin.user_updated	user	1	{"role": "cashier", "isActive": true, "username": "cashier"}	::1	2026-11-20 22:29:14.051716+08
283	3	owner	admin.user_updated	user	1	{"role": "cashier", "isActive": true, "username": "cashier"}	::1	2026-11-20 22:29:18.265288+08
284	1	cashier	login.success	\N	\N	{}	::1	2026-11-20 22:29:24.365692+08
285	1	cashier	login.success	\N	\N	{}	::1	2026-11-20 22:29:26.774768+08
286	1	cashier	login.success	\N	\N	{}	::1	2026-11-20 22:34:42.096325+08
287	1	cashier	login.success	\N	\N	{}	::1	2026-11-20 22:34:44.229058+08
288	1	cashier	login.success	\N	\N	{}	::1	2026-11-20 22:35:02.447878+08
289	1	cashier	login.failed	\N	\N	{"reason": "bad_password"}	::1	2026-11-20 22:35:10.419588+08
290	1	cashier	login.success	\N	\N	{}	::1	2026-11-20 22:35:18.171536+08
291	1	cashier	login.success	\N	\N	{}	::1	2026-11-20 22:43:20.54539+08
292	1	cashier	login.success	\N	\N	{}	::1	2026-11-20 22:45:41.928232+08
293	1	cashier	account.password_changed	user	1	{}	::1	2026-11-20 22:46:13.183761+08
294	1	\N	logout	\N	\N	{}	::1	2026-11-20 22:46:24.772583+08
295	3	owner	login.success	\N	\N	{}	::1	2026-11-20 22:46:33.872463+08
296	3	owner	admin.user_signed_out	user	4	{"username": "smoke_cashier"}	::1	2026-11-20 22:46:43.424706+08
297	3	\N	logout	\N	\N	{}	::1	2026-11-20 22:49:45.606368+08
298	3	owner	login.success	\N	\N	{}	::1	2026-11-20 22:49:54.477566+08
299	3	owner	admin.user_updated	user	2	{"role": "kitchen", "isActive": true, "username": "kitchen"}	::1	2026-11-20 22:50:34.118396+08
301	2	kitchen	login.success	\N	\N	{}	::1	2026-11-20 22:50:56.567335+08
302	2	\N	logout	\N	\N	{}	::1	2026-11-20 22:54:37.372715+08
303	2	kitchen	login.failed	\N	\N	{"reason": "bad_password"}	::1	2026-11-20 22:55:04.011496+08
304	2	kitchen	login.success	\N	\N	{}	::1	2026-11-20 22:55:09.887398+08
305	2	kitchen	account.password_changed	user	2	{}	::1	2026-11-20 22:57:10.232236+08
306	2	\N	logout	\N	\N	{}	::1	2026-11-20 22:57:24.979862+08
307	2	kitchen	login.success	\N	\N	{}	::1	2026-11-20 22:57:35.511813+08
308	2	\N	logout	\N	\N	{}	::1	2026-11-20 22:57:38.201235+08
309	3	owner	login.failed	\N	\N	{"reason": "bad_password"}	::1	2026-11-20 22:57:44.665279+08
310	3	owner	login.success	\N	\N	{}	::1	2026-11-20 22:57:56.719886+08
311	3	owner	admin.user_updated	user	1	{"role": "cashier", "isActive": false, "username": "cashier"}	::1	2026-11-20 22:58:12.518934+08
312	3	owner	admin.user_updated	user	1	{"role": "cashier", "isActive": true, "username": "cashier"}	::1	2026-11-20 22:58:14.348334+08
313	3	owner	item.updated	item	140	{"price": {"to": 4, "from": 3.5}}	::1	2026-11-20 22:58:22.548482+08
314	3	\N	logout	\N	\N	{}	::1	2026-11-20 23:08:59.112291+08
315	2	kitchen	login.success	\N	\N	{}	::1	2026-11-20 23:09:06.636634+08
316	2	kitchen	batch.write_off	batch	91	{"qty": 3, "code": "B-0091", "item": "Bagnet (Crispy Pork Belly)"}	::1	2026-11-20 23:10:35.37989+08
317	2	\N	logout	\N	\N	{}	::1	2026-11-20 23:16:40.039339+08
318	2	kitchen	login.success	\N	\N	{}	::1	2026-11-21 15:16:34.69999+08
319	2	\N	logout	\N	\N	{}	::1	2026-11-21 15:18:28.721549+08
320	1	cashier	login.failed	\N	\N	{"reason": "bad_password"}	::1	2026-11-21 15:18:34.0765+08
321	1	cashier	login.success	\N	\N	{}	::1	2026-11-21 15:18:41.105136+08
322	1	cashier	session.closed	session	6	{"orders": 0, "counted": 2000, "expected": 2000, "netSales": 0, "difference": 0}	::1	2026-11-21 15:18:52.988421+08
323	1	\N	logout	\N	\N	{}	::1	2026-11-21 15:21:42.538637+08
324	2	kitchen	login.success	\N	\N	{}	::1	2026-11-21 18:03:15.310089+08
325	2	\N	logout	\N	\N	{}	::1	2026-11-21 18:04:03.489205+08
326	2	kitchen	login.success	\N	\N	{}	::1	2026-11-21 18:13:46.436074+08
327	2	kitchen	item.created	item	145	{"name": "Chicken Adobo", "type": "food", "batch": "B-0202"}	::1	2026-11-21 18:14:53.907249+08
328	2	kitchen	item.created	item	146	{"name": "Pancit Bihon", "type": "food", "batch": "B-0203"}	::1	2026-11-21 18:15:51.820452+08
329	2	kitchen	batch.created	batch	204	{"qty": 10, "code": "B-0204", "item": "Kare-Kare (Pork Pata)", "expiry": null}	::1	2026-11-21 18:16:10.290958+08
330	2	kitchen	item.created	item	147	{"name": "Kare Kare", "type": "food_tray", "batch": "B-0205"}	::1	2026-11-21 18:17:03.137537+08
331	2	kitchen	item.created	item	148	{"name": "Lumpiang Shanghai", "type": "food_tray", "batch": "B-0206"}	::1	2026-11-21 18:17:41.77495+08
332	2	\N	logout	\N	\N	{}	::1	2026-11-21 18:19:52.845974+08
333	1	cashier	login.failed	\N	\N	{"reason": "bad_password"}	::1	2026-11-21 18:19:57.349137+08
334	1	cashier	login.success	\N	\N	{}	::1	2026-11-21 18:20:09.24199+08
335	1	cashier	session.opened	session	7	{"openingCash": 2000}	::1	2026-11-21 18:21:14.555482+08
336	1	cashier	order.placed	order	10	{"type": "dine_in", "items": 5, "total": 29, "method": "cash", "number": "0010"}	::1	2026-11-21 18:22:31.684039+08
337	1	cashier	order.completed	order	10	{"number": "0010"}	::1	2026-11-21 18:23:03.468403+08
338	1	\N	logout	\N	\N	{}	::1	2026-11-21 18:23:12.682142+08
339	2	kitchen	login.success	\N	\N	{}	::1	2026-11-21 18:23:16.851571+08
340	2	\N	logout	\N	\N	{}	::1	2026-11-21 18:23:47.773652+08
341	1	cashier	login.success	\N	\N	{}	::1	2026-11-21 18:24:03.956153+08
342	1	\N	logout	\N	\N	{}	::1	2026-11-21 18:36:39.979021+08
343	2	kitchen	login.success	\N	\N	{}	::1	2026-11-21 18:36:45.444317+08
344	2	\N	logout	\N	\N	{}	::1	2026-11-21 18:37:40.356356+08
345	1	cashier	login.success	\N	\N	{}	::1	2026-11-21 18:37:45.620167+08
346	1	\N	logout	\N	\N	{}	::1	2026-11-21 18:38:04.105621+08
347	3	owner	login.success	\N	\N	{}	::1	2026-11-21 18:38:26.773105+08
348	3	owner	admin.shop_updated	shop_settings	1	{"name": "Mamitas™ Kitchen", "gstRate": 0.09, "currency": "PESO", "gstRegNo": "", "location": "Singapore", "gstRegistered": false, "expiryWarningDays": 3}	::1	2026-11-21 18:59:53.634863+08
349	3	\N	logout	\N	\N	{}	::1	2026-11-21 19:00:09.685271+08
350	1	cashier	login.success	\N	\N	{}	::1	2026-11-21 19:00:13.102993+08
351	1	\N	logout	\N	\N	{}	::1	2026-11-21 19:00:31.469864+08
352	3	owner	login.failed	\N	\N	{"reason": "bad_password"}	::1	2026-11-21 19:00:40.015632+08
353	3	owner	login.success	\N	\N	{}	::1	2026-11-21 19:00:47.394802+08
354	3	owner	admin.shop_updated	shop_settings	1	{"name": "Mamitas™ Kitchen", "gstRate": 0.09, "currency": "GSD", "gstRegNo": "", "location": "Singapore", "gstRegistered": false, "expiryWarningDays": 3}	::1	2026-11-21 19:00:55.380347+08
355	3	\N	logout	\N	\N	{}	::1	2026-11-21 19:09:17.081938+08
356	2	kitchen	login.success	\N	\N	{}	::1	2026-11-22 15:25:59.190152+08
357	2	kitchen	menu.write_off_expired	item	\N	{"items": 5, "batches": 5, "servings": 35}	::1	2026-11-22 15:26:26.410454+08
358	2	kitchen	batch.created	batch	207	{"qty": 3, "code": "B-0207", "item": "All-Purpose Cream", "expiry": "2028-11-22"}	::1	2026-11-22 15:27:37.665558+08
359	2	kitchen	batch.adjusted	batch	9	{"to": 15, "code": "B-0009", "diff": -2, "from": 17, "item": "All-Purpose Cream", "reason": "Used"}	::1	2026-11-22 15:49:37.011117+08
360	2	kitchen	stock.batch_expiry_updated	batch	9	{"to": "2027-03-14", "itemName": "All-Purpose Cream", "batchCode": "B-0009"}	::1	2026-11-22 16:03:24.778122+08
361	2	kitchen	stock.batch_expiry_updated	batch	9	{"to": "2027-03-14", "itemName": "All-Purpose Cream", "batchCode": "B-0009"}	::1	2026-11-22 16:04:07.741238+08
362	2	kitchen	item.updated	item	28	{"minLevel": {"to": 4, "from": 5}}	::1	2026-11-22 16:04:16.116895+08
363	2	kitchen	batch.adjusted	batch	9	{"to": 10, "code": "B-0009", "diff": -5, "from": 15, "item": "All-Purpose Cream", "reason": "Recount"}	::1	2026-11-22 16:04:44.410324+08
364	2	kitchen	batch.write_off	batch	58	{"qty": 3, "code": "B-0058", "item": "Kangkong"}	::1	2026-11-22 16:05:33.583595+08
365	2	kitchen	batch.write_off	batch	100	{"qty": 3, "code": "B-0100", "item": "Beef Slices"}	::1	2026-11-22 16:05:36.270077+08
366	2	kitchen	batch.loss	batch	104	{"qty": 1, "code": "B-0104", "item": "Bangus", "type": "DAMAGED", "reason": "Dropped"}	::1	2026-11-22 16:23:55.877267+08
367	2	\N	logout	\N	\N	{}	::1	2026-11-22 16:25:01.235844+08
368	3	owner	login.success	\N	\N	{}	::1	2026-11-22 16:25:06.684349+08
369	3	\N	logout	\N	\N	{}	::1	2026-11-22 16:26:02.265021+08
370	3	owner	login.success	\N	\N	{}	::1	2026-11-22 16:26:06.09266+08
371	3	\N	logout	\N	\N	{}	::1	2026-11-22 16:26:08.852859+08
372	1	cashier	login.success	\N	\N	{}	::1	2026-11-22 16:26:12.782698+08
373	1	cashier	session.closed	session	7	{"orders": 1, "counted": 2029, "expected": 2029, "netSales": 29, "difference": 0}	::1	2026-11-22 16:26:29.952039+08
374	1	\N	logout	\N	\N	{}	::1	2026-11-22 16:26:36.639179+08
375	3	owner	login.success	\N	\N	{}	::1	2026-11-22 16:26:44.675456+08
376	3	\N	logout	\N	\N	{}	::1	2026-11-22 16:27:21.555322+08
377	1	cashier	login.success	\N	\N	{}	::1	2026-11-22 16:27:28.066936+08
378	1	\N	logout	\N	\N	{}	::1	2026-11-22 16:28:20.697501+08
379	2	kitchen	login.success	\N	\N	{}	::1	2026-11-22 16:28:24.783042+08
380	2	\N	logout	\N	\N	{}	::1	2026-11-22 17:36:47.264513+08
381	2	kitchen	login.success	\N	\N	{}	::1	2026-11-22 17:36:49.686458+08
382	2	\N	logout	\N	\N	{}	::1	2026-11-22 17:37:21.776959+08
383	2	kitchen	login.success	\N	\N	{}	::1	2026-11-22 17:37:23.753577+08
384	2	\N	logout	\N	\N	{}	::1	2026-11-22 17:37:25.26879+08
385	3	owner	login.success	\N	\N	{}	::1	2026-11-22 17:37:29.634353+08
386	3	\N	logout	\N	\N	{}	::1	2026-11-22 17:37:31.815717+08
387	1	cashier	login.success	\N	\N	{}	::1	2026-11-22 17:37:36.61685+08
388	1	cashier	session.opened	session	8	{"openingCash": 2000}	::1	2026-11-22 17:40:05.521136+08
389	1	\N	logout	\N	\N	{}	::1	2026-11-22 17:47:21.262835+08
390	2	kitchen	login.success	\N	\N	{}	::1	2026-11-22 17:47:25.117785+08
391	2	kitchen	batch.write_off	batch	103	{"qty": 4.5, "code": "B-0103", "item": "Chicken"}	::1	2026-11-22 17:54:30.514276+08
392	2	kitchen	batch.write_off	batch	104	{"qty": 2.6, "code": "B-0104", "item": "Bangus"}	::1	2026-11-22 17:54:32.749836+08
393	2	kitchen	batch.write_off	batch	47	{"qty": 6, "code": "B-0047", "item": "Spring Onion"}	::1	2026-11-22 17:54:34.987252+08
394	2	kitchen	batch.write_off	batch	88	{"qty": 7.5, "code": "B-0088", "item": "Pork Pata"}	::1	2026-11-22 17:54:38.139872+08
395	2	kitchen	batch.write_off	batch	89	{"qty": 3, "code": "B-0089", "item": "Pork Spareribs"}	::1	2026-11-22 17:54:40.41702+08
396	2	kitchen	batch.write_off	batch	90	{"qty": 9.5, "code": "B-0090", "item": "Pork Belly"}	::1	2026-11-22 17:54:42.964369+08
397	2	kitchen	batch.write_off	batch	92	{"qty": 6, "code": "B-0092", "item": "Pork"}	::1	2026-11-22 17:54:51.364333+08
398	2	kitchen	batch.write_off	batch	99	{"qty": 3, "code": "B-0099", "item": "Beef"}	::1	2026-11-22 17:54:53.437148+08
399	2	kitchen	batch.write_off	batch	101	{"qty": 2.4, "code": "B-0101", "item": "Beef Brisket"}	::1	2026-11-22 17:54:55.423216+08
400	2	kitchen	batch.write_off	batch	102	{"qty": 4.5, "code": "B-0102", "item": "Beef Shank (with Marrow)"}	::1	2026-11-22 17:54:57.494203+08
401	2	kitchen	batch.write_off	batch	3	{"qty": 3, "code": "B-0003", "item": "Milk"}	::1	2026-11-22 17:54:59.669957+08
402	2	kitchen	batch.write_off	batch	34	{"qty": 6, "code": "B-0034", "item": "Eggplant"}	::1	2026-11-22 17:55:01.652423+08
403	2	kitchen	batch.write_off	batch	35	{"qty": 9, "code": "B-0035", "item": "Sitaw (String Beans)"}	::1	2026-11-22 17:55:03.748607+08
404	2	kitchen	batch.write_off	batch	37	{"qty": 3, "code": "B-0037", "item": "Banana Blossom"}	::1	2026-11-22 17:55:05.886604+08
405	2	kitchen	batch.write_off	batch	48	{"qty": 1.5, "code": "B-0048", "item": "Ampalaya"}	::1	2026-11-22 17:55:07.98857+08
406	2	kitchen	batch.write_off	batch	49	{"qty": 1.5, "code": "B-0049", "item": "Okra"}	::1	2026-11-22 17:55:11.56857+08
407	2	kitchen	batch.write_off	batch	53	{"qty": 3.6, "code": "B-0053", "item": "Broccoli"}	::1	2026-11-22 17:55:13.765347+08
408	2	kitchen	batch.write_off	batch	62	{"qty": 1.2, "code": "B-0062", "item": "Green Beans"}	::1	2026-11-22 17:55:15.816047+08
409	2	kitchen	batch.write_off	batch	64	{"qty": 2.4, "code": "B-0064", "item": "Mushrooms"}	::1	2026-11-22 17:55:17.868802+08
410	2	kitchen	batch.write_off	batch	66	{"qty": 12, "code": "B-0066", "item": "Corn"}	::1	2026-11-22 17:55:19.968346+08
411	2	kitchen	batch.write_off	batch	67	{"qty": 4.5, "code": "B-0067", "item": "Ripe Mangoes"}	::1	2026-11-22 17:55:22.232491+08
412	2	kitchen	batch.created	batch	208	{"qty": 3, "code": "B-0208", "item": "Ampalaya", "expiry": "2026-12-12"}	::1	2026-11-22 17:55:50.053964+08
413	2	kitchen	batch.created	batch	209	{"qty": 5, "code": "B-0209", "item": "Ampalaya", "expiry": "2027-01-09"}	::1	2026-11-22 17:56:16.159411+08
414	2	kitchen	batch.created	batch	210	{"qty": 3, "code": "B-0210", "item": "Bagoong Alamang", "expiry": "2026-11-28"}	::1	2026-11-22 17:56:32.373361+08
415	2	kitchen	batch.created	batch	211	{"qty": 4, "code": "B-0211", "item": "Bagoong Isda", "expiry": "2026-11-29"}	::1	2026-11-22 17:56:51.404233+08
416	2	kitchen	batch.created	batch	212	{"qty": 4, "code": "B-0212", "item": "Banana Blossom", "expiry": "2026-11-25"}	::1	2026-11-22 17:57:28.40774+08
726	3	owner	order.completed	order	40	{"number": "0040"}	::1	2026-11-23 03:08:21.201684+08
417	2	kitchen	batch.created	batch	213	{"qty": 4, "code": "B-0213", "item": "Bean Sprouts", "expiry": "2026-11-25"}	::1	2026-11-22 17:58:00.65777+08
418	2	kitchen	stock.batch_expiry_updated	batch	40	{"to": "2026-11-28", "itemName": "Bell Pepper", "batchCode": "B-0040"}	::1	2026-11-22 17:58:32.073805+08
419	2	kitchen	batch.created	batch	214	{"qty": 5, "code": "B-0214", "item": "Bell Pepper", "expiry": "2026-12-05"}	::1	2026-11-22 17:58:42.708862+08
420	2	kitchen	batch.created	batch	215	{"qty": 3, "code": "B-0215", "item": "Broccoli", "expiry": "2026-11-28"}	::1	2026-11-22 17:59:01.608269+08
421	2	kitchen	batch.created	batch	216	{"qty": 6, "code": "B-0216", "item": "Cauliflower", "expiry": "2026-11-28"}	::1	2026-11-22 17:59:17.906396+08
427	2	kitchen	batch.created	batch	222	{"qty": 4, "code": "B-0222", "item": "Eggplant", "expiry": "2026-11-28"}	::1	2026-11-22 18:01:50.013668+08
429	2	kitchen	batch.created	batch	224	{"qty": 4, "code": "B-0224", "item": "Kangkong", "expiry": "2026-11-28"}	::1	2026-11-22 18:02:18.318592+08
433	2	kitchen	batch.created	batch	228	{"qty": 3, "code": "B-0228", "item": "Mushrooms", "expiry": "2026-12-05"}	::1	2026-11-22 18:03:21.889877+08
434	2	kitchen	batch.created	batch	229	{"qty": 4, "code": "B-0229", "item": "Okra", "expiry": "2026-12-12"}	::1	2026-11-22 18:03:33.536491+08
437	2	kitchen	batch.created	batch	232	{"qty": 4, "code": "B-0232", "item": "Bagnet (Crispy Pork Belly)", "expiry": "2026-12-02"}	::1	2026-11-22 18:05:02.272134+08
439	2	kitchen	batch.created	batch	234	{"qty": 5, "code": "B-0234", "item": "Beef", "expiry": "2026-12-02"}	::1	2026-11-22 18:05:21.42299+08
442	2	kitchen	batch.created	batch	237	{"qty": 5, "code": "B-0237", "item": "Beef Slices", "expiry": "2026-12-02"}	::1	2026-11-22 18:05:55.09573+08
443	2	kitchen	batch.created	batch	238	{"qty": 6, "code": "B-0238", "item": "Chicken", "expiry": "2026-12-02"}	::1	2026-11-22 18:06:04.805537+08
444	2	kitchen	batch.created	batch	239	{"qty": 6, "code": "B-0239", "item": "Ground Pork", "expiry": "2026-12-02"}	::1	2026-11-22 18:06:26.835117+08
446	2	kitchen	batch.created	batch	241	{"qty": 6, "code": "B-0241", "item": "Pork Belly", "expiry": "2026-12-08"}	::1	2026-11-22 18:06:46.273101+08
448	2	kitchen	batch.created	batch	243	{"qty": 3, "code": "B-0243", "item": "Pork Belly", "expiry": "2026-12-02"}	::1	2026-11-22 18:07:04.951807+08
449	2	kitchen	batch.created	batch	244	{"qty": 7, "code": "B-0244", "item": "Pork Heart", "expiry": "2026-11-28"}	::1	2026-11-22 18:07:17.220576+08
451	2	kitchen	batch.created	batch	246	{"qty": 6, "code": "B-0246", "item": "Pork Liver", "expiry": "2026-12-02"}	::1	2026-11-22 18:07:37.056095+08
452	2	kitchen	batch.created	batch	247	{"qty": 7, "code": "B-0247", "item": "Pork Lungs", "expiry": "2026-12-02"}	::1	2026-11-22 18:07:48.181519+08
453	2	kitchen	batch.adjusted	batch	247	{"to": 5, "code": "B-0247", "diff": -2, "from": 7, "item": "Pork Lungs", "reason": "Recount"}	::1	2026-11-22 18:08:04.231468+08
454	2	kitchen	batch.created	batch	248	{"qty": 5, "code": "B-0248", "item": "Pork Pata", "expiry": "2026-12-02"}	::1	2026-11-22 18:08:20.432653+08
456	2	kitchen	batch.created	batch	250	{"qty": 3, "code": "B-0250", "item": "Shrimp", "expiry": "2026-12-02"}	::1	2026-11-22 18:08:41.457442+08
457	2	kitchen	batch.created	batch	251	{"qty": 5, "code": "B-0251", "item": "Fruit Salad", "expiry": null}	::1	2026-11-22 18:09:08.621133+08
459	2	kitchen	batch.created	batch	253	{"qty": 6, "code": "B-0253", "item": "Macaroni Salad", "expiry": null}	::1	2026-11-22 18:09:18.728107+08
460	2	kitchen	batch.created	batch	254	{"qty": 7, "code": "B-0254", "item": "Mango Graham", "expiry": null}	::1	2026-11-22 18:09:23.649324+08
461	2	kitchen	batch.created	batch	255	{"qty": 5, "code": "B-0255", "item": "Ube Bar", "expiry": null}	::1	2026-11-22 18:09:28.799656+08
463	2	kitchen	batch.created	batch	257	{"qty": 5, "code": "B-0257", "item": "Beef Mushroom", "expiry": null}	::1	2026-11-22 18:09:40.587024+08
465	2	kitchen	batch.created	batch	259	{"qty": 7, "code": "B-0259", "item": "Binagoongan", "expiry": null}	::1	2026-11-22 18:09:51.37326+08
466	2	kitchen	batch.created	batch	260	{"qty": 8, "code": "B-0260", "item": "Bistek Tagalog", "expiry": null}	::1	2026-11-22 18:09:57.202228+08
467	2	kitchen	batch.created	batch	261	{"qty": 5, "code": "B-0261", "item": "Bopis", "expiry": null}	::1	2026-11-22 18:10:04.04323+08
468	2	kitchen	batch.created	batch	262	{"qty": 5, "code": "B-0262", "item": "Chicken Adobo", "expiry": null}	::1	2026-11-22 18:10:09.891359+08
476	2	kitchen	batch.created	batch	270	{"qty": 5, "code": "B-0270", "item": "Kaldereta Spareribs", "expiry": null}	::1	2026-11-22 18:12:56.942996+08
477	2	kitchen	batch.created	batch	271	{"qty": 5, "code": "B-0271", "item": "Kare-Kare (Pork Pata)", "expiry": null}	::1	2026-11-22 18:13:01.765358+08
480	2	kitchen	menu.adjusted	item	120	{"to": 10, "diff": -91, "from": 101, "item": "Menudo", "reason": "Mistyped"}	::1	2026-11-22 18:13:29.051329+08
481	2	kitchen	batch.created	batch	274	{"qty": 5, "code": "B-0274", "item": "Monggo", "expiry": null}	::1	2026-11-22 18:13:34.969973+08
482	2	kitchen	batch.created	batch	275	{"qty": 5, "code": "B-0275", "item": "Pakbet", "expiry": null}	::1	2026-11-22 18:13:50.239348+08
483	2	kitchen	batch.created	batch	276	{"qty": 5, "code": "B-0276", "item": "Chicharon Bulaklak", "expiry": null}	::1	2026-11-22 18:14:14.619725+08
488	2	kitchen	batch.created	batch	281	{"qty": 15, "code": "B-0281", "item": "Pork Shanghai", "expiry": null}	::1	2026-11-22 18:14:46.259234+08
490	2	kitchen	batch.created	batch	283	{"qty": 8, "code": "B-0283", "item": "Pancit Bihon", "expiry": null}	::1	2026-11-22 18:15:01.142391+08
422	2	kitchen	batch.created	batch	217	{"qty": 5, "code": "B-0217", "item": "Pechay", "expiry": "2026-11-28"}	::1	2026-11-22 18:00:16.721138+08
423	2	kitchen	batch.created	batch	218	{"qty": 6, "code": "B-0218", "item": "Ripe Mangoes", "expiry": "2026-12-05"}	::1	2026-11-22 18:00:33.827968+08
424	2	kitchen	batch.created	batch	219	{"qty": 4, "code": "B-0219", "item": "Sitaw (String Beans)", "expiry": "2026-11-28"}	::1	2026-11-22 18:00:42.648536+08
425	2	kitchen	batch.created	batch	220	{"qty": 8, "code": "B-0220", "item": "Corn", "expiry": "2026-11-28"}	::1	2026-11-22 18:01:26.938349+08
426	2	kitchen	batch.created	batch	221	{"qty": 3, "code": "B-0221", "item": "Corn", "expiry": "2026-12-02"}	::1	2026-11-22 18:01:37.693535+08
428	2	kitchen	batch.created	batch	223	{"qty": 2, "code": "B-0223", "item": "Green Beans", "expiry": "2026-11-28"}	::1	2026-11-22 18:02:08.910716+08
430	2	kitchen	batch.created	batch	225	{"qty": 3, "code": "B-0225", "item": "Long Green Chili", "expiry": "2026-11-28"}	::1	2026-11-22 18:02:28.071634+08
431	2	kitchen	batch.created	batch	226	{"qty": 4, "code": "B-0226", "item": "Malunggay", "expiry": "2026-11-28"}	::1	2026-11-22 18:02:38.818835+08
432	2	kitchen	batch.created	batch	227	{"qty": 6, "code": "B-0227", "item": "Milk", "expiry": "2027-01-09"}	::1	2026-11-22 18:03:12.837036+08
435	2	kitchen	batch.created	batch	230	{"qty": 5, "code": "B-0230", "item": "Spinach", "expiry": "2026-12-12"}	::1	2026-11-22 18:03:54.059049+08
436	2	kitchen	batch.created	batch	231	{"qty": 4, "code": "B-0231", "item": "Spring Onion", "expiry": "2026-12-05"}	::1	2026-11-22 18:04:02.157606+08
438	2	kitchen	batch.created	batch	233	{"qty": 5, "code": "B-0233", "item": "Bangus", "expiry": "2026-12-02"}	::1	2026-11-22 18:05:11.502851+08
440	2	kitchen	batch.created	batch	235	{"qty": 5, "code": "B-0235", "item": "Beef Brisket", "expiry": "2026-12-02"}	::1	2026-11-22 18:05:32.83283+08
441	2	kitchen	batch.created	batch	236	{"qty": 5, "code": "B-0236", "item": "Beef Shank (with Marrow)", "expiry": "2026-12-02"}	::1	2026-11-22 18:05:42.222136+08
445	2	kitchen	batch.created	batch	240	{"qty": 5, "code": "B-0240", "item": "Pork", "expiry": "2026-12-03"}	::1	2026-11-22 18:06:35.803707+08
447	2	kitchen	batch.created	batch	242	{"qty": 7, "code": "B-0242", "item": "Pork Blood", "expiry": "2026-11-28"}	::1	2026-11-22 18:06:54.370384+08
450	2	kitchen	batch.created	batch	245	{"qty": 6, "code": "B-0245", "item": "Pork Intestines", "expiry": "2026-11-28"}	::1	2026-11-22 18:07:28.65103+08
455	2	kitchen	batch.created	batch	249	{"qty": 6, "code": "B-0249", "item": "Pork Spareribs", "expiry": "2026-12-02"}	::1	2026-11-22 18:08:29.477537+08
458	2	kitchen	batch.created	batch	252	{"qty": 5, "code": "B-0252", "item": "Leche Flan", "expiry": null}	::1	2026-11-22 18:09:14.342463+08
462	2	kitchen	batch.created	batch	256	{"qty": 5, "code": "B-0256", "item": "Beef Broccoli", "expiry": null}	::1	2026-11-22 18:09:34.289773+08
464	2	kitchen	batch.created	batch	258	{"qty": 10, "code": "B-0258", "item": "Bicol Express", "expiry": null}	::1	2026-11-22 18:09:45.923411+08
469	2	kitchen	batch.created	batch	263	{"qty": 10, "code": "B-0263", "item": "Chicken Afritada", "expiry": null}	::1	2026-11-22 18:10:17.790587+08
470	2	kitchen	item.created	item	149	{"name": "Rice", "type": "food", "batch": "B-0264"}	::1	2026-11-22 18:11:32.657183+08
471	2	kitchen	item.created	item	150	{"name": "Fried Rice", "type": "food", "batch": "B-0265"}	::1	2026-11-22 18:12:12.411481+08
472	2	kitchen	batch.created	batch	266	{"qty": 10, "code": "B-0266", "item": "Chop Suey", "expiry": null}	::1	2026-11-22 18:12:26.80928+08
473	2	kitchen	batch.created	batch	267	{"qty": 10, "code": "B-0267", "item": "Classic Dinuguan", "expiry": null}	::1	2026-11-22 18:12:30.507386+08
474	2	kitchen	batch.created	batch	268	{"qty": 10, "code": "B-0268", "item": "Ginataang Sitaw at Kalabasa", "expiry": null}	::1	2026-11-22 18:12:34.973501+08
475	2	kitchen	batch.created	batch	269	{"qty": 10, "code": "B-0269", "item": "Giniling na Baboy", "expiry": null}	::1	2026-11-22 18:12:38.468774+08
478	2	kitchen	batch.created	batch	272	{"qty": 5, "code": "B-0272", "item": "Lechon Kawali", "expiry": null}	::1	2026-11-22 18:13:06.319132+08
479	2	kitchen	batch.created	batch	273	{"qty": 101, "code": "B-0273", "item": "Menudo", "expiry": null}	::1	2026-11-22 18:13:10.15895+08
484	2	kitchen	batch.created	batch	277	{"qty": 5, "code": "B-0277", "item": "Embutido", "expiry": null}	::1	2026-11-22 18:14:18.945731+08
485	2	kitchen	batch.created	batch	278	{"qty": 3, "code": "B-0278", "item": "Chicharon Bulaklak", "expiry": null}	::1	2026-11-22 18:14:25.741314+08
486	2	kitchen	batch.created	batch	279	{"qty": 1, "code": "B-0279", "item": "Embutido", "expiry": null}	::1	2026-11-22 18:14:32.129295+08
487	2	kitchen	batch.created	batch	280	{"qty": 10, "code": "B-0280", "item": "Kwek-Kwek", "expiry": null}	::1	2026-11-22 18:14:39.871902+08
489	2	kitchen	batch.created	batch	282	{"qty": 8, "code": "B-0282", "item": "Beef Mami", "expiry": null}	::1	2026-11-22 18:14:57.304533+08
491	2	kitchen	batch.created	batch	284	{"qty": 8, "code": "B-0284", "item": "Special Bulalo", "expiry": null}	::1	2026-11-22 18:15:05.138549+08
492	2	\N	logout	\N	\N	{}	::1	2026-11-22 18:18:10.738653+08
493	3	owner	login.success	\N	\N	{}	::1	2026-11-22 18:18:15.332351+08
494	3	\N	logout	\N	\N	{}	::1	2026-11-22 18:41:27.144983+08
495	3	owner	login.success	\N	\N	{}	::1	2026-11-22 18:41:35.525739+08
496	3	owner	session.closed	session	5	{"orders": 0, "counted": 200, "expected": 200, "netSales": 0, "difference": 0}	::1	2026-11-22 18:56:37.886041+08
497	3	\N	logout	\N	\N	{}	::1	2026-11-22 18:57:03.024099+08
498	1	cashier	login.success	\N	\N	{}	::1	2026-11-22 18:57:07.612665+08
499	1	cashier	order.placed	order	11	{"type": "dine_in", "items": 2, "total": 21, "method": "cash", "number": "0011"}	::1	2026-11-22 18:57:18.435262+08
500	1	cashier	order.placed	order	12	{"type": "takeaway", "items": 2, "total": 18, "method": "cash", "number": "0012"}	::1	2026-11-22 18:57:31.486308+08
727	3	owner	order.completed	order	38	{"number": "0038"}	::1	2026-11-23 03:08:22.588318+08
501	1	cashier	order.placed	order	13	{"type": "takeaway", "items": 2, "total": 13, "method": "cash", "number": "0013"}	::1	2026-11-22 18:57:48.076625+08
502	1	cashier	order.completed	order	13	{"number": "0013"}	::1	2026-11-22 18:57:58.269391+08
503	1	cashier	order.completed	order	12	{"number": "0012"}	::1	2026-11-22 18:57:59.515012+08
504	1	cashier	order.completed	order	11	{"number": "0011"}	::1	2026-11-22 18:58:00.681674+08
505	1	\N	logout	\N	\N	{}	::1	2026-11-22 18:58:11.95566+08
506	3	owner	login.success	\N	\N	{}	::1	2026-11-22 18:58:17.293557+08
507	3	\N	logout	\N	\N	{}	::1	2026-11-22 19:12:47.698491+08
508	3	owner	login.success	\N	\N	{}	::1	2026-11-22 19:12:50.348762+08
509	3	owner	item.updated	item	140	{"isActive": {"to": false, "from": true}}	::1	2026-11-22 19:15:33.737921+08
510	3	owner	item.updated	item	140	{"isActive": {"to": false, "from": false}}	::1	2026-11-22 19:15:36.563572+08
511	3	owner	item.updated	item	140	{"isActive": {"to": false, "from": false}}	::1	2026-11-22 19:15:37.973502+08
512	3	owner	item.updated	item	140	{"isActive": {"to": false, "from": false}}	::1	2026-11-22 19:15:38.727683+08
513	3	owner	item.updated	item	140	{"isActive": {"to": false, "from": false}}	::1	2026-11-22 19:15:39.327934+08
514	3	owner	item.updated	item	140	{"isActive": {"to": false, "from": false}}	::1	2026-11-22 19:15:39.848729+08
515	3	owner	item.updated	item	141	{"isActive": {"to": false, "from": true}}	::1	2026-11-22 19:15:54.179214+08
516	3	owner	item.updated	item	143	{"isActive": {"to": false, "from": true}}	::1	2026-11-22 19:16:59.866861+08
517	3	owner	item.updated	item	139	{"isActive": {"to": false, "from": true}}	::1	2026-11-22 19:18:36.896477+08
518	3	owner	item.updated	item	142	{"isActive": {"to": false, "from": true}}	::1	2026-11-22 19:26:45.533402+08
519	3	\N	logout	\N	\N	{}	::1	2026-11-22 19:45:10.14875+08
520	1	cashier	login.success	\N	\N	{}	::1	2026-11-22 19:45:14.786081+08
521	1	cashier	order.placed	order	14	{"type": "dine_in", "items": 3, "total": 26.5, "method": "cash", "number": "0014"}	::1	2026-11-22 19:49:48.411192+08
522	1	cashier	order.placed	order	15	{"type": "dine_in", "items": 4, "total": 27.5, "method": "paynow", "number": "0015"}	::1	2026-11-22 19:50:21.018163+08
523	1	cashier	order.placed	order	16	{"type": "dine_in", "items": 1, "total": 5.5, "method": "card", "number": "0016"}	::1	2026-11-22 19:50:35.559145+08
524	1	cashier	order.placed	order	17	{"type": "dine_in", "items": 18, "total": 178.5, "method": "cash", "number": "0017"}	::1	2026-11-22 19:51:10.911979+08
525	1	cashier	order.placed	order	18	{"type": "dine_in", "items": 4, "total": 45, "method": "paynow", "number": "0018"}	::1	2026-11-22 19:51:57.57718+08
526	1	cashier	order.placed	order	19	{"type": "dine_in", "items": 7, "total": 80.5, "method": "card", "number": "0019"}	::1	2026-11-22 19:52:27.177681+08
527	1	cashier	order.placed	order	20	{"type": "dine_in", "items": 5, "total": 54.5, "method": "cash", "number": "0020"}	::1	2026-11-22 19:52:36.987898+08
528	1	cashier	order.placed	order	21	{"type": "dine_in", "items": 9, "total": 77.5, "method": "cash", "number": "0021"}	::1	2026-11-22 19:52:51.614615+08
529	1	cashier	order.placed	order	22	{"type": "dine_in", "items": 6, "total": 61, "method": "cash", "number": "0022"}	::1	2026-11-22 19:53:07.028101+08
530	1	cashier	order.placed	order	23	{"type": "dine_in", "items": 3, "total": 36, "method": "paynow", "number": "0023"}	::1	2026-11-22 19:53:15.743745+08
531	1	cashier	order.placed	order	24	{"type": "dine_in", "items": 12, "total": 114, "method": "cash", "number": "0024"}	::1	2026-11-22 19:53:54.245648+08
532	1	cashier	order.placed	order	25	{"type": "dine_in", "items": 10, "total": 74, "method": "cash", "number": "0025"}	::1	2026-11-22 19:54:24.707279+08
533	1	cashier	order.placed	order	26	{"type": "dine_in", "items": 6, "total": 56, "method": "cash", "number": "0026"}	::1	2026-11-22 19:54:44.438687+08
534	1	cashier	order.placed	order	27	{"type": "dine_in", "items": 3, "total": 18, "method": "cash", "number": "0027"}	::1	2026-11-22 19:55:04.138144+08
535	1	cashier	order.placed	order	28	{"type": "dine_in", "items": 7, "total": 74.5, "method": "card", "number": "0028"}	::1	2026-11-22 19:55:19.52072+08
536	1	cashier	order.placed	order	29	{"type": "dine_in", "items": 5, "total": 47.5, "method": "cash", "number": "0029"}	::1	2026-11-22 19:55:28.97929+08
537	1	cashier	order.placed	order	30	{"type": "dine_in", "items": 5, "total": 47.5, "method": "cash", "number": "0030"}	::1	2026-11-22 19:55:37.936786+08
538	1	cashier	order.placed	order	31	{"type": "dine_in", "items": 4, "total": 39.5, "method": "cash", "number": "0031"}	::1	2026-11-22 19:55:46.137491+08
539	1	cashier	order.placed	order	32	{"type": "dine_in", "items": 6, "total": 60.5, "method": "cash", "number": "0032"}	::1	2026-11-22 19:56:05.128056+08
540	1	cashier	order.placed	order	33	{"type": "dine_in", "items": 10, "total": 57.5, "method": "paynow", "number": "0033"}	::1	2026-11-22 19:56:17.614782+08
541	1	cashier	order.placed	order	34	{"type": "dine_in", "items": 7, "total": 59.5, "method": "cash", "number": "0034"}	::1	2026-11-22 19:56:50.523768+08
542	1	cashier	order.placed	order	35	{"type": "dine_in", "items": 6, "total": 43, "method": "card", "number": "0035"}	::1	2026-11-22 19:57:01.771171+08
543	1	cashier	order.placed	order	36	{"type": "dine_in", "items": 5, "total": 47.5, "method": "cash", "number": "0036"}	::1	2026-11-22 19:57:17.304882+08
544	1	cashier	order.placed	order	37	{"type": "dine_in", "items": 2, "total": 12, "method": "card", "number": "0037"}	::1	2026-11-22 19:57:26.197328+08
545	1	cashier	order.placed	order	38	{"type": "dine_in", "items": 21, "total": 114, "method": "cash", "number": "0038"}	::1	2026-11-22 19:57:46.254812+08
546	1	cashier	order.placed	order	39	{"type": "dine_in", "items": 4, "total": 34, "method": "cash", "number": "0039"}	::1	2026-11-22 19:57:58.683567+08
547	1	cashier	order.placed	order	40	{"type": "dine_in", "items": 10, "total": 76.5, "method": "cash", "number": "0040"}	::1	2026-11-22 19:58:15.379703+08
548	1	cashier	order.placed	order	41	{"type": "dine_in", "items": 15, "total": 94.5, "method": "cash", "number": "0041"}	::1	2026-11-22 19:58:33.634777+08
549	1	cashier	order.placed	order	42	{"type": "dine_in", "items": 12, "total": 112, "method": "paynow", "number": "0042"}	::1	2026-11-22 19:58:49.400887+08
550	1	\N	logout	\N	\N	{}	::1	2026-11-22 19:59:50.345582+08
551	2	kitchen	login.success	\N	\N	{}	::1	2026-11-22 19:59:55.31057+08
552	2	\N	logout	\N	\N	{}	::1	2026-11-22 20:00:36.837003+08
553	3	owner	login.success	\N	\N	{}	::1	2026-11-22 20:00:40.983154+08
554	3	\N	logout	\N	\N	{}	::1	2026-11-22 20:03:02.76186+08
555	3	owner	login.success	\N	\N	{}	::1	2026-11-22 20:04:24.884412+08
556	3	owner	batch.created	batch	285	{"qty": 10, "code": "B-0285", "item": "Chicken Adobo", "expiry": null}	::1	2026-11-22 20:06:03.097081+08
557	3	owner	batch.created	batch	286	{"qty": 5, "code": "B-0286", "item": "Pancit Bihon", "expiry": null}	::1	2026-11-22 20:06:35.767996+08
558	3	owner	batch.created	batch	287	{"qty": 4, "code": "B-0287", "item": "Kare Kare", "expiry": null}	::1	2026-11-22 20:06:53.141116+08
559	3	owner	batch.created	batch	288	{"qty": 5, "code": "B-0288", "item": "Lumpiang Shanghai", "expiry": null}	::1	2026-11-22 20:07:02.441855+08
560	3	\N	logout	\N	\N	{}	::1	2026-11-22 20:07:21.046186+08
561	1	cashier	login.success	\N	\N	{}	::1	2026-11-22 20:07:27.171549+08
562	1	cashier	order.placed	order	43	{"type": "dine_in", "items": 5, "total": 29, "method": "cash", "number": "0043"}	::1	2026-11-22 20:11:19.453376+08
563	1	cashier	order.completed	order	43	{"number": "0043"}	::1	2026-11-22 20:13:06.449565+08
564	1	\N	logout	\N	\N	{}	::1	2026-11-22 20:13:47.745887+08
565	3	owner	login.success	\N	\N	{}	::1	2026-11-22 20:13:55.3955+08
566	3	\N	logout	\N	\N	{}	::1	2026-11-22 20:15:25.17851+08
567	1	cashier	login.success	\N	\N	{}	::1	2026-11-22 20:15:30.312966+08
568	1	cashier	order.placed	order	44	{"type": "dine_in", "items": 3, "total": 165, "method": "paynow", "number": "0044"}	::1	2026-11-22 20:17:08.990704+08
569	1	cashier	order.placed	order	45	{"type": "dine_in", "items": 6, "total": 300, "method": "cash", "number": "0045"}	::1	2026-11-22 20:17:51.795772+08
570	1	\N	logout	\N	\N	{}	::1	2026-11-22 20:19:29.849073+08
571	2	kitchen	login.success	\N	\N	{}	::1	2026-11-22 20:19:33.788155+08
572	2	kitchen	batch.created	batch	289	{"qty": 2, "code": "B-0289", "item": "Lumpiang Shanghai", "expiry": null}	::1	2026-11-22 20:19:44.740038+08
573	2	\N	logout	\N	\N	{}	::1	2026-11-22 20:19:46.410031+08
574	2	kitchen	login.success	\N	\N	{}	::1	2026-11-22 20:19:51.856344+08
575	2	\N	logout	\N	\N	{}	::1	2026-11-22 20:19:57.644488+08
576	1	cashier	login.success	\N	\N	{}	::1	2026-11-22 20:20:00.828523+08
577	1	cashier	order.placed	order	46	{"type": "dine_in", "items": 2, "total": 90, "method": "paynow", "number": "0046"}	::1	2026-11-22 20:21:32.249881+08
578	1	\N	logout	\N	\N	{}	::1	2026-11-22 20:21:48.16155+08
579	1	cashier	login.success	\N	\N	{}	::1	2026-11-22 22:47:59.186744+08
580	1	\N	logout	\N	\N	{}	::1	2026-11-22 23:31:28.938138+08
581	2	kitchen	login.success	\N	\N	{}	::1	2026-11-22 23:31:33.369587+08
582	2	kitchen	batch.created	batch	290	{"qty": 5, "code": "B-0290", "item": "Beef Broccoli", "expiry": null}	::1	2026-11-22 23:31:42.120586+08
583	2	kitchen	batch.created	batch	291	{"qty": 6, "code": "B-0291", "item": "Beef Mushroom", "expiry": null}	::1	2026-11-22 23:31:47.439924+08
584	2	kitchen	batch.created	batch	292	{"qty": 6, "code": "B-0292", "item": "Bicol Express", "expiry": null}	::1	2026-11-22 23:31:54.415088+08
585	2	kitchen	batch.created	batch	293	{"qty": 4, "code": "B-0293", "item": "Bicol Express", "expiry": null}	::1	2026-11-22 23:31:58.834546+08
586	2	kitchen	batch.created	batch	294	{"qty": 4, "code": "B-0294", "item": "Binagoongan", "expiry": null}	::1	2026-11-22 23:32:04.162767+08
587	2	kitchen	batch.created	batch	295	{"qty": 6, "code": "B-0295", "item": "Bistek Tagalog", "expiry": null}	::1	2026-11-22 23:32:09.040029+08
588	2	kitchen	batch.created	batch	296	{"qty": 6, "code": "B-0296", "item": "Bopis", "expiry": null}	::1	2026-11-22 23:32:16.143852+08
589	2	kitchen	batch.created	batch	297	{"qty": 6, "code": "B-0297", "item": "Chicken Afritada", "expiry": null}	::1	2026-11-22 23:32:21.579126+08
590	2	kitchen	batch.created	batch	298	{"qty": 6, "code": "B-0298", "item": "Chop Suey", "expiry": null}	::1	2026-11-22 23:32:27.366489+08
591	2	kitchen	batch.created	batch	299	{"qty": 13, "code": "B-0299", "item": "Chicken Adobo", "expiry": null}	::1	2026-11-22 23:39:50.530969+08
592	2	kitchen	batch.created	batch	300	{"qty": 7, "code": "B-0300", "item": "Pancit Bihon", "expiry": null}	::1	2026-11-22 23:40:09.511598+08
593	2	kitchen	batch.created	batch	301	{"qty": 2, "code": "B-0301", "item": "Pancit Bihon", "expiry": null}	::1	2026-11-22 23:40:14.323015+08
594	2	kitchen	batch.created	batch	302	{"qty": 55, "code": "B-0302", "item": "Kare Kare", "expiry": null}	::1	2026-11-22 23:40:33.958404+08
595	2	kitchen	menu.adjusted	item	147	{"to": 5, "diff": -50, "from": 55, "item": "Kare Kare", "reason": "Mistyped"}	::1	2026-11-22 23:40:42.766223+08
596	2	kitchen	menu.adjusted	item	148	{"to": 3, "diff": 3, "from": 0, "item": "Lumpiang Shanghai", "reason": "Stock count"}	::1	2026-11-22 23:40:52.677266+08
597	2	\N	logout	\N	\N	{}	::1	2026-11-22 23:41:06.426696+08
598	1	cashier	login.success	\N	\N	{}	::1	2026-11-22 23:41:10.273043+08
599	1	cashier	session.closed	session	8	{"orders": 36, "counted": 3662, "expected": 3662, "netSales": 2410.5, "difference": 0}	::1	2026-11-23 00:07:08.963532+08
600	1	cashier	session.opened	session	9	{"openingCash": 2000}	::1	2026-11-23 00:09:39.448533+08
601	1	\N	logout	\N	\N	{}	::1	2026-11-23 00:09:46.140115+08
602	2	kitchen	login.success	\N	\N	{}	::1	2026-11-23 00:09:49.981193+08
788	3	owner	login.success	\N	\N	{}	::1	2026-11-23 03:43:42.320225+08
603	2	kitchen	menu.write_off_expired	item	\N	{"items": 19, "batches": 24, "servings": 174}	::1	2026-11-23 00:10:04.262922+08
604	2	kitchen	batch.created	batch	304	{"qty": 20, "code": "B-0304", "item": "Chicken Adobo", "expiry": null}	::1	2026-11-23 00:10:15.005689+08
607	2	kitchen	batch.created	batch	307	{"qty": 5, "code": "B-0307", "item": "Kare Kare", "expiry": null}	::1	2026-11-23 00:10:44.056444+08
605	2	kitchen	batch.created	batch	305	{"qty": 15, "code": "B-0305", "item": "Pancit Bihon", "expiry": null}	::1	2026-11-23 00:10:25.316884+08
606	2	kitchen	batch.created	batch	306	{"qty": 3, "code": "B-0306", "item": "Lumpiang Shanghai", "expiry": null}	::1	2026-11-23 00:10:36.963383+08
608	2	\N	logout	\N	\N	{}	::1	2026-11-23 00:10:49.305154+08
609	1	cashier	login.success	\N	\N	{}	::1	2026-11-23 00:10:53.594825+08
610	1	cashier	order.placed	order	47	{"type": "dine_in", "items": 5, "total": 29, "method": "cash", "number": "0047"}	::1	2026-11-23 00:16:52.302774+08
611	1	cashier	order.completed	order	46	{"number": "0046"}	::1	2026-11-23 00:20:46.360191+08
612	1	cashier	order.completed	order	45	{"number": "0045"}	::1	2026-11-23 00:20:47.626154+08
613	1	cashier	order.completed	order	44	{"number": "0044"}	::1	2026-11-23 00:20:48.633258+08
614	1	cashier	order.completed	order	47	{"number": "0047"}	::1	2026-11-23 00:20:53.217644+08
615	1	\N	logout	\N	\N	{}	::1	2026-11-23 00:22:31.231787+08
616	2	kitchen	login.success	\N	\N	{}	::1	2026-11-23 00:22:35.539725+08
617	2	\N	logout	\N	\N	{}	::1	2026-11-23 00:26:35.314199+08
618	3	owner	login.success	\N	\N	{}	::1	2026-11-23 00:26:39.180042+08
619	3	\N	logout	\N	\N	{}	::1	2026-11-23 00:29:26.363825+08
620	1	cashier	login.success	\N	\N	{}	::1	2026-11-23 00:29:30.007467+08
621	1	cashier	order.placed	order	48	{"type": "dine_in", "items": 3, "total": 165, "method": "cash", "number": "0048"}	::1	2026-11-23 00:33:09.742263+08
622	1	\N	logout	\N	\N	{}	::1	2026-11-23 00:33:42.411884+08
623	3	owner	login.success	\N	\N	{}	::1	2026-11-23 00:33:46.779517+08
624	3	\N	logout	\N	\N	{}	::1	2026-11-23 00:33:48.198904+08
625	2	kitchen	login.success	\N	\N	{}	::1	2026-11-23 00:33:52.862407+08
626	2	kitchen	batch.created	batch	308	{"qty": 2, "code": "B-0308", "item": "Kare Kare", "expiry": null}	::1	2026-11-23 00:34:17.273906+08
627	2	kitchen	batch.created	batch	309	{"qty": 1, "code": "B-0309", "item": "Lumpiang Shanghai", "expiry": null}	::1	2026-11-23 00:34:22.351429+08
628	2	\N	logout	\N	\N	{}	::1	2026-11-23 00:34:24.998111+08
629	1	cashier	login.success	\N	\N	{}	::1	2026-11-23 00:34:32.789134+08
630	1	cashier	order.placed	order	49	{"type": "dine_in", "items": 3, "total": 165, "method": "paynow", "number": "0049"}	::1	2026-11-23 00:34:42.911425+08
631	1	cashier	order.placed	order	50	{"type": "dine_in", "items": 2, "total": 90, "method": "paynow", "number": "0050"}	::1	2026-11-23 00:37:40.88192+08
632	1	\N	logout	\N	\N	{}	::1	2026-11-23 00:45:57.914246+08
633	2	kitchen	login.success	\N	\N	{}	::1	2026-11-23 00:46:01.483574+08
634	2	kitchen	menu.adjusted	item	146	{"to": 2, "diff": -11, "from": 13, "item": "Pancit Bihon", "reason": "Used"}	::1	2026-11-23 00:46:15.008516+08
635	2	\N	logout	\N	\N	{}	::1	2026-11-23 00:46:16.90303+08
636	1	cashier	login.success	\N	\N	{}	::1	2026-11-23 00:46:22.052025+08
637	1	cashier	order.placed	order	51	{"type": "dine_in", "items": 2, "total": 11, "method": "cash", "number": "0051"}	::1	2026-11-23 00:51:07.245124+08
638	1	\N	logout	\N	\N	{}	::1	2026-11-23 00:58:16.413032+08
639	2	kitchen	login.success	\N	\N	{}	::1	2026-11-23 00:58:20.252812+08
640	2	kitchen	batch.created	batch	310	{"qty": 2, "code": "B-0310", "item": "Pancit Bihon", "expiry": null}	::1	2026-11-23 00:58:26.843905+08
641	2	\N	logout	\N	\N	{}	::1	2026-11-23 00:58:28.7108+08
642	1	cashier	login.success	\N	\N	{}	::1	2026-11-23 00:58:33.268394+08
643	1	cashier	order.placed	order	52	{"type": "dine_in", "items": 2, "total": 11, "method": "cash", "number": "0052"}	::1	2026-11-23 00:59:15.055028+08
644	1	\N	logout	\N	\N	{}	::1	2026-11-23 01:06:46.495781+08
645	2	kitchen	login.success	\N	\N	{}	::1	2026-11-23 01:06:50.379377+08
646	2	kitchen	batch.created	batch	311	{"qty": 3, "code": "B-0311", "item": "Chicken Adobo", "expiry": null}	::1	2026-11-23 01:06:58.294063+08
647	2	\N	logout	\N	\N	{}	::1	2026-11-23 01:07:00.019711+08
648	1	cashier	login.success	\N	\N	{}	::1	2026-11-23 01:07:06.060284+08
649	1	cashier	order.placed	order	53	{"type": "dine_in", "items": 18, "total": 108, "method": "paynow", "number": "0053"}	::1	2026-11-23 01:07:24.013895+08
650	1	\N	logout	\N	\N	{}	::1	2026-11-23 01:32:11.231863+08
651	2	kitchen	login.success	\N	\N	{}	::1	2026-11-23 01:32:15.11985+08
652	2	kitchen	batch.created	batch	312	{"qty": 10, "code": "B-0312", "item": "Pork Belly", "expiry": "2026-12-02"}	::1	2026-11-23 01:33:34.40955+08
653	2	kitchen	batch.adjusted	batch	312	{"to": 9, "code": "B-0312", "diff": -1, "from": 10, "item": "Pork Belly", "reason": "Measuring error"}	::1	2026-11-23 01:34:34.658097+08
654	2	kitchen	batch.created	batch	313	{"qty": 20, "code": "B-0313", "item": "Chicken Adobo", "expiry": null}	::1	2026-11-23 01:38:28.876756+08
655	2	kitchen	menu.adjusted	item	145	{"to": 20, "diff": -2, "from": 22, "item": "Chicken Adobo", "reason": "Recount"}	::1	2026-11-23 01:39:21.284717+08
656	2	kitchen	menu.loss	item	145	{"qty": 2, "item": "Chicken Adobo", "type": "DAMAGED", "reason": "Dropped"}	::1	2026-11-23 01:40:30.892962+08
657	2	kitchen	item.created	item	151	{"name": "Jasmine Rice", "type": "ingredient", "batch": "B-0314"}	::1	2026-11-23 01:44:42.030883+08
658	2	kitchen	batch.created	batch	315	{"qty": 5, "code": "B-0315", "item": "Bangus", "expiry": "2026-12-02"}	::1	2026-11-23 01:47:20.119439+08
659	2	kitchen	batch.created	batch	316	{"qty": 5, "code": "B-0316", "item": "Bangus", "expiry": "2026-12-04"}	::1	2026-11-23 01:47:30.562372+08
660	2	kitchen	batch.created	batch	317	{"qty": 5, "code": "B-0317", "item": "Bangus", "expiry": "2026-12-05"}	::1	2026-11-23 01:48:40.244653+08
661	2	kitchen	batch.loss	batch	233	{"qty": 5, "code": "B-0233", "item": "Bangus", "type": "SPOILED", "reason": "Spoiled (smell)"}	::1	2026-11-23 01:48:58.324169+08
728	3	owner	order.completed	order	39	{"number": "0039"}	::1	2026-11-23 03:08:23.456734+08
662	2	kitchen	batch.adjusted	batch	315	{"to": 0, "code": "B-0315", "diff": -5, "from": 5, "item": "Bangus", "reason": "Used"}	::1	2026-11-23 01:58:05.273302+08
663	2	kitchen	batch.adjusted	batch	316	{"to": 3, "code": "B-0316", "diff": -2, "from": 5, "item": "Bangus", "reason": "Used"}	::1	2026-11-23 01:58:25.490572+08
664	2	kitchen	batch.created	batch	318	{"qty": 5, "code": "B-0318", "item": "Beef", "expiry": "2026-11-24"}	::1	2026-11-23 02:00:59.249339+08
665	2	kitchen	batch.created	batch	319	{"qty": 5, "code": "B-0319", "item": "Beef", "expiry": "2026-11-26"}	::1	2026-11-23 02:01:34.013277+08
666	2	kitchen	stock.batch_expiry_updated	batch	319	{"to": "2026-11-28", "itemName": "Beef", "batchCode": "B-0319"}	::1	2026-11-23 02:01:41.560967+08
667	2	kitchen	stock.batch_expiry_updated	batch	318	{"to": "2026-11-23", "itemName": "Beef", "batchCode": "B-0318"}	::1	2026-11-23 02:14:52.511666+08
668	2	kitchen	batch.write_off	batch	43	{"qty": 6, "code": "B-0043", "item": "Tomato"}	::1	2026-11-23 02:16:08.385092+08
669	2	\N	logout	\N	\N	{}	::1	2026-11-23 02:17:18.31993+08
670	1	cashier	login.success	\N	\N	{}	::1	2026-11-23 02:17:23.336586+08
671	2	kitchen	login.success	\N	\N	{}	::1	2026-11-23 02:19:29.045066+08
672	3	owner	login.failed	\N	\N	{"reason": "bad_password"}	::1	2026-11-23 02:20:07.297738+08
673	3	owner	login.success	\N	\N	{}	::1	2026-11-23 02:20:14.497909+08
674	2	kitchen	batch.created	batch	320	{"qty": 4, "code": "B-0320", "item": "Star Anise", "expiry": null}	::1	2026-11-23 02:21:49.204517+08
675	1	cashier	order.placed	order	54	{"type": "dine_in", "items": 1, "total": 6, "method": "cash", "number": "0054"}	::1	2026-11-23 02:25:10.440913+08
676	2	\N	logout	\N	\N	{}	::1	2026-11-23 02:34:57.36628+08
677	1	\N	logout	\N	\N	{}	::1	2026-11-23 02:35:20.588731+08
678	1	cashier	login.failed	\N	\N	{"reason": "bad_password"}	::1	2026-11-23 02:35:24.686957+08
679	3	owner	login.success	\N	\N	{}	::1	2026-11-23 02:36:13.391393+08
680	3	owner	admin.user_updated	user	2	{"role": "kitchen", "isActive": false, "username": "kitchen"}	::1	2026-11-23 02:36:24.710312+08
681	3	\N	logout	\N	\N	{}	::1	2026-11-23 02:36:29.017528+08
682	2	kitchen	login.failed	\N	\N	{"reason": "inactive"}	::1	2026-11-23 02:36:34.875673+08
683	2	kitchen	login.failed	\N	\N	{"reason": "inactive"}	::1	2026-11-23 02:36:37.489008+08
684	2	kitchen	login.failed	\N	\N	{"reason": "inactive"}	::1	2026-11-23 02:36:39.303678+08
685	2	kitchen	login.failed	\N	\N	{"reason": "inactive"}	::1	2026-11-23 02:36:46.481361+08
686	1	cashier	login.success	\N	\N	{}	::1	2026-11-23 02:38:53.116722+08
687	1	\N	logout	\N	\N	{}	::1	2026-11-23 02:42:41.431121+08
688	1	cashier	login.success	\N	\N	{}	::1	2026-11-23 02:43:11.95772+08
689	1	\N	logout	\N	\N	{}	::1	2026-11-23 02:45:18.264098+08
690	1	cashier	login.success	\N	\N	{}	::1	2026-11-23 02:45:20.306459+08
691	1	\N	logout	\N	\N	{}	::1	2026-11-23 02:45:52.014649+08
692	1	cashier	login.success	\N	\N	{}	::1	2026-11-23 02:45:54.625918+08
693	1	\N	logout	\N	\N	{}	::1	2026-11-23 02:48:44.667769+08
694	3	owner	login.success	\N	\N	{}	::1	2026-11-23 02:48:49.252443+08
695	3	\N	logout	\N	\N	{}	::1	2026-11-23 02:50:01.167735+08
696	2	kitchen	login.failed	\N	\N	{"reason": "inactive"}	::1	2026-11-23 02:50:05.071127+08
697	3	owner	login.success	\N	\N	{}	::1	2026-11-23 02:50:10.398076+08
698	3	owner	admin.user_updated	user	2	{"role": "kitchen", "isActive": true, "username": "kitchen"}	::1	2026-11-23 02:50:13.730081+08
699	3	\N	logout	\N	\N	{}	::1	2026-11-23 02:50:14.988361+08
700	2	kitchen	login.success	\N	\N	{}	::1	2026-11-23 02:50:18.835176+08
701	2	kitchen	menu.adjusted	item	145	{"to": 4, "diff": -13, "from": 17, "item": "Chicken Adobo", "reason": "Recount"}	::1	2026-11-23 02:50:57.930271+08
702	2	\N	logout	\N	\N	{}	::1	2026-11-23 02:58:25.868018+08
703	1	cashier	login.success	\N	\N	{}	::1	2026-11-23 02:58:29.622129+08
704	1	\N	logout	\N	\N	{}	::1	2026-11-23 02:59:01.339685+08
705	2	kitchen	login.success	\N	\N	{}	::1	2026-11-23 02:59:07.681967+08
706	2	\N	logout	\N	\N	{}	::1	2026-11-23 02:59:35.814973+08
707	1	cashier	login.success	\N	\N	{}	::1	2026-11-23 02:59:39.144065+08
708	1	\N	logout	\N	\N	{}	::1	2026-11-23 03:00:50.085224+08
709	2	kitchen	login.success	\N	\N	{}	::1	2026-11-23 03:00:53.725033+08
710	2	kitchen	batch.created	batch	321	{"qty": 10, "code": "B-0321", "item": "Chicken Adobo", "expiry": null}	::1	2026-11-23 03:01:06.458594+08
711	2	kitchen	batch.created	batch	322	{"qty": 11, "code": "B-0322", "item": "Chicken Adobo", "expiry": null}	::1	2026-11-23 03:01:29.835914+08
712	2	kitchen	menu.adjusted	item	145	{"to": 15, "diff": -10, "from": 25, "item": "Chicken Adobo", "reason": "Recount"}	::1	2026-11-23 03:01:38.979103+08
713	2	\N	logout	\N	\N	{}	::1	2026-11-23 03:01:41.252318+08
714	1	cashier	login.success	\N	\N	{}	::1	2026-11-23 03:01:45.181597+08
715	1	\N	logout	\N	\N	{}	::1	2026-11-23 03:03:20.084167+08
716	3	owner	login.success	\N	\N	{}	::1	2026-11-23 03:03:24.303466+08
717	3	owner	order.completed	order	54	{"number": "0054"}	::1	2026-11-23 03:08:11.698359+08
718	3	owner	order.completed	order	53	{"number": "0053"}	::1	2026-11-23 03:08:12.942511+08
719	3	owner	order.completed	order	52	{"number": "0052"}	::1	2026-11-23 03:08:13.759869+08
720	3	owner	order.completed	order	51	{"number": "0051"}	::1	2026-11-23 03:08:14.559202+08
721	3	owner	order.completed	order	50	{"number": "0050"}	::1	2026-11-23 03:08:15.291962+08
722	3	owner	order.completed	order	49	{"number": "0049"}	::1	2026-11-23 03:08:16.737899+08
723	3	owner	order.completed	order	48	{"number": "0048"}	::1	2026-11-23 03:08:17.444128+08
724	3	owner	order.completed	order	42	{"number": "0042"}	::1	2026-11-23 03:08:19.103228+08
725	3	owner	order.completed	order	41	{"number": "0041"}	::1	2026-11-23 03:08:20.406366+08
729	3	owner	order.completed	order	37	{"number": "0037"}	::1	2026-11-23 03:08:24.20479+08
730	3	owner	order.completed	order	36	{"number": "0036"}	::1	2026-11-23 03:08:24.97677+08
731	3	owner	order.completed	order	35	{"number": "0035"}	::1	2026-11-23 03:08:25.84283+08
732	3	owner	order.completed	order	34	{"number": "0034"}	::1	2026-11-23 03:08:27.535656+08
733	3	owner	order.completed	order	33	{"number": "0033"}	::1	2026-11-23 03:08:28.260683+08
734	3	owner	order.completed	order	32	{"number": "0032"}	::1	2026-11-23 03:08:28.966159+08
735	3	owner	order.completed	order	30	{"number": "0030"}	::1	2026-11-23 03:08:30.738863+08
736	3	owner	order.completed	order	31	{"number": "0031"}	::1	2026-11-23 03:08:31.439808+08
737	3	owner	order.completed	order	29	{"number": "0029"}	::1	2026-11-23 03:08:32.393193+08
738	3	owner	order.completed	order	28	{"number": "0028"}	::1	2026-11-23 03:08:33.129395+08
739	3	owner	order.completed	order	27	{"number": "0027"}	::1	2026-11-23 03:08:34.326382+08
740	3	owner	order.completed	order	25	{"number": "0025"}	::1	2026-11-23 03:08:35.934583+08
741	3	owner	order.completed	order	26	{"number": "0026"}	::1	2026-11-23 03:08:36.742422+08
742	3	owner	order.completed	order	24	{"number": "0024"}	::1	2026-11-23 03:08:37.629796+08
743	3	owner	order.completed	order	23	{"number": "0023"}	::1	2026-11-23 03:08:39.214385+08
744	3	owner	order.completed	order	22	{"number": "0022"}	::1	2026-11-23 03:08:40.527223+08
745	3	owner	order.completed	order	21	{"number": "0021"}	::1	2026-11-23 03:08:41.270208+08
746	3	owner	order.completed	order	20	{"number": "0020"}	::1	2026-11-23 03:08:42.175504+08
747	3	owner	order.completed	order	19	{"number": "0019"}	::1	2026-11-23 03:08:43.078101+08
748	3	owner	order.completed	order	18	{"number": "0018"}	::1	2026-11-23 03:08:44.845404+08
749	3	owner	order.completed	order	17	{"number": "0017"}	::1	2026-11-23 03:08:46.078892+08
750	3	owner	order.completed	order	16	{"number": "0016"}	::1	2026-11-23 03:08:46.807824+08
751	3	owner	order.completed	order	15	{"number": "0015"}	::1	2026-11-23 03:08:47.492446+08
752	3	owner	order.completed	order	14	{"number": "0014"}	::1	2026-11-23 03:08:48.202485+08
753	3	owner	item.updated	item	145	{"price": {"to": 7, "from": 6}}	::1	2026-11-23 03:14:13.354761+08
754	3	\N	logout	\N	\N	{}	::1	2026-11-23 03:16:45.803359+08
755	1	cashier	login.success	\N	\N	{}	::1	2026-11-23 03:16:49.61549+08
756	1	cashier	login.success	\N	\N	{}	::1	2026-11-23 03:17:00.983063+08
757	1	cashier	order.placed	order	55	{"type": "dine_in", "items": 1, "total": 7, "method": "cash", "number": "0055"}	::1	2026-11-23 03:17:25.195602+08
758	1	cashier	order.placed	order	56	{"type": "dine_in", "items": 1, "total": 7, "method": "cash", "number": "0056"}	::1	2026-11-23 03:17:43.626983+08
759	1	cashier	order.completed	order	56	{"number": "0056"}	::1	2026-11-23 03:17:51.012304+08
760	1	cashier	order.completed	order	55	{"number": "0055"}	::1	2026-11-23 03:17:52.475873+08
761	1	cashier	order.placed	order	57	{"type": "dine_in", "items": 3, "total": 180, "method": "paynow", "number": "0057"}	::1	2026-11-23 03:21:16.664581+08
762	1	cashier	order.placed	order	58	{"type": "dine_in", "items": 4, "total": 28, "method": "cash", "number": "0058"}	::1	2026-11-23 03:21:38.047618+08
763	1	\N	logout	\N	\N	{}	::1	2026-11-23 03:27:12.431021+08
764	2	kitchen	login.success	\N	\N	{}	::1	2026-11-23 03:27:18.422188+08
765	2	\N	logout	\N	\N	{}	::1	2026-11-23 03:28:41.286791+08
766	1	cashier	login.success	\N	\N	{}	::1	2026-11-23 03:28:45.096276+08
767	1	\N	logout	\N	\N	{}	::1	2026-11-23 03:30:47.601178+08
768	1	cashier	login.success	\N	\N	{}	::1	2026-11-23 03:31:45.777321+08
769	1	cashier	access.denied	\N	\N	{"path": "/api/items/1/batches", "needs": ["kitchen", "owner"], "method": "POST"}	::1	2026-11-23 03:32:24.134251+08
770	1	cashier	access.denied	\N	\N	{"path": "/api/items/1/batches", "needs": ["kitchen", "owner"], "method": "POST"}	::1	2026-11-23 03:32:25.889398+08
771	1	cashier	access.denied	\N	\N	{"path": "/api/items/1/batches", "needs": ["kitchen", "owner"], "method": "POST"}	::1	2026-11-23 03:32:27.177251+08
772	1	cashier	access.denied	\N	\N	{"path": "/api/items/1/batches", "needs": ["kitchen", "owner"], "method": "POST"}	::1	2026-11-23 03:32:29.669878+08
773	1	cashier	access.denied	\N	\N	{"path": "/api/items/1/batches", "needs": ["kitchen", "owner"], "method": "POST"}	::1	2026-11-23 03:32:30.084855+08
774	1	cashier	access.denied	\N	\N	{"path": "/api/items/1/batches", "needs": ["kitchen", "owner"], "method": "POST"}	::1	2026-11-23 03:32:30.372926+08
775	1	\N	logout	\N	\N	{}	::1	2026-11-23 03:32:32.602217+08
776	1	cashier	login.success	\N	\N	{}	::1	2026-11-23 03:34:30.784762+08
777	1	\N	logout	\N	\N	{}	::1	2026-11-23 03:36:35.711202+08
778	2	kitchen	login.success	\N	\N	{}	::1	2026-11-23 03:36:40.810537+08
779	2	kitchen	batch.created	batch	323	{"qty": 100, "code": "B-0323", "item": "Beef Broccoli", "expiry": null}	::1	2026-11-23 03:39:12.99646+08
780	2	kitchen	batch.created	batch	324	{"qty": 100000, "code": "B-0324", "item": "Beef Broccoli", "expiry": null}	::1	2026-11-23 03:39:30.848905+08
781	2	kitchen	menu.adjusted	item	127	{"to": 10, "diff": -100090, "from": 100100, "item": "Beef Broccoli", "reason": "Recount"}	::1	2026-11-23 03:39:55.766198+08
782	2	kitchen	batch.created	batch	325	{"qty": 6, "code": "B-0325", "item": "Beef Mushroom", "expiry": null}	::1	2026-11-23 03:40:35.181958+08
783	2	kitchen	batch.created	batch	326	{"qty": 6, "code": "B-0326", "item": "Bicol Express", "expiry": null}	::1	2026-11-23 03:40:39.432066+08
784	2	kitchen	batch.created	batch	327	{"qty": 6, "code": "B-0327", "item": "Binagoongan", "expiry": null}	::1	2026-11-23 03:40:43.559266+08
785	2	\N	logout	\N	\N	{}	::1	2026-11-23 03:40:44.86335+08
786	1	cashier	login.success	\N	\N	{}	::1	2026-11-23 03:40:49.221649+08
787	1	\N	logout	\N	\N	{}	::1	2026-11-23 03:43:36.370762+08
789	3	\N	logout	\N	\N	{}	::1	2026-11-23 03:43:45.021158+08
790	2	kitchen	login.success	\N	\N	{}	::1	2026-11-23 03:43:49.945338+08
791	2	\N	logout	\N	\N	{}	::1	2026-11-23 03:44:40.336549+08
792	3	owner	login.success	\N	\N	{}	::1	2026-11-23 03:44:44.139698+08
793	3	\N	logout	\N	\N	{}	::1	2026-11-23 03:45:56.809182+08
794	2	kitchen	login.success	\N	\N	{}	::1	2026-11-23 03:46:00.817142+08
795	2	kitchen	item.created	item	152	{"name": "Pancit Bihón", "type": "food", "batch": "B-0328"}	::1	2026-11-23 03:46:21.632882+08
796	2	\N	logout	\N	\N	{}	::1	2026-11-23 03:46:36.859047+08
797	3	owner	login.success	\N	\N	{}	::1	2026-11-23 03:46:41.339252+08
798	3	\N	logout	\N	\N	{}	::1	2026-11-23 03:50:48.005921+08
799	2	kitchen	login.success	\N	\N	{}	::1	2026-11-23 03:51:01.199939+08
800	2	\N	logout	\N	\N	{}	::1	2026-11-23 03:51:13.679669+08
801	1	cashier	login.success	\N	\N	{}	::1	2026-11-23 03:51:16.912904+08
802	1	cashier	order.placed	order	60	{"type": "dine_in", "items": 3, "total": 33.5, "method": "cash", "number": "0059"}	::1	2026-11-23 03:56:04.297499+08
803	1	\N	logout	\N	\N	{}	::1	2026-11-23 03:58:47.948274+08
804	3	owner	login.success	\N	\N	{}	::1	2026-11-23 03:58:51.77134+08
805	3	\N	logout	\N	\N	{}	::1	2026-11-23 04:22:11.727077+08
806	1	cashier	login.success	\N	\N	{}	::1	2026-11-23 04:22:14.944046+08
807	1	cashier	session.closed	session	9	{"orders": 13, "counted": 2297.5, "expected": 2297.5, "netSales": 840.5, "difference": 0}	::1	2026-11-23 04:22:32.787948+08
808	1	\N	logout	\N	\N	{}	::1	2026-11-23 04:22:35.242492+08
809	3	\N	logout	\N	\N	{}	::1	2026-11-23 04:22:44.858593+08
810	1	\N	logout	\N	\N	{}	::1	2026-11-23 04:22:52.957972+08
811	3	owner	login.success	\N	\N	{}	::1	2026-11-23 16:26:40.656557+08
812	3	\N	logout	\N	\N	{}	::1	2026-11-23 16:27:15.830852+08
813	1	cashier	login.success	\N	\N	{}	::1	2026-11-23 16:27:19.390593+08
814	1	cashier	session.opened	session	10	{"openingCash": 3000}	::1	2026-11-23 16:27:27.602068+08
815	1	cashier	order.placed	order	61	{"type": "dine_in", "items": 2, "total": 21, "method": "card", "number": "0060"}	::1	2026-11-23 16:27:37.366586+08
816	1	cashier	order.completed	order	61	{"number": "0060"}	::1	2026-11-23 16:27:47.578362+08
817	1	cashier	order.completed	order	58	{"number": "0058"}	::1	2026-11-23 16:27:50.310882+08
818	1	cashier	order.completed	order	57	{"number": "0057"}	::1	2026-11-23 16:27:51.635142+08
819	1	cashier	order.completed	order	60	{"number": "0059"}	::1	2026-11-23 16:27:52.573236+08
820	1	\N	logout	\N	\N	{}	::1	2026-11-23 16:27:53.651364+08
821	3	owner	login.success	\N	\N	{}	::1	2026-11-23 16:27:57.032254+08
822	3	\N	logout	\N	\N	{}	::1	2026-11-23 16:28:40.190585+08
823	2	kitchen	login.success	\N	\N	{}	::1	2026-11-25 07:05:40.371087+08
824	2	kitchen	menu.write_off_expired	item	\N	{"items": 6, "batches": 6, "servings": 38}	::1	2026-11-25 07:05:51.374093+08
825	2	\N	logout	\N	\N	{}	::1	2026-11-25 07:42:36.684847+08
826	1	cashier	login.success	\N	\N	{}	::1	2026-11-25 07:42:40.699998+08
827	1	cashier	session.closed	session	10	{"orders": 1, "counted": 3000, "expected": 3000, "netSales": 21, "difference": 0}	::1	2026-11-25 07:42:49.724289+08
828	1	\N	logout	\N	\N	{}	::1	2026-11-25 07:42:57.218136+08
829	\N	script	recipes.import	recipe	\N	{"lines": 364, "dishes": 37}	\N	2026-11-25 12:34:39.650905+08
830	2	kitchen	login.success	\N	\N	{}	::1	2026-11-25 12:51:33.291288+08
831	2	kitchen	batch.created	batch	329	{"qty": 20, "code": "B-0329", "item": "Kare-Kare (Pork Pata)", "trays": 2, "expiry": null, "ingredientsUsed": [{"qty": 3, "name": "Pork Pata", "unit": "kg"}, {"qty": 0.5, "name": "Peanut Butter", "unit": "kg"}, {"qty": 0.3, "name": "Bagoong Alamang", "unit": "kg"}, {"qty": 0.6, "name": "Eggplant", "unit": "kg"}, {"qty": 4, "name": "Sitaw (String Beans)", "unit": "bunch"}, {"qty": 2, "name": "Pechay", "unit": "bunch"}, {"qty": 2, "name": "Banana Blossom", "unit": "pcs"}, {"qty": 0.2, "name": "Onion", "unit": "kg"}, {"qty": 0.08, "name": "Garlic", "unit": "kg"}, {"qty": 0.02, "name": "Salt", "unit": "kg"}, {"qty": 0.03, "name": "Annatto (Atsuete)", "unit": "kg"}]}	::1	2026-11-25 12:52:19.794722+08
832	2	kitchen	batch.created	batch	330	{"qty": 10, "code": "B-0330", "item": "Beef Broccoli", "trays": 1, "expiry": null, "ingredientsUsed": [{"qty": 1.2, "name": "Beef Slices", "unit": "kg"}, {"qty": 0.045, "name": "Soy Sauce", "unit": "L"}, {"qty": 0.075, "name": "Oyster Sauce", "unit": "L"}, {"qty": 0.1, "name": "Onion", "unit": "kg"}, {"qty": 0.04, "name": "Garlic", "unit": "kg"}, {"qty": 0.5, "name": "Broccoli", "unit": "kg"}, {"qty": 0.005, "name": "Black Pepper", "unit": "kg"}, {"qty": 0.015, "name": "Cornstarch", "unit": "kg"}]}	::1	2026-11-25 12:53:50.345284+08
833	2	\N	logout	\N	\N	{}	::1	2026-11-25 12:55:07.33524+08
834	1	cashier	login.success	\N	\N	{}	::1	2026-11-25 12:55:11.278998+08
835	1	cashier	session.opened	session	11	{"openingCash": 2500}	::1	2026-11-25 12:56:25.728601+08
836	1	\N	logout	\N	\N	{}	::1	2026-11-25 12:56:48.046295+08
837	2	kitchen	login.success	\N	\N	{}	::1	2026-11-25 12:56:51.751422+08
838	2	kitchen	batch.created	batch	331	{"qty": 7, "code": "B-0331", "item": "Sitaw (String Beans)", "expiry": "2026-12-02"}	::1	2026-11-25 13:01:13.264645+08
839	2	\N	logout	\N	\N	{}	::1	2026-11-25 13:03:54.654304+08
840	3	owner	login.success	\N	\N	{}	::1	2026-11-25 13:03:58.87526+08
841	3	owner	batch.created	batch	332	{"qty": 10, "code": "B-0332", "item": "Beef Mushroom", "trays": 1, "expiry": null, "ingredientsUsed": [{"qty": 1.2, "name": "Beef", "unit": "kg"}, {"qty": 0.06, "name": "Soy Sauce", "unit": "L"}, {"qty": 0.06, "name": "Oyster Sauce", "unit": "L"}, {"qty": 0.25, "name": "Beef Broth", "unit": "L"}, {"qty": 0.15, "name": "Onion", "unit": "kg"}, {"qty": 0.04, "name": "Garlic", "unit": "kg"}, {"qty": 0.3, "name": "Mushrooms", "unit": "kg"}, {"qty": 0.005, "name": "Black Pepper", "unit": "kg"}, {"qty": 0.015, "name": "Cornstarch", "unit": "kg"}]}	::1	2026-11-25 13:04:44.178439+08
842	3	owner	batch.loss	batch	208	{"qty": 0.5, "code": "B-0208", "item": "Ampalaya", "type": "DAMAGED", "reason": "Rotten"}	::1	2026-11-25 13:05:32.998943+08
843	3	\N	logout	\N	\N	{}	::1	2026-11-25 13:08:13.856228+08
844	1	cashier	login.success	\N	\N	{}	::1	2026-11-25 13:08:18.995299+08
845	1	cashier	session.closed	session	11	{"orders": 0, "counted": 2500, "expected": 2500, "netSales": 0, "difference": 0}	::1	2026-11-25 13:08:25.381054+08
846	1	\N	logout	\N	\N	{}	::1	2026-11-25 13:08:29.155515+08
847	3	owner	login.success	\N	\N	{}	::1	2026-11-25 13:08:33.32885+08
848	3	\N	logout	\N	\N	{}	::1	2026-11-25 13:08:45.266459+08
849	1	cashier	login.success	\N	\N	{}	::1	2026-11-25 13:08:52.563638+08
850	1	cashier	session.opened	session	12	{"openingCash": 3000}	::1	2026-11-25 13:09:01.137047+08
851	1	\N	logout	\N	\N	{}	::1	2026-11-25 13:09:03.405859+08
852	3	owner	login.success	\N	\N	{}	::1	2026-11-25 13:09:08.546781+08
853	3	\N	logout	\N	\N	{}	::1	2026-11-25 13:10:22.451315+08
854	1	cashier	login.success	\N	\N	{}	::1	2026-11-25 13:10:27.29565+08
855	1	\N	logout	\N	\N	{}	::1	2026-11-25 13:10:30.240015+08
856	3	owner	login.success	\N	\N	{}	::1	2026-11-25 13:10:34.918053+08
857	3	\N	logout	\N	\N	{}	::1	2026-11-25 13:10:48.585994+08
858	2	kitchen	login.success	\N	\N	{}	::1	2026-11-25 15:38:47.080463+08
859	2	kitchen	batch.created	batch	333	{"qty": 10, "code": "B-0333", "item": "Kare-Kare (Pork Pata)", "trays": 1, "expiry": null, "ingredientsUsed": [{"qty": 1.5, "name": "Pork Pata", "unit": "kg"}, {"qty": 0.25, "name": "Peanut Butter", "unit": "kg"}, {"qty": 0.15, "name": "Bagoong Alamang", "unit": "kg"}, {"qty": 0.3, "name": "Eggplant", "unit": "kg"}, {"qty": 2, "name": "Sitaw (String Beans)", "unit": "bunch"}, {"qty": 1, "name": "Pechay", "unit": "bunch"}, {"qty": 1, "name": "Banana Blossom", "unit": "pcs"}, {"qty": 0.1, "name": "Onion", "unit": "kg"}, {"qty": 0.04, "name": "Garlic", "unit": "kg"}, {"qty": 0.01, "name": "Salt", "unit": "kg"}, {"qty": 0.015, "name": "Annatto (Atsuete)", "unit": "kg"}]}	::1	2026-11-25 15:39:04.847016+08
860	2	\N	logout	\N	\N	{}	::1	2026-11-25 15:40:55.684864+08
861	3	owner	login.success	\N	\N	{}	::1	2026-11-25 15:40:59.706626+08
862	3	\N	logout	\N	\N	{}	::1	2026-11-25 16:59:00.994602+08
863	2	kitchen	login.success	\N	\N	{}	::1	2026-11-25 16:59:07.306578+08
864	2	\N	logout	\N	\N	{}	::1	2026-11-25 19:29:08.763799+08
865	1	cashier	login.success	\N	\N	{}	::1	2026-11-25 19:29:50.446421+08
866	1	cashier	order.placed	order	62	{"type": "dine_in", "items": 1, "total": 11.5, "method": "paynow", "number": "0061"}	::1	2026-11-25 19:30:42.444248+08
867	1	cashier	order.placed	order	63	{"type": "dine_in", "items": 2, "total": 23, "method": "paynow", "number": "0062"}	::1	2026-11-25 19:30:50.616993+08
868	1	\N	logout	\N	\N	{}	::1	2026-11-25 19:30:54.666973+08
869	2	kitchen	login.success	\N	\N	{}	::1	2026-11-25 19:31:00.996951+08
870	2	\N	logout	\N	\N	{}	::1	2026-11-25 19:32:48.31137+08
871	1	cashier	login.success	\N	\N	{}	::1	2026-11-25 19:32:53.753687+08
872	1	\N	logout	\N	\N	{}	::1	2026-11-25 19:33:05.545415+08
873	1	cashier	login.success	\N	\N	{}	::1	2026-11-25 19:33:28.238551+08
\.


--
-- Data for Name: cashier_sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.cashier_sessions (id, cashier_id, opened_at, opening_cash, closed_at, expected_cash, counted_cash, cash_difference, close_note) FROM stdin;
1	1	2026-11-17 15:24:54.542601+08	2000.00	2026-11-17 17:18:46.959887+08	2075.50	2075.50	0.00	\N
2	1	2026-11-18 16:00:27.544938+08	1000.00	2026-11-20 17:29:35.931905+08	1000.00	1000.00	0.00	\N
3	1	2026-11-20 17:49:10.753911+08	2000.00	2026-11-20 18:01:37.395006+08	2000.00	2000.00	0.00	\N
4	1	2026-11-20 18:25:24.985347+08	4000.00	2026-11-20 20:41:57.972741+08	4000.00	4000.00	0.00	\N
6	1	2026-11-20 22:20:56.163975+08	2000.00	2026-11-21 15:18:52.95087+08	2000.00	2000.00	0.00	\N
7	1	2026-11-21 18:21:14.513784+08	2000.00	2026-11-22 16:26:29.913847+08	2029.00	2029.00	0.00	\N
5	3	2026-11-20 20:41:18.143373+08	200.00	2026-11-22 18:56:37.850783+08	200.00	200.00	0.00	\N
8	1	2026-11-22 17:40:05.482795+08	2000.00	2026-11-23 00:07:08.932784+08	3662.00	3662.00	0.00	\N
9	1	2026-11-23 00:09:39.421571+08	2000.00	2026-11-23 04:22:32.749245+08	2297.50	2297.50	0.00	\N
10	1	2026-11-23 16:27:27.577293+08	3000.00	2026-11-25 07:42:49.701753+08	3000.00	3000.00	0.00	\N
11	1	2026-11-25 12:56:25.687124+08	2500.00	2026-11-25 13:08:25.366049+08	2500.00	2500.00	0.00	\N
12	1	2026-11-25 13:09:01.094415+08	3000.00	\N	\N	\N	\N	\N
\.


--
-- Data for Name: categories; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.categories (id, name, kind) FROM stdin;
1	Wet ingredients	ingredient
2	Dry ingredients	ingredient
3	Meat	ingredient
4	Main dishes	food
5	Snacks and appetizers	food
6	Soup and noodle dishes	food
7	Desserts	food
8	Food trays	food_tray
\.


--
-- Data for Name: counters; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.counters (name, last_value) FROM stdin;
order_number	62
\.


--
-- Data for Name: inventory_batches; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.inventory_batches (id, batch_code, item_id, qty_received, qty_remaining, received_date, expiry_date, created_by, created_at) FROM stdin;
1	B-0001	20	240.000	240.000	2026-11-13	2026-12-04	3	2026-11-13 12:02:53.49185+08
2	B-0002	21	300.000	300.000	2026-11-13	2026-11-27	3	2026-11-13 12:02:53.49185+08
4	B-0004	23	1.800	1.800	2026-11-13	2027-01-12	3	2026-11-13 12:02:53.49185+08
5	B-0005	24	1.800	1.800	2026-11-13	2026-12-28	3	2026-11-13 12:02:53.49185+08
6	B-0006	25	28.000	28.000	2026-11-13	2027-11-13	3	2026-11-13 12:02:53.49185+08
7	B-0007	26	14.000	14.000	2026-11-13	2027-11-13	3	2026-11-13 12:02:53.49185+08
8	B-0008	27	14.000	14.000	2026-11-13	2027-11-13	3	2026-11-13 12:02:53.49185+08
10	B-0010	29	84.000	84.000	2026-11-13	2027-11-13	3	2026-11-13 12:02:53.49185+08
11	B-0011	30	1.400	1.400	2026-11-13	2027-11-13	3	2026-11-13 12:02:53.49185+08
13	B-0013	32	11.200	11.200	2026-11-13	2028-11-12	3	2026-11-13 12:02:53.49185+08
15	B-0015	34	14.000	14.000	2026-11-13	\N	3	2026-11-13 12:02:53.49185+08
16	B-0016	35	21.000	21.000	2026-11-13	2027-11-13	3	2026-11-13 12:02:53.49185+08
17	B-0017	36	4.200	4.200	2026-11-13	2027-11-13	3	2026-11-13 12:02:53.49185+08
20	B-0020	39	1.400	1.400	2026-11-13	2027-05-12	3	2026-11-13 12:02:53.49185+08
21	B-0021	40	7.000	7.000	2026-11-13	2027-03-13	3	2026-11-13 12:02:53.49185+08
22	B-0022	41	4.200	4.200	2026-11-13	2027-11-13	3	2026-11-13 12:02:53.49185+08
23	B-0023	42	4.200	4.200	2026-11-13	2027-11-13	3	2026-11-13 12:02:53.49185+08
24	B-0024	43	5.600	5.600	2026-11-13	2027-05-12	3	2026-11-13 12:02:53.49185+08
25	B-0025	44	21.000	21.000	2026-11-13	2027-11-13	3	2026-11-13 12:02:53.49185+08
27	B-0027	46	2.000	2.000	2026-11-13	2028-11-12	3	2026-11-13 12:02:53.49185+08
28	B-0028	47	2.000	2.000	2026-11-13	2027-11-13	3	2026-11-13 12:02:53.49185+08
29	B-0029	48	2.000	2.000	2026-11-13	2027-11-13	3	2026-11-13 12:02:53.49185+08
30	B-0030	49	2.400	2.400	2026-11-13	2027-01-12	3	2026-11-13 12:02:53.49185+08
31	B-0031	50	14.000	14.000	2026-11-13	2028-11-12	3	2026-11-13 12:02:53.49185+08
32	B-0032	51	2.000	2.000	2026-11-13	2027-11-13	3	2026-11-13 12:02:53.49185+08
33	B-0033	52	2.000	2.000	2026-11-13	2027-11-13	3	2026-11-13 12:02:53.49185+08
286	B-0286	146	5.000	0.000	2026-11-22	2026-11-22	3	2026-11-22 20:06:35.746679+08
43	B-0043	62	6.000	0.000	2026-11-13	2026-11-20	3	2026-11-13 12:02:53.49185+08
38	B-0038	57	18.000	18.000	2026-11-13	2026-12-13	3	2026-11-13 12:02:53.49185+08
39	B-0039	58	15.000	15.000	2026-11-13	2026-11-27	3	2026-11-13 12:02:53.49185+08
12	B-0012	31	21.000	20.895	2026-11-13	2027-11-13	3	2026-11-13 12:02:53.49185+08
14	B-0014	33	8.400	8.265	2026-11-13	2027-11-13	3	2026-11-13 12:02:53.49185+08
26	B-0026	45	42.000	41.750	2026-11-13	2027-11-13	3	2026-11-13 12:02:53.49185+08
44	B-0044	63	0.900	0.900	2026-11-13	2026-11-20	3	2026-11-13 12:02:53.49185+08
45	B-0045	64	0.600	0.600	2026-11-13	2026-11-20	3	2026-11-13 12:02:53.49185+08
46	B-0046	65	6.000	6.000	2026-11-13	2026-11-23	3	2026-11-13 12:02:53.49185+08
73	B-0073	92	2.100	2.090	2026-11-13	\N	3	2026-11-13 12:02:53.49185+08
208	B-0208	67	3.000	2.500	2026-11-22	2026-12-12	2	2026-11-22 17:55:50.016613+08
18	B-0018	37	7.000	6.250	2026-11-13	2027-05-12	3	2026-11-13 12:02:53.49185+08
50	B-0050	69	6.000	6.000	2026-11-13	2026-11-27	3	2026-11-13 12:02:53.49185+08
51	B-0051	70	12.000	12.000	2026-11-13	2026-11-23	3	2026-11-13 12:02:53.49185+08
52	B-0052	71	1.500	1.500	2026-11-13	2026-11-20	3	2026-11-13 12:02:53.49185+08
54	B-0054	73	3.000	3.000	2026-11-13	2026-11-23	3	2026-11-13 12:02:53.49185+08
330	B-0330	127	10.000	8.000	2026-11-25	2026-11-25	2	2026-11-25 12:53:50.293858+08
57	B-0057	76	3.000	3.000	2026-11-13	2026-11-23	3	2026-11-13 12:02:53.49185+08
59	B-0059	78	3.000	3.000	2026-11-13	2026-11-27	3	2026-11-13 12:02:53.49185+08
60	B-0060	79	1.800	1.800	2026-11-13	2026-12-04	3	2026-11-13 12:02:53.49185+08
36	B-0036	55	6.000	0.000	2026-11-13	2026-11-16	3	2026-11-13 12:02:53.49185+08
63	B-0063	82	3.000	3.000	2026-11-13	2026-11-27	3	2026-11-13 12:02:53.49185+08
65	B-0065	84	2.800	2.800	2026-11-13	2027-05-12	3	2026-11-13 12:02:53.49185+08
68	B-0068	87	2.800	2.800	2026-11-13	2027-02-11	3	2026-11-13 12:02:53.49185+08
69	B-0069	88	1.800	1.800	2026-11-13	2026-11-27	3	2026-11-13 12:02:53.49185+08
71	B-0071	90	14.000	14.000	2026-11-13	\N	3	2026-11-13 12:02:53.49185+08
72	B-0072	91	2.800	2.800	2026-11-13	\N	3	2026-11-13 12:02:53.49185+08
74	B-0074	93	0.700	0.700	2026-11-13	\N	3	2026-11-13 12:02:53.49185+08
76	B-0076	95	2.000	2.000	2026-11-13	\N	3	2026-11-13 12:02:53.49185+08
77	B-0077	96	2.000	2.000	2026-11-13	\N	3	2026-11-13 12:02:53.49185+08
78	B-0078	97	14.000	14.000	2026-11-13	2027-05-12	3	2026-11-13 12:02:53.49185+08
80	B-0080	99	8.400	8.400	2026-11-13	2027-11-13	3	2026-11-13 12:02:53.49185+08
81	B-0081	100	14.000	14.000	2026-11-13	2027-05-12	3	2026-11-13 12:02:53.49185+08
82	B-0082	101	11.200	11.200	2026-11-13	2027-11-13	3	2026-11-13 12:02:53.49185+08
83	B-0083	102	14.000	14.000	2026-11-13	2027-02-11	3	2026-11-13 12:02:53.49185+08
84	B-0084	103	14.000	14.000	2026-11-13	2027-05-12	3	2026-11-13 12:02:53.49185+08
85	B-0085	104	1.400	1.400	2026-11-13	2027-05-12	3	2026-11-13 12:02:53.49185+08
86	B-0086	105	14.000	14.000	2026-11-13	2027-11-13	3	2026-11-13 12:02:53.49185+08
87	B-0087	106	5.000	5.000	2026-11-13	2027-11-13	3	2026-11-13 12:02:53.49185+08
55	B-0055	74	3.000	0.000	2026-11-13	2026-11-16	3	2026-11-13 12:02:53.49185+08
56	B-0056	75	3.000	0.000	2026-11-13	2026-11-16	3	2026-11-13 12:02:53.49185+08
91	B-0091	4	3.000	0.000	2026-11-13	2026-11-18	3	2026-11-13 12:02:53.49185+08
58	B-0058	77	3.000	0.000	2026-11-13	2026-11-16	3	2026-11-13 12:02:53.49185+08
9	B-0009	28	17.000	10.000	2026-11-13	2027-03-14	3	2026-11-13 12:02:53.49185+08
61	B-0061	80	2.400	0.000	2026-11-13	2026-11-15	3	2026-11-13 12:02:53.49185+08
93	B-0093	6	4.500	0.000	2026-11-13	2026-11-15	3	2026-11-13 12:02:53.49185+08
94	B-0094	7	1.200	0.000	2026-11-13	2026-11-15	3	2026-11-13 12:02:53.49185+08
95	B-0095	8	1.200	0.000	2026-11-13	2026-11-15	3	2026-11-13 12:02:53.49185+08
96	B-0096	9	0.900	0.000	2026-11-13	2026-11-15	3	2026-11-13 12:02:53.49185+08
97	B-0097	10	1.800	0.000	2026-11-13	2026-11-15	3	2026-11-13 12:02:53.49185+08
98	B-0098	11	1.500	0.000	2026-11-13	2026-11-15	3	2026-11-13 12:02:53.49185+08
100	B-0100	13	3.000	0.000	2026-11-13	2026-11-16	3	2026-11-13 12:02:53.49185+08
47	B-0047	66	6.000	0.000	2026-11-13	2026-11-17	3	2026-11-13 12:02:53.49185+08
88	B-0088	1	7.500	0.000	2026-11-13	2026-11-17	3	2026-11-13 12:02:53.49185+08
89	B-0089	2	3.000	0.000	2026-11-13	2026-11-17	3	2026-11-13 12:02:53.49185+08
92	B-0092	5	6.000	0.000	2026-11-13	2026-11-17	3	2026-11-13 12:02:53.49185+08
99	B-0099	12	3.000	0.000	2026-11-13	2026-11-17	3	2026-11-13 12:02:53.49185+08
101	B-0101	14	2.400	0.000	2026-11-13	2026-11-17	3	2026-11-13 12:02:53.49185+08
102	B-0102	15	4.500	0.000	2026-11-13	2026-11-17	3	2026-11-13 12:02:53.49185+08
3	B-0003	22	3.000	0.000	2026-11-13	2026-11-18	3	2026-11-13 12:02:53.49185+08
34	B-0034	53	6.000	0.000	2026-11-13	2026-11-18	3	2026-11-13 12:02:53.49185+08
35	B-0035	54	9.000	0.000	2026-11-13	2026-11-18	3	2026-11-13 12:02:53.49185+08
37	B-0037	56	3.000	0.000	2026-11-13	2026-11-18	3	2026-11-13 12:02:53.49185+08
48	B-0048	67	1.500	0.000	2026-11-13	2026-11-18	3	2026-11-13 12:02:53.49185+08
49	B-0049	68	1.500	0.000	2026-11-13	2026-11-18	3	2026-11-13 12:02:53.49185+08
53	B-0053	72	3.600	0.000	2026-11-13	2026-11-18	3	2026-11-13 12:02:53.49185+08
62	B-0062	81	1.200	0.000	2026-11-13	2026-11-18	3	2026-11-13 12:02:53.49185+08
64	B-0064	83	2.400	0.000	2026-11-13	2026-11-18	3	2026-11-13 12:02:53.49185+08
66	B-0066	85	12.000	0.000	2026-11-13	2026-11-18	3	2026-11-13 12:02:53.49185+08
67	B-0067	86	4.500	0.000	2026-11-13	2026-11-18	3	2026-11-13 12:02:53.49185+08
209	B-0209	67	5.000	5.000	2026-11-22	2027-01-09	2	2026-11-22 17:56:16.134365+08
211	B-0211	39	4.000	4.000	2026-11-22	2026-11-29	2	2026-11-22 17:56:51.396918+08
213	B-0213	80	4.000	4.000	2026-11-22	2026-11-25	2	2026-11-22 17:58:00.631713+08
106	B-0106	19	2.000	2.000	2026-11-13	2026-12-13	3	2026-11-13 12:02:53.49185+08
214	B-0214	59	5.000	5.000	2026-11-22	2026-12-05	2	2026-11-22 17:58:42.676513+08
216	B-0216	71	6.000	6.000	2026-11-22	2026-11-28	2	2026-11-22 17:59:17.880283+08
237	B-0237	13	5.000	3.800	2026-11-22	2026-12-02	2	2026-11-22 18:05:55.087487+08
220	B-0220	85	8.000	8.000	2026-11-22	2026-11-28	2	2026-11-22 18:01:26.92381+08
160	B-0160	119	10.000	0.000	2026-11-16	2026-11-16	2	2026-11-16 15:37:55.530066+08
157	B-0157	141	5.000	0.000	2026-11-16	2026-11-16	2	2026-11-16 15:35:56.207759+08
159	B-0159	142	10.000	0.000	2026-11-16	2026-11-16	2	2026-11-16 15:36:10.575803+08
221	B-0221	85	3.000	3.000	2026-11-22	2026-12-02	2	2026-11-22 18:01:37.667421+08
223	B-0223	81	2.000	2.000	2026-11-22	2026-11-28	2	2026-11-22 18:02:08.886528+08
224	B-0224	77	4.000	4.000	2026-11-22	2026-11-28	2	2026-11-22 18:02:18.292568+08
225	B-0225	64	3.000	3.000	2026-11-22	2026-11-28	2	2026-11-22 18:02:28.0466+08
226	B-0226	74	4.000	4.000	2026-11-22	2026-11-28	2	2026-11-22 18:02:38.792302+08
227	B-0227	22	6.000	6.000	2026-11-22	2027-01-09	2	2026-11-22 18:03:12.811191+08
229	B-0229	68	4.000	4.000	2026-11-22	2026-12-12	2	2026-11-22 18:03:33.509532+08
230	B-0230	75	5.000	5.000	2026-11-22	2026-12-12	2	2026-11-22 18:03:54.036536+08
231	B-0231	66	4.000	4.000	2026-11-22	2026-12-05	2	2026-11-22 18:04:02.150489+08
228	B-0228	83	3.000	2.700	2026-11-22	2026-12-05	2	2026-11-22 18:03:21.865901+08
235	B-0235	14	5.000	5.000	2026-11-22	2026-12-02	2	2026-11-22 18:05:32.809751+08
239	B-0239	6	6.000	6.000	2026-11-22	2026-12-02	2	2026-11-22 18:06:26.811078+08
240	B-0240	5	5.000	5.000	2026-11-22	2026-12-03	2	2026-11-22 18:06:35.777466+08
241	B-0241	3	6.000	6.000	2026-11-22	2026-12-08	2	2026-11-22 18:06:46.249641+08
243	B-0243	3	3.000	3.000	2026-11-22	2026-12-02	2	2026-11-22 18:07:04.926272+08
245	B-0245	10	6.000	6.000	2026-11-22	2026-11-28	2	2026-11-22 18:07:28.631557+08
246	B-0246	9	6.000	6.000	2026-11-22	2026-12-02	2	2026-11-22 18:07:37.031371+08
248	B-0248	1	5.000	0.500	2026-11-22	2026-12-02	2	2026-11-22 18:08:20.41017+08
249	B-0249	2	6.000	6.000	2026-11-22	2026-12-02	2	2026-11-22 18:08:29.466714+08
331	B-0331	54	7.000	5.000	2026-11-25	2026-12-02	2	2026-11-25 13:01:13.222921+08
233	B-0233	17	5.000	0.000	2026-11-22	2026-12-02	2	2026-11-22 18:05:11.477729+08
179	B-0179	107	9.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:37:42.498679+08
178	B-0178	108	7.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:37:37.130884+08
169	B-0169	109	9.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:35:46.202072+08
187	B-0187	110	10.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:38:41.519539+08
189	B-0189	112	9.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:38:51.105456+08
183	B-0183	113	10.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:38:20.083103+08
174	B-0174	114	8.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:36:47.819848+08
182	B-0182	115	8.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:38:11.974059+08
180	B-0180	116	9.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:37:56.199416+08
167	B-0167	119	8.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:35:03.476186+08
185	B-0185	123	8.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:38:31.575025+08
166	B-0166	127	10.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:34:51.204285+08
196	B-0196	131	9.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:39:31.819775+08
194	B-0194	133	8.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:39:21.31444+08
190	B-0190	136	8.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:38:58.152537+08
198	B-0198	138	9.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:39:40.950114+08
161	B-0161	140	5.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:33:37.541339+08
172	B-0172	140	6.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:36:16.681443+08
164	B-0164	142	4.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:34:10.624063+08
201	B-0201	28	6.000	6.000	2026-11-20	2030-11-20	2	2026-11-20 18:14:34.430976+08
105	B-0105	18	0.900	0.000	2026-11-13	2026-11-15	3	2026-11-13 12:02:53.49185+08
203	B-0203	146	10.000	0.000	2026-11-21	2026-11-21	2	2026-11-21 18:15:51.803782+08
207	B-0207	28	3.000	3.000	2026-11-22	2028-11-22	2	2026-11-22 15:27:37.609923+08
103	B-0103	16	4.500	0.000	2026-11-13	2026-11-16	3	2026-11-13 12:02:53.49185+08
104	B-0104	17	3.600	0.000	2026-11-13	2026-11-16	3	2026-11-13 12:02:53.49185+08
90	B-0090	3	9.500	0.000	2026-11-13	2026-11-17	3	2026-11-13 12:02:53.49185+08
107	B-0107	107	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
108	B-0108	108	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
109	B-0109	109	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
147	B-0147	109	10.000	0.000	2026-11-15	2026-11-15	2	2026-11-15 22:15:05.745796+08
110	B-0110	110	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
111	B-0111	111	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
112	B-0112	112	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
113	B-0113	113	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
114	B-0114	114	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
151	B-0151	114	10.000	0.000	2026-11-15	2026-11-15	2	2026-11-15 22:15:26.331181+08
115	B-0115	115	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
116	B-0116	116	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
117	B-0117	117	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
146	B-0146	117	10.000	0.000	2026-11-15	2026-11-15	2	2026-11-15 22:15:01.745663+08
118	B-0118	118	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
149	B-0149	118	10.000	0.000	2026-11-15	2026-11-15	2	2026-11-15 22:15:16.576667+08
119	B-0119	119	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
120	B-0120	120	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
121	B-0121	121	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
122	B-0122	122	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
153	B-0153	122	10.000	0.000	2026-11-15	2026-11-15	2	2026-11-15 22:15:33.576111+08
123	B-0123	123	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
124	B-0124	124	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
125	B-0125	125	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
148	B-0148	125	10.000	0.000	2026-11-15	2026-11-15	2	2026-11-15 22:15:12.497859+08
126	B-0126	126	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
127	B-0127	127	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
144	B-0144	127	10.000	0.000	2026-11-15	2026-11-15	2	2026-11-15 22:14:53.318182+08
128	B-0128	128	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
150	B-0150	128	10.000	0.000	2026-11-15	2026-11-15	2	2026-11-15 22:15:21.859256+08
129	B-0129	129	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
152	B-0152	129	10.000	0.000	2026-11-15	2026-11-15	2	2026-11-15 22:15:30.01339+08
130	B-0130	130	15.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
131	B-0131	131	15.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
132	B-0132	132	15.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
133	B-0133	133	15.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
134	B-0134	134	15.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
135	B-0135	135	15.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
136	B-0136	136	15.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
137	B-0137	137	10.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
138	B-0138	138	10.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
139	B-0139	139	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
140	B-0140	140	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
141	B-0141	141	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
143	B-0143	143	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
210	B-0210	38	3.000	3.000	2026-11-22	2026-11-28	2	2026-11-22 17:56:32.345594+08
156	B-0156	140	10.000	0.000	2026-11-16	2026-11-16	2	2026-11-16 15:35:49.63593+08
158	B-0158	143	10.000	0.000	2026-11-16	2026-11-16	2	2026-11-16 15:36:03.225596+08
215	B-0215	72	3.000	2.500	2026-11-22	2026-11-28	2	2026-11-22 17:59:01.581346+08
155	B-0155	108	10.000	0.000	2026-11-15	2026-11-15	2	2026-11-15 22:15:51.614376+08
154	B-0154	111	10.000	0.000	2026-11-15	2026-11-15	2	2026-11-15 22:15:37.759035+08
145	B-0145	119	10.000	0.000	2026-11-15	2026-11-15	2	2026-11-15 22:14:58.396665+08
142	B-0142	142	12.000	0.000	2026-11-13	2026-11-13	3	2026-11-13 12:02:53.49185+08
40	B-0040	59	4.500	4.500	2026-11-13	2026-11-28	3	2026-11-13 12:02:53.49185+08
218	B-0218	86	6.000	6.000	2026-11-22	2026-12-05	2	2026-11-22 18:00:33.795288+08
234	B-0234	12	5.000	3.800	2026-11-22	2026-12-02	2	2026-11-22 18:05:21.419607+08
232	B-0232	4	4.000	4.000	2026-11-22	2026-12-02	2	2026-11-22 18:05:02.246479+08
236	B-0236	15	5.000	5.000	2026-11-22	2026-12-02	2	2026-11-22 18:05:42.184041+08
238	B-0238	16	6.000	6.000	2026-11-22	2026-12-02	2	2026-11-22 18:06:04.780969+08
242	B-0242	11	7.000	7.000	2026-11-22	2026-11-28	2	2026-11-22 18:06:54.345393+08
244	B-0244	8	7.000	7.000	2026-11-22	2026-11-28	2	2026-11-22 18:07:17.194429+08
269	B-0269	111	10.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:12:38.445749+08
247	B-0247	7	7.000	5.000	2026-11-22	2026-12-02	2	2026-11-22 18:07:48.158211+08
250	B-0250	18	3.000	3.000	2026-11-22	2026-12-02	2	2026-11-22 18:08:41.409391+08
75	B-0075	94	5.600	5.570	2026-11-13	\N	3	2026-11-13 12:02:53.49185+08
212	B-0212	56	4.000	1.000	2026-11-22	2026-11-25	2	2026-11-22 17:57:28.382799+08
332	B-0332	119	10.000	9.000	2026-11-25	2026-11-25	3	2026-11-25 13:04:44.134259+08
273	B-0273	120	101.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:13:10.13524+08
277	B-0277	135	5.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:14:18.924295+08
279	B-0279	135	1.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:14:32.106709+08
266	B-0266	114	10.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:12:26.786925+08
177	B-0177	111	8.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:37:31.632185+08
168	B-0168	117	8.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:35:28.604761+08
171	B-0171	118	9.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:35:59.796183+08
181	B-0181	120	7.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:38:05.040491+08
188	B-0188	121	10.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:38:46.903871+08
176	B-0176	122	7.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:37:02.970663+08
186	B-0186	124	9.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:38:36.958802+08
170	B-0170	125	7.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:35:51.478848+08
184	B-0184	126	10.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:38:25.388141+08
173	B-0173	128	9.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:36:42.190929+08
175	B-0175	129	8.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:36:56.070581+08
193	B-0193	130	8.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:39:17.257697+08
195	B-0195	132	10.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:39:27.839036+08
192	B-0192	134	9.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:39:12.836691+08
191	B-0191	135	10.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:39:09.099362+08
197	B-0197	137	8.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:39:36.286125+08
165	B-0165	139	6.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:34:20.85787+08
162	B-0162	141	7.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:33:49.422504+08
163	B-0163	143	9.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:33:59.123004+08
199	B-0199	144	4.000	0.000	2026-11-17	2026-11-17	2	2026-11-17 15:42:11.950362+08
200	B-0200	94	3.000	3.000	2026-11-20	\N	2	2026-11-20 18:13:56.552819+08
268	B-0268	122	10.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:12:34.950148+08
276	B-0276	136	5.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:14:14.596787+08
204	B-0204	107	10.000	0.000	2026-11-21	2026-11-21	2	2026-11-21 18:16:10.256943+08
202	B-0202	145	10.000	0.000	2026-11-21	2026-11-21	2	2026-11-21 18:14:53.83135+08
205	B-0205	147	5.000	0.000	2026-11-21	2026-11-21	2	2026-11-21 18:17:03.123036+08
206	B-0206	148	5.000	0.000	2026-11-21	2026-11-21	2	2026-11-21 18:17:41.76152+08
278	B-0278	136	3.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:14:25.714868+08
281	B-0281	130	15.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:14:46.236861+08
280	B-0280	134	10.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:14:39.848667+08
284	B-0284	138	8.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:15:05.116283+08
287	B-0287	147	4.000	0.000	2026-11-22	2026-11-22	3	2026-11-22 20:06:53.112136+08
288	B-0288	148	5.000	0.000	2026-11-22	2026-11-22	3	2026-11-22 20:07:02.413985+08
289	B-0289	148	2.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 20:19:44.709305+08
294	B-0294	109	4.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 23:32:04.137172+08
298	B-0298	114	6.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 23:32:27.342611+08
292	B-0292	117	6.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 23:31:54.387435+08
293	B-0293	117	4.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 23:31:58.805336+08
296	B-0296	118	6.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 23:32:16.118983+08
291	B-0291	119	6.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 23:31:47.409112+08
219	B-0219	54	4.000	0.000	2026-11-22	2026-11-28	2	2026-11-22 18:00:42.624117+08
256	B-0256	127	5.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:09:34.26678+08
275	B-0275	113	5.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:13:50.216518+08
274	B-0274	115	5.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:13:34.946267+08
271	B-0271	107	5.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:13:01.762046+08
272	B-0272	116	5.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:13:06.295318+08
270	B-0270	108	5.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:12:56.919351+08
257	B-0257	119	5.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:09:40.563927+08
262	B-0262	145	5.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:10:09.886773+08
261	B-0261	118	5.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:10:04.019683+08
267	B-0267	129	10.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:12:30.484675+08
259	B-0259	109	7.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:09:51.34939+08
258	B-0258	117	10.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:09:45.900266+08
260	B-0260	125	8.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:09:57.192723+08
263	B-0263	128	10.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:10:17.767294+08
282	B-0282	137	8.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:14:57.282556+08
295	B-0295	125	6.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 23:32:09.030648+08
290	B-0290	127	5.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 23:31:42.079076+08
297	B-0297	128	6.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 23:32:21.555411+08
255	B-0255	139	5.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:09:28.769925+08
251	B-0251	140	5.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:09:08.595763+08
252	B-0252	141	5.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:09:14.314658+08
254	B-0254	142	7.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:09:23.625595+08
253	B-0253	143	6.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:09:18.703063+08
285	B-0285	145	10.000	0.000	2026-11-22	2026-11-22	3	2026-11-22 20:06:03.05273+08
299	B-0299	145	13.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 23:39:50.51853+08
283	B-0283	146	8.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:15:01.118831+08
300	B-0300	146	7.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 23:40:09.488405+08
301	B-0301	146	2.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 23:40:14.293496+08
302	B-0302	147	55.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 23:40:33.931954+08
303	B-0303	148	3.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 23:40:52.668438+08
264	B-0264	149	40.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:11:32.612879+08
265	B-0265	150	40.000	0.000	2026-11-22	2026-11-22	2	2026-11-22 18:12:12.390743+08
19	B-0019	38	8.400	7.950	2026-11-13	2027-05-12	3	2026-11-13 12:02:53.49185+08
222	B-0222	53	4.000	3.100	2026-11-22	2026-11-28	2	2026-11-22 18:01:50.005033+08
217	B-0217	55	5.000	2.000	2026-11-22	2026-11-28	2	2026-11-22 18:00:16.696823+08
41	B-0041	60	18.000	17.450	2026-11-13	2026-12-13	3	2026-11-13 12:02:53.49185+08
42	B-0042	61	9.000	8.800	2026-11-13	2026-12-13	3	2026-11-13 12:02:53.49185+08
70	B-0070	89	7.000	6.970	2026-11-13	\N	3	2026-11-13 12:02:53.49185+08
79	B-0079	98	0.700	0.655	2026-11-13	2027-11-13	3	2026-11-13 12:02:53.49185+08
333	B-0333	107	10.000	10.000	2026-11-25	2026-11-25	2	2026-11-25 15:39:04.788842+08
306	B-0306	148	3.000	0.000	2026-11-23	2026-11-23	2	2026-11-23 00:10:36.936097+08
309	B-0309	148	1.000	0.000	2026-11-23	2026-11-23	2	2026-11-23 00:34:22.324638+08
305	B-0305	146	15.000	0.000	2026-11-23	2026-11-23	2	2026-11-23 00:10:25.290834+08
310	B-0310	146	2.000	0.000	2026-11-23	2026-11-23	2	2026-11-23 00:58:26.814065+08
304	B-0304	145	20.000	0.000	2026-11-23	2026-11-23	2	2026-11-23 00:10:14.995718+08
312	B-0312	3	10.000	9.000	2026-11-23	2026-12-02	2	2026-11-23 01:33:34.371075+08
311	B-0311	145	3.000	0.000	2026-11-23	2026-11-23	2	2026-11-23 01:06:58.270055+08
314	B-0314	151	10.000	10.000	2026-11-23	\N	2	2026-11-23 01:44:41.973136+08
317	B-0317	17	5.000	5.000	2026-11-23	2026-12-05	2	2026-11-23 01:48:40.211768+08
315	B-0315	17	5.000	0.000	2026-11-23	2026-12-02	2	2026-11-23 01:47:20.084159+08
316	B-0316	17	5.000	3.000	2026-11-23	2026-12-04	2	2026-11-23 01:47:30.527739+08
319	B-0319	12	5.000	5.000	2026-11-23	2026-11-28	2	2026-11-23 02:01:33.990109+08
318	B-0318	12	5.000	5.000	2026-11-23	2026-11-23	2	2026-11-23 02:00:59.216714+08
320	B-0320	96	4.000	4.000	2026-11-23	\N	2	2026-11-23 02:21:49.190762+08
313	B-0313	145	20.000	0.000	2026-11-23	2026-11-23	2	2026-11-23 01:38:28.846829+08
307	B-0307	147	5.000	0.000	2026-11-23	2026-11-23	2	2026-11-23 00:10:44.033306+08
308	B-0308	147	2.000	0.000	2026-11-23	2026-11-23	2	2026-11-23 00:34:17.253787+08
321	B-0321	145	10.000	0.000	2026-11-23	2026-11-23	2	2026-11-23 03:01:06.430051+08
323	B-0323	127	100.000	0.000	2026-11-23	2026-11-23	2	2026-11-23 03:39:12.963451+08
327	B-0327	109	6.000	0.000	2026-11-23	2026-11-23	2	2026-11-23 03:40:43.528861+08
326	B-0326	117	6.000	0.000	2026-11-23	2026-11-23	2	2026-11-23 03:40:39.40231+08
325	B-0325	119	6.000	0.000	2026-11-23	2026-11-23	2	2026-11-23 03:40:35.146191+08
324	B-0324	127	100000.000	0.000	2026-11-23	2026-11-23	2	2026-11-23 03:39:30.819078+08
322	B-0322	145	11.000	0.000	2026-11-23	2026-11-23	2	2026-11-23 03:01:29.825978+08
328	B-0328	152	6.000	0.000	2026-11-23	2026-11-23	2	2026-11-23 03:46:21.598711+08
329	B-0329	107	20.000	20.000	2026-11-25	2026-11-25	2	2026-11-25 12:52:19.731501+08
\.


--
-- Data for Name: items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.items (id, name, item_type, category_id, unit, min_level, has_expiry, price, is_active, created_at, servings_per_tray) FROM stdin;
144	Pakbet Food tray	food_tray	8	trays	2.000	f	10.00	t	2026-11-17 15:42:11.950362+08	10
147	Kare Kare	food_tray	8	trays	3.000	f	60.00	t	2026-11-21 18:17:03.123036+08	10
151	Jasmine Rice	ingredient	2	kg	10.000	f	\N	t	2026-11-23 01:44:41.973136+08	10
3	Pork Belly	ingredient	3	kg	6.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
148	Lumpiang Shanghai	food_tray	8	trays	3.000	f	45.00	t	2026-11-21 18:17:41.76152+08	10
28	All-Purpose Cream	ingredient	1	pack	4.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
149	Rice	food	5	servings	30.000	f	3.50	t	2026-11-22 18:11:32.612879+08	10
145	Chicken Adobo	food	4	servings	4.000	f	7.00	t	2026-11-21 18:14:53.83135+08	10
152	Pancit Bihón	food	4	servings	5.000	f	6.00	t	2026-11-23 03:46:21.598711+08	10
1	Pork Pata	ingredient	3	kg	5.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
2	Pork Spareribs	ingredient	3	kg	2.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
4	Bagnet (Crispy Pork Belly)	ingredient	3	kg	2.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
5	Pork	ingredient	3	kg	4.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
6	Ground Pork	ingredient	3	kg	3.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
7	Pork Lungs	ingredient	3	kg	0.800	t	\N	t	2026-11-13 12:02:12.110228+08	10
8	Pork Heart	ingredient	3	kg	0.800	t	\N	t	2026-11-13 12:02:12.110228+08	10
9	Pork Liver	ingredient	3	kg	0.600	t	\N	t	2026-11-13 12:02:12.110228+08	10
10	Pork Intestines	ingredient	3	kg	1.200	t	\N	t	2026-11-13 12:02:12.110228+08	10
11	Pork Blood	ingredient	3	kg	1.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
12	Beef	ingredient	3	kg	2.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
13	Beef Slices	ingredient	3	kg	2.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
14	Beef Brisket	ingredient	3	kg	1.600	t	\N	t	2026-11-13 12:02:12.110228+08	10
15	Beef Shank (with Marrow)	ingredient	3	kg	3.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
16	Chicken	ingredient	3	kg	3.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
17	Bangus	ingredient	3	kg	2.400	t	\N	t	2026-11-13 12:02:12.110228+08	10
18	Shrimp	ingredient	3	kg	0.600	t	\N	t	2026-11-13 12:02:12.110228+08	10
19	Hotdog	ingredient	3	pack	1.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
20	Eggs	ingredient	1	pcs	120.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
21	Quail Eggs	ingredient	1	pcs	150.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
22	Milk	ingredient	1	L	2.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
23	Butter	ingredient	1	kg	0.900	t	\N	t	2026-11-13 12:02:12.110228+08	10
24	Cheese	ingredient	1	kg	0.900	t	\N	t	2026-11-13 12:02:12.110228+08	10
25	Condensed Milk	ingredient	1	can	10.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
26	Evaporated Milk	ingredient	1	can	5.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
27	Table Cream	ingredient	1	can	5.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
29	Cooking Oil	ingredient	1	L	30.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
30	Sesame Oil	ingredient	1	L	0.500	t	\N	t	2026-11-13 12:02:12.110228+08	10
31	Soy Sauce	ingredient	1	L	7.500	t	\N	t	2026-11-13 12:02:12.110228+08	10
32	Fish Sauce	ingredient	1	L	4.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
33	Oyster Sauce	ingredient	1	L	3.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
34	Vinegar	ingredient	1	L	5.000	f	\N	t	2026-11-13 12:02:12.110228+08	10
35	Tomato Sauce	ingredient	1	L	7.500	t	\N	t	2026-11-13 12:02:12.110228+08	10
36	Liver Spread	ingredient	1	kg	1.500	t	\N	t	2026-11-13 12:02:12.110228+08	10
37	Peanut Butter	ingredient	1	kg	2.500	t	\N	t	2026-11-13 12:02:12.110228+08	10
38	Bagoong Alamang	ingredient	1	kg	3.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
39	Bagoong Isda	ingredient	1	kg	0.500	t	\N	t	2026-11-13 12:02:12.110228+08	10
40	Mayonnaise	ingredient	1	kg	2.500	t	\N	t	2026-11-13 12:02:12.110228+08	10
41	Banana Ketchup	ingredient	1	L	1.500	t	\N	t	2026-11-13 12:02:12.110228+08	10
42	Sweet Chili Sauce	ingredient	1	L	1.500	t	\N	t	2026-11-13 12:02:12.110228+08	10
43	Calamansi Juice	ingredient	1	L	2.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
44	Coconut Milk	ingredient	1	L	7.500	t	\N	t	2026-11-13 12:02:12.110228+08	10
45	Beef Broth	ingredient	1	L	15.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
46	Vanilla Extract	ingredient	1	bottle	1.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
47	Pickle Relish	ingredient	1	jar	1.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
48	Ube Flavoring	ingredient	1	bottle	1.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
49	Ube Halaya	ingredient	1	kg	1.200	t	\N	t	2026-11-13 12:02:12.110228+08	10
50	Canned Fruit Cocktail	ingredient	1	can	5.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
51	Nata de Coco	ingredient	1	jar	1.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
52	Kaong	ingredient	1	jar	1.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
53	Eggplant	ingredient	1	kg	4.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
54	Sitaw (String Beans)	ingredient	1	bunch	6.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
55	Pechay	ingredient	1	bunch	4.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
56	Banana Blossom	ingredient	1	pcs	2.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
57	Potatoes	ingredient	1	kg	9.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
58	Carrots	ingredient	1	kg	7.500	t	\N	t	2026-11-13 12:02:12.110228+08	10
59	Bell Pepper	ingredient	1	kg	3.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
60	Onion	ingredient	1	kg	9.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
61	Garlic	ingredient	1	kg	4.500	t	\N	t	2026-11-13 12:02:12.110228+08	10
62	Tomato	ingredient	1	kg	4.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
63	Chili Peppers	ingredient	1	kg	0.600	t	\N	t	2026-11-13 12:02:12.110228+08	10
64	Long Green Chili	ingredient	1	kg	0.400	t	\N	t	2026-11-13 12:02:12.110228+08	10
65	Calamansi	ingredient	1	kg	3.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
66	Spring Onion	ingredient	1	bunch	4.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
67	Ampalaya	ingredient	1	kg	1.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
68	Okra	ingredient	1	kg	1.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
69	Kalabasa (Squash)	ingredient	1	kg	3.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
70	Cabbage	ingredient	1	kg	6.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
71	Cauliflower	ingredient	1	kg	1.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
72	Broccoli	ingredient	1	kg	2.400	t	\N	t	2026-11-13 12:02:12.110228+08	10
73	Sayote	ingredient	1	kg	1.500	t	\N	t	2026-11-13 12:02:12.110228+08	10
74	Malunggay	ingredient	1	bunch	2.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
75	Spinach	ingredient	1	bunch	2.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
76	Radish	ingredient	1	kg	1.500	t	\N	t	2026-11-13 12:02:12.110228+08	10
77	Kangkong	ingredient	1	bunch	2.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
78	Gabi (Taro)	ingredient	1	kg	1.500	t	\N	t	2026-11-13 12:02:12.110228+08	10
79	Ginger	ingredient	1	kg	0.900	t	\N	t	2026-11-13 12:02:12.110228+08	10
80	Bean Sprouts	ingredient	1	kg	1.600	t	\N	t	2026-11-13 12:02:12.110228+08	10
81	Green Beans	ingredient	1	kg	0.800	t	\N	t	2026-11-13 12:02:12.110228+08	10
82	Sweet Potato	ingredient	1	kg	1.500	t	\N	t	2026-11-13 12:02:12.110228+08	10
83	Mushrooms	ingredient	1	kg	1.600	t	\N	t	2026-11-13 12:02:12.110228+08	10
84	Green Peas	ingredient	1	kg	1.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
85	Corn	ingredient	1	pcs	8.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
86	Ripe Mangoes	ingredient	1	kg	3.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
87	Tamarind	ingredient	1	kg	1.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
88	Ube (Purple Yam)	ingredient	1	kg	0.900	t	\N	t	2026-11-13 12:02:12.110228+08	10
89	Salt	ingredient	2	kg	2.500	f	\N	t	2026-11-13 12:02:12.110228+08	10
90	White Sugar	ingredient	2	kg	5.000	f	\N	t	2026-11-13 12:02:12.110228+08	10
91	Brown Sugar	ingredient	2	kg	1.000	f	\N	t	2026-11-13 12:02:12.110228+08	10
92	Black Pepper	ingredient	2	kg	0.800	f	\N	t	2026-11-13 12:02:12.110228+08	10
93	Whole Peppercorn	ingredient	2	kg	0.300	f	\N	t	2026-11-13 12:02:12.110228+08	10
94	Cornstarch	ingredient	2	kg	2.000	f	\N	t	2026-11-13 12:02:12.110228+08	10
95	Bay Leaves	ingredient	2	pack	1.000	f	\N	t	2026-11-13 12:02:12.110228+08	10
96	Star Anise	ingredient	2	pack	1.000	f	\N	t	2026-11-13 12:02:12.110228+08	10
97	All-Purpose Flour	ingredient	2	kg	5.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
98	Annatto (Atsuete)	ingredient	2	kg	0.300	t	\N	t	2026-11-13 12:02:12.110228+08	10
99	Mung Beans	ingredient	2	kg	3.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
100	Egg Noodles	ingredient	2	kg	5.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
101	Elbow Macaroni	ingredient	2	kg	4.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
102	Lumpia Wrappers	ingredient	2	pack	5.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
103	Graham Crackers	ingredient	2	pack	5.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
104	Raisins	ingredient	2	kg	0.500	t	\N	t	2026-11-13 12:02:12.110228+08	10
105	Sinigang Mix	ingredient	2	pack	5.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
106	Beef Seasoning Cube	ingredient	2	pack	2.000	t	\N	t	2026-11-13 12:02:12.110228+08	10
107	Kare-Kare (Pork Pata)	food	4	servings	4.000	f	13.00	t	2026-11-13 12:02:12.110228+08	10
108	Kaldereta Spareribs	food	4	servings	4.000	f	12.00	t	2026-11-13 12:02:12.110228+08	10
109	Binagoongan	food	4	servings	4.000	f	10.50	t	2026-11-13 12:02:12.110228+08	10
110	Sarsiado Bangus	food	4	servings	4.000	f	10.50	t	2026-11-13 12:02:12.110228+08	10
111	Giniling na Baboy	food	4	servings	4.000	f	9.00	t	2026-11-13 12:02:12.110228+08	10
112	Sisig Bagnet	food	4	servings	4.000	f	11.50	t	2026-11-13 12:02:12.110228+08	10
113	Pakbet	food	4	servings	4.000	f	8.50	t	2026-11-13 12:02:12.110228+08	10
114	Chop Suey	food	4	servings	4.000	f	8.50	t	2026-11-13 12:02:12.110228+08	10
115	Monggo	food	4	servings	4.000	f	8.00	t	2026-11-13 12:02:12.110228+08	10
116	Lechon Kawali	food	4	servings	4.000	f	11.50	t	2026-11-13 12:02:12.110228+08	10
117	Bicol Express	food	4	servings	4.000	f	10.50	t	2026-11-13 12:02:12.110228+08	10
118	Bopis	food	4	servings	4.000	f	9.50	t	2026-11-13 12:02:12.110228+08	10
119	Beef Mushroom	food	4	servings	4.000	f	11.50	t	2026-11-13 12:02:12.110228+08	10
120	Menudo	food	4	servings	4.000	f	9.50	t	2026-11-13 12:02:12.110228+08	10
121	Sinigang na Baboy	food	4	servings	4.000	f	11.00	t	2026-11-13 12:02:12.110228+08	10
122	Ginataang Sitaw at Kalabasa	food	4	servings	4.000	f	8.50	t	2026-11-13 12:02:12.110228+08	10
123	Paksiw na Pata	food	4	servings	4.000	f	12.00	t	2026-11-13 12:02:12.110228+08	10
124	Pork Mechado	food	4	servings	4.000	f	10.50	t	2026-11-13 12:02:12.110228+08	10
125	Bistek Tagalog	food	4	servings	4.000	f	11.50	t	2026-11-13 12:02:12.110228+08	10
126	Paksiw na Bangus	food	4	servings	4.000	f	10.00	t	2026-11-13 12:02:12.110228+08	10
127	Beef Broccoli	food	4	servings	4.000	f	11.50	t	2026-11-13 12:02:12.110228+08	10
128	Chicken Afritada	food	4	servings	4.000	f	9.50	t	2026-11-13 12:02:12.110228+08	10
129	Classic Dinuguan	food	4	servings	4.000	f	9.50	t	2026-11-13 12:02:12.110228+08	10
130	Pork Shanghai	food	5	servings	5.000	f	6.50	t	2026-11-13 12:02:12.110228+08	10
131	Vegetable Spring Roll	food	5	servings	5.000	f	5.50	t	2026-11-13 12:02:12.110228+08	10
132	Vegetable Okoy	food	5	servings	5.000	f	5.50	t	2026-11-13 12:02:12.110228+08	10
133	Torta Talong	food	5	servings	5.000	f	5.50	t	2026-11-13 12:02:12.110228+08	10
134	Kwek-Kwek	food	5	servings	5.000	f	4.50	t	2026-11-13 12:02:12.110228+08	10
135	Embutido	food	5	servings	5.000	f	6.00	t	2026-11-13 12:02:12.110228+08	10
136	Chicharon Bulaklak	food	5	servings	5.000	f	8.50	t	2026-11-13 12:02:12.110228+08	10
137	Beef Mami	food	6	servings	3.000	f	9.50	t	2026-11-13 12:02:12.110228+08	10
138	Special Bulalo	food	6	servings	3.000	f	14.00	t	2026-11-13 12:02:12.110228+08	10
140	Fruit Salad	food	7	servings	4.000	f	4.00	f	2026-11-13 12:02:12.110228+08	10
146	Pancit Bihon	food	6	servings	4.000	f	5.50	t	2026-11-21 18:15:51.803782+08	10
150	Fried Rice	food	5	servings	30.000	f	4.00	t	2026-11-22 18:12:12.390743+08	10
141	Leche Flan	food	7	servings	4.000	f	3.50	f	2026-11-13 12:02:12.110228+08	10
143	Macaroni Salad	food	7	servings	4.000	f	4.00	f	2026-11-13 12:02:12.110228+08	10
139	Ube Bar	food	7	servings	4.000	f	3.50	f	2026-11-13 12:02:12.110228+08	10
142	Mango Graham	food	7	servings	4.000	f	4.00	f	2026-11-13 12:02:12.110228+08	10
\.


--
-- Data for Name: order_items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.order_items (id, order_id, item_id, item_name, unit_price, qty) FROM stdin;
1	1	140	Fruit Salad	3.50	1
2	1	142	Mango Graham	4.00	1
3	2	119	Beef Mushroom	11.50	1
4	2	142	Mango Graham	4.00	2
5	3	119	Beef Mushroom	11.50	2
6	3	141	Leche Flan	3.50	1
7	4	127	Beef Broccoli	11.50	1
8	4	143	Macaroni Salad	4.00	1
9	5	109	Binagoongan	10.50	1
10	5	143	Macaroni Salad	4.00	1
11	6	141	Leche Flan	3.50	1
12	7	113	Pakbet	8.50	1
13	7	124	Pork Mechado	10.50	1
14	8	133	Torta Talong	5.50	1
15	8	138	Special Bulalo	14.00	1
16	9	112	Sisig Bagnet	11.50	1
17	9	130	Pork Shanghai	6.50	1
18	10	145	Chicken Adobo	6.00	3
19	10	146	Pancit Bihon	5.50	2
20	11	119	Beef Mushroom	11.50	1
21	11	137	Beef Mami	9.50	1
22	12	114	Chop Suey	8.50	1
23	12	128	Chicken Afritada	9.50	1
24	13	137	Beef Mami	9.50	1
25	13	149	Rice	3.50	1
26	14	117	Bicol Express	10.50	1
27	14	127	Beef Broccoli	11.50	1
28	14	134	Kwek-Kwek	4.50	1
29	15	117	Bicol Express	10.50	1
30	15	134	Kwek-Kwek	4.50	1
31	15	136	Chicharon Bulaklak	8.50	1
32	15	150	Fried Rice	4.00	1
33	16	146	Pancit Bihon	5.50	1
34	17	107	Kare-Kare (Pork Pata)	13.00	1
35	17	108	Kaldereta Spareribs	12.00	1
36	17	109	Binagoongan	10.50	1
37	17	111	Giniling na Baboy	9.00	1
38	17	113	Pakbet	8.50	1
39	17	114	Chop Suey	8.50	1
40	17	115	Monggo	8.00	1
41	17	116	Lechon Kawali	11.50	1
42	17	117	Bicol Express	10.50	1
43	17	118	Bopis	9.50	1
44	17	119	Beef Mushroom	11.50	1
45	17	120	Menudo	9.50	1
46	17	122	Ginataang Sitaw at Kalabasa	8.50	1
47	17	125	Bistek Tagalog	11.50	1
48	17	127	Beef Broccoli	11.50	1
49	17	128	Chicken Afritada	9.50	1
50	17	129	Classic Dinuguan	9.50	1
51	17	145	Chicken Adobo	6.00	1
52	18	107	Kare-Kare (Pork Pata)	13.00	2
53	18	120	Menudo	9.50	2
54	19	116	Lechon Kawali	11.50	2
55	19	119	Beef Mushroom	11.50	2
56	19	127	Beef Broccoli	11.50	3
57	20	107	Kare-Kare (Pork Pata)	13.00	1
58	20	108	Kaldereta Spareribs	12.00	1
59	20	122	Ginataang Sitaw at Kalabasa	8.50	1
60	20	125	Bistek Tagalog	11.50	1
61	20	128	Chicken Afritada	9.50	1
62	21	113	Pakbet	8.50	4
63	21	115	Monggo	8.00	4
64	21	116	Lechon Kawali	11.50	1
65	22	107	Kare-Kare (Pork Pata)	13.00	1
66	22	111	Giniling na Baboy	9.00	1
67	22	116	Lechon Kawali	11.50	1
68	22	120	Menudo	9.50	1
69	22	122	Ginataang Sitaw at Kalabasa	8.50	1
70	22	129	Classic Dinuguan	9.50	1
71	23	108	Kaldereta Spareribs	12.00	3
72	24	109	Binagoongan	10.50	1
73	24	111	Giniling na Baboy	9.00	1
74	24	114	Chop Suey	8.50	1
75	24	117	Bicol Express	10.50	1
76	24	118	Bopis	9.50	1
77	24	119	Beef Mushroom	11.50	1
78	24	120	Menudo	9.50	1
79	24	122	Ginataang Sitaw at Kalabasa	8.50	1
80	24	125	Bistek Tagalog	11.50	1
81	24	128	Chicken Afritada	9.50	1
82	24	129	Classic Dinuguan	9.50	1
83	24	145	Chicken Adobo	6.00	1
84	25	109	Binagoongan	10.50	1
85	25	114	Chop Suey	8.50	1
86	25	117	Bicol Express	10.50	1
87	25	118	Bopis	9.50	1
88	25	125	Bistek Tagalog	11.50	1
89	25	129	Classic Dinuguan	9.50	1
90	25	149	Rice	3.50	4
91	26	111	Giniling na Baboy	9.00	2
92	26	114	Chop Suey	8.50	1
93	26	117	Bicol Express	10.50	1
94	26	118	Bopis	9.50	1
95	26	128	Chicken Afritada	9.50	1
96	27	145	Chicken Adobo	6.00	3
97	28	109	Binagoongan	10.50	2
98	28	117	Bicol Express	10.50	2
99	28	118	Bopis	9.50	1
100	28	125	Bistek Tagalog	11.50	2
101	29	109	Binagoongan	10.50	1
102	29	114	Chop Suey	8.50	1
103	29	117	Bicol Express	10.50	1
104	29	122	Ginataang Sitaw at Kalabasa	8.50	1
105	29	129	Classic Dinuguan	9.50	1
106	30	129	Classic Dinuguan	9.50	5
107	31	111	Giniling na Baboy	9.00	1
108	31	120	Menudo	9.50	1
109	31	125	Bistek Tagalog	11.50	1
110	31	128	Chicken Afritada	9.50	1
111	32	109	Binagoongan	10.50	1
112	32	111	Giniling na Baboy	9.00	1
113	32	117	Bicol Express	10.50	1
114	32	120	Menudo	9.50	1
115	32	125	Bistek Tagalog	11.50	1
116	32	137	Beef Mami	9.50	1
117	33	120	Menudo	9.50	1
118	33	130	Pork Shanghai	6.50	1
119	33	134	Kwek-Kwek	4.50	1
120	33	138	Special Bulalo	14.00	1
121	33	146	Pancit Bihon	5.50	1
122	33	149	Rice	3.50	5
123	34	111	Giniling na Baboy	9.00	1
124	34	114	Chop Suey	8.50	1
125	34	122	Ginataang Sitaw at Kalabasa	8.50	1
126	34	128	Chicken Afritada	9.50	1
127	34	135	Embutido	6.00	1
128	34	136	Chicharon Bulaklak	8.50	1
129	34	137	Beef Mami	9.50	1
130	35	136	Chicharon Bulaklak	8.50	2
131	35	137	Beef Mami	9.50	2
132	35	149	Rice	3.50	2
133	36	128	Chicken Afritada	9.50	3
134	36	137	Beef Mami	9.50	2
135	37	135	Embutido	6.00	2
136	38	111	Giniling na Baboy	9.00	2
137	38	114	Chop Suey	8.50	1
138	38	120	Menudo	9.50	2
139	38	122	Ginataang Sitaw at Kalabasa	8.50	1
140	38	135	Embutido	6.00	3
141	38	149	Rice	3.50	12
142	39	114	Chop Suey	8.50	2
143	39	122	Ginataang Sitaw at Kalabasa	8.50	2
144	40	122	Ginataang Sitaw at Kalabasa	8.50	1
145	40	130	Pork Shanghai	6.50	1
146	40	134	Kwek-Kwek	4.50	1
147	40	136	Chicharon Bulaklak	8.50	4
148	40	138	Special Bulalo	14.00	1
149	40	146	Pancit Bihon	5.50	1
150	40	149	Rice	3.50	1
151	41	130	Pork Shanghai	6.50	13
152	41	134	Kwek-Kwek	4.50	1
153	41	146	Pancit Bihon	5.50	1
154	42	134	Kwek-Kwek	4.50	5
155	42	138	Special Bulalo	14.00	6
156	42	146	Pancit Bihon	5.50	1
157	43	145	Chicken Adobo	6.00	3
158	43	146	Pancit Bihon	5.50	2
159	44	147	Kare Kare	60.00	2
160	44	148	Lumpiang Shanghai	45.00	1
161	45	147	Kare Kare	60.00	2
162	45	148	Lumpiang Shanghai	45.00	4
163	46	148	Lumpiang Shanghai	45.00	2
164	47	145	Chicken Adobo	6.00	3
165	47	146	Pancit Bihon	5.50	2
166	48	147	Kare Kare	60.00	2
167	48	148	Lumpiang Shanghai	45.00	1
168	49	147	Kare Kare	60.00	2
169	49	148	Lumpiang Shanghai	45.00	1
170	50	148	Lumpiang Shanghai	45.00	2
171	51	146	Pancit Bihon	5.50	2
172	52	146	Pancit Bihon	5.50	2
173	53	145	Chicken Adobo	6.00	18
174	54	145	Chicken Adobo	6.00	1
175	55	145	Chicken Adobo	7.00	1
176	56	145	Chicken Adobo	7.00	1
177	57	147	Kare Kare	60.00	3
178	58	145	Chicken Adobo	7.00	4
180	60	117	Bicol Express	10.50	1
181	60	119	Beef Mushroom	11.50	1
182	60	127	Beef Broccoli	11.50	1
183	61	109	Binagoongan	10.50	1
184	61	117	Bicol Express	10.50	1
185	62	127	Beef Broccoli	11.50	1
186	63	119	Beef Mushroom	11.50	1
187	63	127	Beef Broccoli	11.50	1
\.


--
-- Data for Name: orders; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.orders (id, order_number, order_type, status, total, gst_amount, cashier_id, created_at, completed_at, client_request_id, session_id) FROM stdin;
62	0061	dine_in	preparing	11.50	0.00	1	2026-11-25 19:30:42.227063+08	\N	8b4aa733-886a-413b-afdc-b722480ee76b	12
1	0001	dine_in	completed	7.50	0.00	1	2026-11-15 22:07:27.224826+08	2026-11-15 22:07:50.451167+08	83d0ddc1-4d3d-44dd-b237-f2f5f5ec415f	\N
63	0062	dine_in	preparing	23.00	0.00	1	2026-11-25 19:30:50.564931+08	\N	89b7232d-16db-450e-8af1-1bc56ca2de80	12
3	0003	dine_in	completed	26.50	0.00	1	2026-11-16 15:39:05.259838+08	2026-11-16 15:40:27.746265+08	5cd5501e-fc72-4244-9533-b9e9fe316f2c	\N
2	0002	takeaway	completed	19.50	0.00	1	2026-11-15 22:40:24.176137+08	2026-11-16 15:40:29.739056+08	0e270dd6-2869-4a93-8591-e0727b3a7fd8	\N
5	0005	dine_in	completed	14.50	0.00	1	2026-11-17 15:45:27.293607+08	2026-11-17 15:46:24.165211+08	cf0790c3-fd90-46dc-bbd2-f603958e6974	1
4	0004	dine_in	completed	15.50	0.00	1	2026-11-17 15:43:22.546891+08	2026-11-17 15:46:25.284879+08	bfccbcf4-3e1e-4d63-ac94-ebf4d982d27b	1
9	0009	takeaway	completed	18.00	0.00	1	2026-11-17 15:55:37.746477+08	2026-11-20 18:01:04.148046+08	ce70b37f-a00f-483a-b1df-8a4be2590717	1
8	0008	dine_in	completed	19.50	0.00	1	2026-11-17 15:55:21.793398+08	2026-11-20 18:01:05.576278+08	3bfb2e89-af2d-4763-996a-a3ba6e522d61	1
7	0007	dine_in	completed	19.00	0.00	1	2026-11-17 15:55:14.7844+08	2026-11-20 18:01:06.525985+08	a3c3ffed-a3b1-44b9-9077-4180226bf3f5	1
6	0006	dine_in	completed	3.50	0.00	1	2026-11-17 15:55:07.107969+08	2026-11-20 18:01:07.308638+08	96c7f8f3-1fd5-4f69-baba-37c326d0c519	1
10	0010	dine_in	completed	29.00	0.00	1	2026-11-21 18:22:31.633174+08	2026-11-21 18:23:03.444435+08	f13464f8-b283-44bd-9598-0f11902bf23f	7
13	0013	takeaway	completed	13.00	0.00	1	2026-11-22 18:57:48.057952+08	2026-11-22 18:57:58.244512+08	4aa0865c-d399-4bd1-a605-a93cb11e0b1d	8
12	0012	takeaway	completed	18.00	0.00	1	2026-11-22 18:57:31.445404+08	2026-11-22 18:57:59.491656+08	331bb6fb-2787-4290-8e2d-e69a95a63b23	8
11	0011	dine_in	completed	21.00	0.00	1	2026-11-22 18:57:18.384967+08	2026-11-22 18:58:00.660986+08	9595f729-0b13-4538-b85f-5ba440f5e7f8	8
43	0043	dine_in	completed	29.00	0.00	1	2026-11-22 20:11:19.391761+08	2026-11-22 20:13:06.44533+08	9907199e-6aa4-4e22-9207-f9d728579354	8
46	0046	dine_in	completed	90.00	0.00	1	2026-11-22 20:21:32.207259+08	2026-11-23 00:20:46.354975+08	f218653c-d3f4-4c51-91f3-0918110de266	8
45	0045	dine_in	completed	300.00	0.00	1	2026-11-22 20:17:51.776302+08	2026-11-23 00:20:47.621529+08	4acf0935-518d-4313-96d5-0ad7b950cc4b	8
44	0044	dine_in	completed	165.00	0.00	1	2026-11-22 20:17:08.948779+08	2026-11-23 00:20:48.612333+08	669c56fa-09b3-4db6-9da0-250c9f69bdb3	8
47	0047	dine_in	completed	29.00	0.00	1	2026-11-23 00:16:52.256238+08	2026-11-23 00:20:53.198019+08	ffa165de-6c23-447d-bbc3-0dd73db3f0c2	9
54	0054	dine_in	completed	6.00	0.00	1	2026-11-23 02:25:10.388439+08	2026-11-23 03:08:11.673557+08	fb2f3926-b7cb-41be-b31e-41981e3bc8b0	9
53	0053	dine_in	completed	108.00	0.00	1	2026-11-23 01:07:23.962705+08	2026-11-23 03:08:12.940555+08	49c02dc2-6842-4e9f-a10f-f6e4c5ae61d2	9
52	0052	dine_in	completed	11.00	0.00	1	2026-11-23 00:59:15.006205+08	2026-11-23 03:08:13.739845+08	451231a1-5b1f-4427-8846-42ba776cff77	9
51	0051	dine_in	completed	11.00	0.00	1	2026-11-23 00:51:07.230094+08	2026-11-23 03:08:14.53881+08	b07cb4b0-e752-43b9-8aed-68dd32f403f8	9
50	0050	dine_in	completed	90.00	0.00	1	2026-11-23 00:37:40.859829+08	2026-11-23 03:08:15.271303+08	966e75d3-345f-43c2-8bdd-dca9855157f3	9
49	0049	dine_in	completed	165.00	0.00	1	2026-11-23 00:34:42.844015+08	2026-11-23 03:08:16.717806+08	ce171b70-3701-4623-9b6b-0e4efd84efce	9
48	0048	dine_in	completed	165.00	0.00	1	2026-11-23 00:33:09.710179+08	2026-11-23 03:08:17.441946+08	c9231576-d781-46a0-ae1d-a1ea44170ac3	9
42	0042	dine_in	completed	112.00	0.00	1	2026-11-22 19:58:49.369936+08	2026-11-23 03:08:19.101308+08	0e1bcf29-e2f8-44e4-bac9-7e633b9bde7c	8
41	0041	dine_in	completed	94.50	0.00	1	2026-11-22 19:58:33.602922+08	2026-11-23 03:08:20.386591+08	46a53ee8-e9e8-4a71-a0b9-c3e0cc592e87	8
40	0040	dine_in	completed	76.50	0.00	1	2026-11-22 19:58:15.335217+08	2026-11-23 03:08:21.182451+08	7c5f6594-fae9-42c4-9a9f-6ed792aaf2de	8
38	0038	dine_in	completed	114.00	0.00	1	2026-11-22 19:57:46.206683+08	2026-11-23 03:08:22.567572+08	5d27ea27-abaa-4fc4-be51-8144da09e05e	8
39	0039	dine_in	completed	34.00	0.00	1	2026-11-22 19:57:58.645979+08	2026-11-23 03:08:23.436856+08	aebdcfba-0833-4ae0-ab85-189af40eeaa5	8
37	0037	dine_in	completed	12.00	0.00	1	2026-11-22 19:57:26.173455+08	2026-11-23 03:08:24.183943+08	5ce7efc8-163b-4cca-ad98-c7d6c357c159	8
36	0036	dine_in	completed	47.50	0.00	1	2026-11-22 19:57:17.276938+08	2026-11-23 03:08:24.952745+08	a596aaba-7c16-4fcc-8987-88d38be8d0ab	8
35	0035	dine_in	completed	43.00	0.00	1	2026-11-22 19:57:01.737124+08	2026-11-23 03:08:25.820845+08	a77d06d4-9abf-4460-8c61-4fad31b2b6d3	8
34	0034	dine_in	completed	59.50	0.00	1	2026-11-22 19:56:50.485774+08	2026-11-23 03:08:27.51596+08	5e7e148b-9d17-4ba3-b0dd-1738754e69aa	8
33	0033	dine_in	completed	57.50	0.00	1	2026-11-22 19:56:17.599879+08	2026-11-23 03:08:28.240964+08	7210563f-6396-4684-a6c0-74565343462c	8
32	0032	dine_in	completed	60.50	0.00	1	2026-11-22 19:56:05.089704+08	2026-11-23 03:08:28.945478+08	960fe308-5a95-4fbe-bf34-2f8b29e79e36	8
30	0030	dine_in	completed	47.50	0.00	1	2026-11-22 19:55:37.902936+08	2026-11-23 03:08:30.716111+08	a31e0978-d6f7-4fc1-ac4a-b9551db5ff46	8
31	0031	dine_in	completed	39.50	0.00	1	2026-11-22 19:55:46.088939+08	2026-11-23 03:08:31.419858+08	5cea0dbc-a007-41df-94a1-a4e3863a1013	8
29	0029	dine_in	completed	47.50	0.00	1	2026-11-22 19:55:28.963441+08	2026-11-23 03:08:32.37283+08	bce96c90-b631-4abe-bece-e5f5f6e846cb	8
28	0028	dine_in	completed	74.50	0.00	1	2026-11-22 19:55:19.504415+08	2026-11-23 03:08:33.109771+08	16704066-6a31-46f4-b0e2-31ba9f5c3dd1	8
27	0027	dine_in	completed	18.00	0.00	1	2026-11-22 19:55:04.106843+08	2026-11-23 03:08:34.306091+08	56ea0097-6336-498b-bc6b-af3bf337dd1d	8
25	0025	dine_in	completed	74.00	0.00	1	2026-11-22 19:54:24.686581+08	2026-11-23 03:08:35.913528+08	52d20a5a-c819-4ee3-9597-a025f1eb072d	8
26	0026	dine_in	completed	56.00	0.00	1	2026-11-22 19:54:44.399518+08	2026-11-23 03:08:36.722822+08	2142e04f-d030-4f44-b058-3ce4534fc3c8	8
24	0024	dine_in	completed	114.00	0.00	1	2026-11-22 19:53:54.199201+08	2026-11-23 03:08:37.60938+08	8c866d22-66ed-4231-b73c-6cf64b4b3184	8
23	0023	dine_in	completed	36.00	0.00	1	2026-11-22 19:53:15.711138+08	2026-11-23 03:08:39.212923+08	ed95bd4e-419e-4a37-895c-d68f42972bee	8
22	0022	dine_in	completed	61.00	0.00	1	2026-11-22 19:53:06.98181+08	2026-11-23 03:08:40.502186+08	b0d7a410-6ec4-4339-95ea-cfb3575b6483	8
21	0021	dine_in	completed	77.50	0.00	1	2026-11-22 19:52:51.580905+08	2026-11-23 03:08:41.249435+08	4b7ab6d2-bd21-45de-8585-fd30b7621c8c	8
20	0020	dine_in	completed	54.50	0.00	1	2026-11-22 19:52:36.94415+08	2026-11-23 03:08:42.154151+08	e78b02e6-5059-414e-888a-464f244b2306	8
19	0019	dine_in	completed	80.50	0.00	1	2026-11-22 19:52:27.132882+08	2026-11-23 03:08:43.058312+08	5887f078-bdf7-439a-9bf2-c6b5e90e03e1	8
18	0018	dine_in	completed	45.00	0.00	1	2026-11-22 19:51:57.528272+08	2026-11-23 03:08:44.823975+08	ceb741db-fd2b-43bf-a60b-5e0946bfecb3	8
17	0017	dine_in	completed	178.50	0.00	1	2026-11-22 19:51:10.838262+08	2026-11-23 03:08:46.076677+08	8f522d50-d556-470b-92d5-42631ba9a7b0	8
16	0016	dine_in	completed	5.50	0.00	1	2026-11-22 19:50:35.552221+08	2026-11-23 03:08:46.787283+08	5380acba-6965-4236-bde6-27728640aa19	8
15	0015	dine_in	completed	27.50	0.00	1	2026-11-22 19:50:20.987574+08	2026-11-23 03:08:47.489782+08	bf987799-20f2-4485-b9bc-6c7945830438	8
14	0014	dine_in	completed	26.50	0.00	1	2026-11-22 19:49:48.290083+08	2026-11-23 03:08:48.1828+08	7b536f4a-fabb-4fdc-af52-3992599ce15f	8
56	0056	dine_in	completed	7.00	0.00	1	2026-11-23 03:17:43.580534+08	2026-11-23 03:17:50.989613+08	db17ea17-1d8c-4095-a91d-6e99d4973c1d	9
55	0055	dine_in	completed	7.00	0.00	1	2026-11-23 03:17:25.142491+08	2026-11-23 03:17:52.455642+08	a838251b-1c20-45da-a542-d612ab6c0c1b	9
61	0060	dine_in	completed	21.00	0.00	1	2026-11-23 16:27:37.253581+08	2026-11-23 16:27:47.570877+08	2c73cd0a-f6cc-4d4d-adb1-02123cc1c750	10
58	0058	dine_in	completed	28.00	0.00	1	2026-11-23 03:21:38.011634+08	2026-11-23 16:27:50.304252+08	a03c4a4e-6eb4-428f-bfe9-c7c73417f995	9
57	0057	dine_in	completed	180.00	0.00	1	2026-11-23 03:21:16.604498+08	2026-11-23 16:27:51.632895+08	a20b1ba8-9a9c-4777-a8d0-547933da6036	9
60	0059	dine_in	completed	33.50	0.00	1	2026-11-23 03:56:04.242277+08	2026-11-23 16:27:52.553608+08	54bc9acc-fa9d-4be2-b8f0-189c9a3710f4	9
\.


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.payments (id, order_id, method, amount_due, amount_tendered, change_given, created_at) FROM stdin;
1	1	cash	7.50	50.00	42.50	2026-11-15 22:07:27.224826+08
2	2	cash	19.50	50.00	30.50	2026-11-15 22:40:24.176137+08
3	3	cash	26.50	50.00	23.50	2026-11-16 15:39:05.259838+08
4	4	cash	15.50	50.00	34.50	2026-11-17 15:43:22.546891+08
5	5	paynow	14.50	14.50	0.00	2026-11-17 15:45:27.293607+08
6	6	cash	3.50	3.50	0.00	2026-11-17 15:55:07.107969+08
7	7	cash	19.00	50.00	31.00	2026-11-17 15:55:14.7844+08
8	8	cash	19.50	50.00	30.50	2026-11-17 15:55:21.793398+08
9	9	cash	18.00	50.00	32.00	2026-11-17 15:55:37.746477+08
10	10	cash	29.00	50.00	21.00	2026-11-21 18:22:31.633174+08
11	11	cash	21.00	50.00	29.00	2026-11-22 18:57:18.384967+08
12	12	cash	18.00	18.00	0.00	2026-11-22 18:57:31.445404+08
13	13	cash	13.00	20.00	7.00	2026-11-22 18:57:48.057952+08
14	14	cash	26.50	50.00	23.50	2026-11-22 19:49:48.290083+08
15	15	paynow	27.50	27.50	0.00	2026-11-22 19:50:20.987574+08
16	16	card	5.50	5.50	0.00	2026-11-22 19:50:35.552221+08
17	17	cash	178.50	500.00	321.50	2026-11-22 19:51:10.838262+08
18	18	paynow	45.00	45.00	0.00	2026-11-22 19:51:57.528272+08
19	19	card	80.50	80.50	0.00	2026-11-22 19:52:27.132882+08
20	20	cash	54.50	54.50	0.00	2026-11-22 19:52:36.94415+08
21	21	cash	77.50	78.00	0.50	2026-11-22 19:52:51.580905+08
22	22	cash	61.00	67.00	6.00	2026-11-22 19:53:06.98181+08
23	23	paynow	36.00	36.00	0.00	2026-11-22 19:53:15.711138+08
24	24	cash	114.00	500.00	386.00	2026-11-22 19:53:54.199201+08
25	25	cash	74.00	75.00	1.00	2026-11-22 19:54:24.686581+08
26	26	cash	56.00	56.90	0.90	2026-11-22 19:54:44.399518+08
27	27	cash	18.00	100.00	82.00	2026-11-22 19:55:04.106843+08
28	28	card	74.50	74.50	0.00	2026-11-22 19:55:19.504415+08
29	29	cash	47.50	50.00	2.50	2026-11-22 19:55:28.963441+08
30	30	cash	47.50	100.00	52.50	2026-11-22 19:55:37.902936+08
31	31	cash	39.50	100.00	60.50	2026-11-22 19:55:46.088939+08
32	32	cash	60.50	70.00	9.50	2026-11-22 19:56:05.089704+08
33	33	paynow	57.50	57.50	0.00	2026-11-22 19:56:17.599879+08
34	34	cash	59.50	59.60	0.10	2026-11-22 19:56:50.485774+08
35	35	card	43.00	43.00	0.00	2026-11-22 19:57:01.737124+08
36	36	cash	47.50	100.00	52.50	2026-11-22 19:57:17.276938+08
37	37	card	12.00	12.00	0.00	2026-11-22 19:57:26.173455+08
38	38	cash	114.00	120.00	6.00	2026-11-22 19:57:46.206683+08
39	39	cash	34.00	40.00	6.00	2026-11-22 19:57:58.645979+08
40	40	cash	76.50	100.00	23.50	2026-11-22 19:58:15.335217+08
41	41	cash	94.50	99.00	4.50	2026-11-22 19:58:33.602922+08
42	42	paynow	112.00	112.00	0.00	2026-11-22 19:58:49.369936+08
43	43	cash	29.00	50.00	21.00	2026-11-22 20:11:19.391761+08
44	44	paynow	165.00	165.00	0.00	2026-11-22 20:17:08.948779+08
45	45	cash	300.00	300.00	0.00	2026-11-22 20:17:51.776302+08
46	46	paynow	90.00	90.00	0.00	2026-11-22 20:21:32.207259+08
47	47	cash	29.00	50.00	21.00	2026-11-23 00:16:52.256238+08
48	48	cash	165.00	165.00	0.00	2026-11-23 00:33:09.710179+08
49	49	paynow	165.00	165.00	0.00	2026-11-23 00:34:42.844015+08
50	50	paynow	90.00	90.00	0.00	2026-11-23 00:37:40.859829+08
51	51	cash	11.00	11.00	0.00	2026-11-23 00:51:07.230094+08
52	52	cash	11.00	11.00	0.00	2026-11-23 00:59:15.006205+08
53	53	paynow	108.00	108.00	0.00	2026-11-23 01:07:23.962705+08
54	54	cash	6.00	10.00	4.00	2026-11-23 02:25:10.388439+08
55	55	cash	7.00	10.00	3.00	2026-11-23 03:17:25.142491+08
56	56	cash	7.00	7.00	0.00	2026-11-23 03:17:43.580534+08
57	57	paynow	180.00	180.00	0.00	2026-11-23 03:21:16.604498+08
58	58	cash	28.00	50.00	22.00	2026-11-23 03:21:38.011634+08
59	60	cash	33.50	50.00	16.50	2026-11-23 03:56:04.242277+08
60	61	card	21.00	21.00	0.00	2026-11-23 16:27:37.253581+08
61	62	paynow	11.50	11.50	0.00	2026-11-25 19:30:42.227063+08
62	63	paynow	23.00	23.00	0.00	2026-11-25 19:30:50.564931+08
\.


--
-- Data for Name: recipe_ingredients; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.recipe_ingredients (id, menu_item_id, ingredient_item_id, qty_per_tray, is_optional, alt_group, alt_rank) FROM stdin;
1	107	54	2.000	f	\N	\N
2	107	55	1.000	f	\N	\N
3	107	56	1.000	f	\N	\N
4	107	37	0.250	f	\N	\N
5	107	38	0.150	f	\N	\N
6	107	1	1.500	f	\N	\N
7	107	53	0.300	f	\N	\N
8	107	98	0.015	f	\N	\N
9	107	61	0.040	f	\N	\N
10	107	60	0.100	f	\N	\N
11	107	89	0.010	f	\N	\N
12	108	2	1.500	f	\N	\N
13	108	57	0.300	f	\N	\N
14	108	58	0.200	f	\N	\N
15	108	59	0.100	f	\N	\N
16	108	60	0.100	f	\N	\N
17	108	61	0.040	f	\N	\N
18	108	35	0.250	f	\N	\N
19	108	36	0.085	f	\N	\N
20	108	31	0.060	f	\N	\N
21	108	95	0.050	f	\N	\N
22	108	92	0.005	f	\N	\N
23	108	63	0.015	t	\N	\N
24	109	3	1.500	f	\N	\N
25	109	61	0.040	f	\N	\N
26	109	60	0.100	f	\N	\N
27	109	62	0.150	f	\N	\N
28	109	63	0.020	t	\N	\N
29	109	38	0.150	f	\N	\N
30	109	34	0.045	f	\N	\N
31	109	92	0.005	f	\N	\N
32	109	29	0.045	f	\N	\N
33	110	32	0.030	f	\N	\N
34	110	17	1.200	f	\N	\N
35	110	62	0.300	f	\N	\N
36	110	60	0.150	f	\N	\N
37	110	61	0.040	f	\N	\N
38	110	20	3.000	f	\N	\N
39	110	66	0.500	f	\N	\N
40	110	89	0.010	f	\N	\N
41	110	92	0.005	f	\N	\N
42	110	29	0.100	f	\N	\N
43	111	57	0.250	f	\N	\N
44	111	58	0.200	f	\N	\N
45	111	59	0.100	f	\N	\N
46	111	84	0.100	t	\N	\N
47	111	6	1.200	f	\N	\N
48	111	61	0.040	f	\N	\N
49	111	60	0.100	f	\N	\N
50	111	62	0.150	f	\N	\N
51	111	35	0.250	f	\N	\N
52	111	31	0.045	f	\N	\N
53	111	32	0.030	f	\N	\N
54	111	89	0.005	f	\N	\N
55	111	92	0.005	f	\N	\N
56	112	31	0.045	f	\N	\N
57	112	4	1.200	f	\N	\N
58	112	60	0.250	f	\N	\N
59	112	63	0.025	f	\N	\N
60	112	65	0.100	f	\N	\N
61	112	43	0.045	f	\N	\N
62	112	40	0.100	t	\N	\N
63	112	92	0.005	f	\N	\N
64	113	92	0.005	f	\N	\N
65	113	67	0.250	f	\N	\N
66	113	53	0.250	f	\N	\N
67	113	68	0.200	f	\N	\N
68	113	54	2.000	f	\N	\N
69	113	69	0.300	f	\N	\N
70	113	62	0.150	f	\N	\N
71	113	60	0.100	f	\N	\N
72	113	61	0.040	f	\N	\N
73	113	89	0.005	f	\N	\N
74	113	3	0.500	f	\N	\N
75	113	39	0.060	f	1	1
76	113	38	0.080	f	1	2
77	114	94	0.015	f	\N	\N
78	114	70	0.300	f	\N	\N
79	114	58	0.150	f	\N	\N
80	114	71	0.200	f	\N	\N
81	114	72	0.200	f	\N	\N
82	114	59	0.100	f	\N	\N
83	114	73	0.200	f	\N	\N
84	114	18	0.250	t	\N	\N
85	114	33	0.060	f	\N	\N
86	114	31	0.030	f	\N	\N
87	114	61	0.030	f	\N	\N
88	114	60	0.100	f	\N	\N
89	114	92	0.005	f	\N	\N
90	114	5	0.500	f	1	1
91	114	16	0.500	f	1	2
92	115	5	0.500	f	\N	\N
93	115	62	0.150	f	\N	\N
94	115	32	0.045	f	\N	\N
95	115	99	0.400	f	\N	\N
96	115	60	0.100	f	\N	\N
97	115	61	0.040	f	\N	\N
98	115	89	0.010	f	\N	\N
99	115	92	0.005	f	\N	\N
100	115	74	1.000	f	1	1
101	115	75	1.000	f	1	2
102	116	61	0.050	f	\N	\N
103	116	95	0.050	f	\N	\N
104	116	3	1.500	f	\N	\N
105	116	89	0.020	f	\N	\N
106	116	92	0.010	f	\N	\N
107	116	34	0.150	f	1	1
108	116	36	0.150	f	1	2
109	117	3	1.500	f	\N	\N
110	117	44	0.500	f	\N	\N
111	117	63	0.050	f	\N	\N
112	117	61	0.040	f	\N	\N
113	117	60	0.100	f	\N	\N
114	117	38	0.100	f	\N	\N
115	117	32	0.030	f	\N	\N
116	117	92	0.005	f	\N	\N
117	118	7	0.800	f	\N	\N
118	118	8	0.400	f	\N	\N
119	118	58	0.150	f	\N	\N
120	118	59	0.100	f	\N	\N
121	118	60	0.100	f	\N	\N
122	118	61	0.040	f	\N	\N
123	118	63	0.020	f	\N	\N
124	118	34	0.060	f	\N	\N
125	118	32	0.045	f	\N	\N
126	118	95	0.050	f	\N	\N
127	118	92	0.005	f	\N	\N
128	119	45	0.250	f	\N	\N
129	119	12	1.200	f	\N	\N
130	119	83	0.300	f	\N	\N
131	119	60	0.150	f	\N	\N
132	119	61	0.040	f	\N	\N
133	119	31	0.060	f	\N	\N
134	119	33	0.060	f	\N	\N
135	119	94	0.015	f	\N	\N
136	119	92	0.005	f	\N	\N
137	120	9	0.250	f	\N	\N
138	120	57	0.250	f	\N	\N
139	120	58	0.200	f	\N	\N
140	120	59	0.100	f	\N	\N
141	120	62	0.150	f	\N	\N
142	120	61	0.040	f	\N	\N
143	120	60	0.100	f	\N	\N
144	120	35	0.250	f	\N	\N
145	120	5	1.000	f	\N	\N
146	120	31	0.060	f	\N	\N
147	120	95	0.050	f	\N	\N
148	120	92	0.005	f	\N	\N
149	121	32	0.060	f	\N	\N
150	121	3	1.500	f	\N	\N
151	121	62	0.200	f	\N	\N
152	121	60	0.150	f	\N	\N
153	121	76	0.200	f	\N	\N
154	121	77	1.000	f	\N	\N
155	121	54	1.000	f	\N	\N
156	121	53	0.200	f	\N	\N
157	121	78	0.150	t	\N	\N
158	121	89	0.010	f	\N	\N
159	121	87	0.044	f	1	1
160	121	105	2.000	f	1	2
161	122	54	3.000	f	\N	\N
162	122	69	0.500	f	\N	\N
163	122	61	0.030	f	\N	\N
164	122	60	0.100	f	\N	\N
165	122	44	0.400	f	\N	\N
166	122	32	0.030	f	\N	\N
167	122	89	0.005	f	\N	\N
168	122	63	0.015	t	\N	\N
169	122	5	0.400	f	1	1
170	122	18	0.400	t	1	2
171	123	1	1.500	f	\N	\N
172	123	61	0.050	f	\N	\N
173	123	93	0.005	f	\N	\N
174	123	60	0.100	f	\N	\N
175	123	95	0.050	f	\N	\N
176	123	31	0.090	f	\N	\N
177	123	34	0.120	f	\N	\N
178	123	91	0.060	f	\N	\N
179	124	59	0.100	f	\N	\N
180	124	57	0.300	f	\N	\N
181	124	58	0.200	f	\N	\N
182	124	61	0.040	f	\N	\N
183	124	60	0.100	f	\N	\N
184	124	35	0.250	f	\N	\N
185	124	31	0.060	f	\N	\N
186	124	43	0.030	f	\N	\N
187	124	95	0.050	f	\N	\N
188	124	92	0.005	f	\N	\N
189	124	12	1.300	f	1	1
190	124	5	1.300	f	1	2
191	125	61	0.040	f	\N	\N
192	125	31	0.090	f	\N	\N
193	125	43	0.060	f	\N	\N
194	125	92	0.005	f	\N	\N
195	125	13	1.200	f	\N	\N
196	125	60	0.250	f	\N	\N
197	126	93	0.005	f	\N	\N
198	126	79	0.050	f	\N	\N
199	126	17	1.200	f	\N	\N
200	126	61	0.040	f	\N	\N
201	126	60	0.100	f	\N	\N
202	126	53	0.200	f	\N	\N
203	126	68	0.150	f	\N	\N
204	126	64	0.030	f	\N	\N
205	126	34	0.150	f	\N	\N
206	126	89	0.010	f	1	1
207	126	32	0.030	f	1	2
208	127	13	1.200	f	\N	\N
209	127	72	0.500	f	\N	\N
210	127	61	0.040	f	\N	\N
211	127	60	0.100	f	\N	\N
212	127	33	0.075	f	\N	\N
213	127	31	0.045	f	\N	\N
214	127	94	0.015	f	\N	\N
215	127	30	0.010	t	\N	\N
216	127	92	0.005	f	\N	\N
217	128	92	0.005	f	\N	\N
218	128	57	0.300	f	\N	\N
219	128	58	0.200	f	\N	\N
220	128	59	0.100	f	\N	\N
221	128	61	0.040	f	\N	\N
222	128	60	0.100	f	\N	\N
223	128	35	0.250	f	\N	\N
224	128	95	0.050	f	\N	\N
225	128	16	1.500	f	\N	\N
226	128	32	0.030	f	1	1
227	128	31	0.045	f	1	2
228	129	60	0.100	f	\N	\N
229	129	3	1.000	f	\N	\N
230	129	10	0.300	f	\N	\N
231	129	11	0.500	f	\N	\N
232	129	61	0.040	f	\N	\N
233	129	34	0.120	f	\N	\N
234	129	32	0.045	f	\N	\N
235	129	92	0.005	f	\N	\N
236	129	64	0.025	t	\N	\N
237	130	58	0.150	f	\N	\N
238	130	60	0.100	f	\N	\N
239	130	61	0.030	f	\N	\N
240	130	66	0.500	f	\N	\N
241	130	20	1.000	f	\N	\N
242	130	102	0.500	f	\N	\N
243	130	31	0.030	f	\N	\N
244	130	6	0.800	f	\N	\N
245	130	89	0.005	f	\N	\N
246	130	92	0.005	f	\N	\N
247	130	42	0.150	f	1	1
248	130	41	0.150	f	1	2
249	131	31	0.030	f	\N	\N
250	131	70	0.300	f	\N	\N
251	131	58	0.200	f	\N	\N
252	131	80	0.250	f	\N	\N
253	131	81	0.150	f	\N	\N
254	131	60	0.100	f	\N	\N
255	131	61	0.030	f	\N	\N
256	131	102	0.350	f	\N	\N
257	131	89	0.005	f	\N	\N
258	131	92	0.005	f	\N	\N
259	131	42	0.150	f	\N	\N
260	132	80	0.300	f	\N	\N
261	132	58	0.150	f	\N	\N
262	132	66	0.500	f	\N	\N
263	132	97	0.150	f	\N	\N
264	132	94	0.050	f	\N	\N
265	132	89	0.010	f	\N	\N
266	132	92	0.005	f	\N	\N
267	132	34	0.150	f	\N	\N
268	132	69	0.250	f	1	1
269	132	82	0.250	f	1	2
270	133	53	1.000	f	\N	\N
271	133	20	6.000	f	\N	\N
272	133	29	0.150	f	\N	\N
273	133	92	0.005	f	\N	\N
274	133	89	0.010	f	\N	\N
275	133	41	0.100	t	\N	\N
276	134	97	0.200	f	\N	\N
277	134	21	30.000	f	\N	\N
278	134	94	0.050	f	\N	\N
279	134	98	0.010	f	\N	\N
280	134	89	0.010	f	\N	\N
281	134	92	0.005	f	\N	\N
282	134	34	0.200	f	1	1
283	134	42	0.200	f	1	2
284	135	58	0.150	f	\N	\N
285	135	60	0.100	f	\N	\N
286	135	61	0.030	f	\N	\N
287	135	20	3.000	f	\N	\N
288	135	104	0.050	f	\N	\N
289	135	47	0.060	f	\N	\N
290	135	19	0.200	f	\N	\N
291	135	24	0.100	t	\N	\N
292	135	31	0.030	f	\N	\N
293	135	89	0.010	f	\N	\N
294	135	92	0.005	f	\N	\N
295	135	6	1.000	f	\N	\N
296	136	92	0.010	f	\N	\N
297	136	10	1.500	f	\N	\N
298	136	89	0.020	f	\N	\N
299	136	61	0.040	f	\N	\N
300	136	95	0.050	f	\N	\N
301	136	34	0.150	f	\N	\N
302	137	89	0.010	f	\N	\N
303	137	92	0.005	f	\N	\N
304	137	100	1.000	f	\N	\N
305	137	45	2.500	f	\N	\N
306	137	70	0.250	f	\N	\N
307	137	58	0.150	f	\N	\N
308	137	61	0.040	f	\N	\N
309	137	60	0.100	f	\N	\N
310	137	66	0.500	f	\N	\N
311	137	20	5.000	t	\N	\N
312	137	96	0.050	f	\N	\N
313	137	106	0.200	f	\N	\N
314	137	14	1.000	f	1	1
315	137	15	1.000	f	1	2
316	137	31	0.045	f	2	1
317	137	32	0.045	f	2	2
318	138	93	0.010	f	\N	\N
319	138	15	2.000	f	\N	\N
320	138	85	3.000	f	\N	\N
321	138	60	0.150	f	\N	\N
322	138	32	0.060	f	\N	\N
323	138	89	0.015	f	\N	\N
324	138	65	0.100	f	\N	\N
325	138	63	0.015	f	\N	\N
326	138	70	0.300	f	1	1
327	138	55	1.000	f	1	2
328	139	22	0.120	f	\N	\N
329	139	97	0.250	f	\N	\N
330	139	20	3.000	f	\N	\N
331	139	90	0.150	f	\N	\N
332	139	46	0.005	f	\N	\N
333	139	49	0.400	f	1	1
334	139	88	0.400	f	1	2
335	139	23	0.120	f	2	1
336	139	29	0.120	f	2	2
337	139	25	0.060	f	3	1
338	139	48	0.005	f	3	2
339	140	25	1.000	f	\N	\N
340	140	50	1.000	f	\N	\N
341	140	27	2.000	f	1	1
342	140	28	2.000	f	1	2
343	140	52	0.150	t	2	1
344	140	51	0.150	t	2	2
345	141	20	10.000	f	\N	\N
346	141	25	1.000	f	\N	\N
347	141	26	1.000	f	\N	\N
348	141	90	0.150	f	\N	\N
349	141	46	0.005	t	\N	\N
350	142	86	1.000	f	\N	\N
351	142	103	2.000	f	\N	\N
352	142	28	2.000	f	\N	\N
353	142	25	1.000	f	\N	\N
354	142	46	0.005	t	\N	\N
355	143	101	0.500	f	\N	\N
356	143	90	0.030	f	\N	\N
357	143	40	0.350	f	\N	\N
358	143	25	0.150	f	\N	\N
359	143	24	0.150	f	\N	\N
360	143	47	0.060	t	\N	\N
361	143	27	1.000	f	\N	\N
362	143	89	0.005	f	\N	\N
363	143	50	0.500	f	1	1
364	143	16	0.250	f	1	2
\.


--
-- Data for Name: shop_settings; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.shop_settings (id, name, location, currency, gst_registered, gst_rate, gst_reg_no, expiry_warning_days, updated_at) FROM stdin;
1	Mamitas™ Kitchen	Singapore	GSD	f	0.0900		3	2026-11-21 19:00:55.371977+08
\.


--
-- Data for Name: stock_movements; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.stock_movements (id, item_id, batch_id, movement_type, qty, reason, order_id, user_id, created_at) FROM stdin;
1	20	1	IN	240.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
2	21	2	IN	300.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
3	22	3	IN	3.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
4	23	4	IN	1.800	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
5	24	5	IN	1.800	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
6	25	6	IN	28.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
7	26	7	IN	14.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
8	27	8	IN	14.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
9	28	9	IN	14.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
10	29	10	IN	84.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
11	30	11	IN	1.400	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
12	31	12	IN	21.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
13	32	13	IN	11.200	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
14	33	14	IN	8.400	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
15	34	15	IN	14.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
16	35	16	IN	21.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
17	36	17	IN	4.200	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
18	37	18	IN	7.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
19	38	19	IN	8.400	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
20	39	20	IN	1.400	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
21	40	21	IN	7.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
22	41	22	IN	4.200	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
23	42	23	IN	4.200	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
24	43	24	IN	5.600	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
25	44	25	IN	21.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
26	45	26	IN	42.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
27	46	27	IN	2.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
28	47	28	IN	2.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
29	48	29	IN	2.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
30	49	30	IN	2.400	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
31	50	31	IN	14.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
32	51	32	IN	2.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
33	52	33	IN	2.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
34	53	34	IN	6.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
35	54	35	IN	9.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
36	55	36	IN	6.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
37	56	37	IN	3.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
38	57	38	IN	18.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
39	58	39	IN	15.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
40	59	40	IN	4.500	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
41	60	41	IN	18.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
42	61	42	IN	9.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
43	62	43	IN	6.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
44	63	44	IN	0.900	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
45	64	45	IN	0.600	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
46	65	46	IN	6.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
47	66	47	IN	6.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
48	67	48	IN	1.500	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
49	68	49	IN	1.500	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
50	69	50	IN	6.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
51	70	51	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
52	71	52	IN	1.500	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
53	72	53	IN	3.600	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
54	73	54	IN	3.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
55	74	55	IN	3.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
56	75	56	IN	3.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
57	76	57	IN	3.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
58	77	58	IN	3.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
59	78	59	IN	3.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
60	79	60	IN	1.800	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
61	80	61	IN	2.400	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
62	81	62	IN	1.200	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
63	82	63	IN	3.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
64	83	64	IN	2.400	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
65	84	65	IN	2.800	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
66	85	66	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
67	86	67	IN	4.500	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
68	87	68	IN	2.800	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
69	88	69	IN	1.800	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
70	89	70	IN	7.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
71	90	71	IN	14.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
72	91	72	IN	2.800	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
73	92	73	IN	2.100	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
74	93	74	IN	0.700	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
75	94	75	IN	5.600	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
76	95	76	IN	2.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
77	96	77	IN	2.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
78	97	78	IN	14.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
79	98	79	IN	0.700	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
80	99	80	IN	8.400	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
81	100	81	IN	14.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
82	101	82	IN	11.200	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
83	102	83	IN	14.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
84	103	84	IN	14.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
85	104	85	IN	1.400	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
86	105	86	IN	14.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
87	106	87	IN	5.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
88	1	88	IN	7.500	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
89	2	89	IN	3.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
90	3	90	IN	7.500	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
91	4	91	IN	3.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
92	5	92	IN	6.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
93	6	93	IN	4.500	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
94	7	94	IN	1.200	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
95	8	95	IN	1.200	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
96	9	96	IN	0.900	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
97	10	97	IN	1.800	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
98	11	98	IN	1.500	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
99	12	99	IN	3.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
100	13	100	IN	3.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
101	14	101	IN	2.400	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
102	15	102	IN	4.500	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
103	16	103	IN	4.500	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
104	17	104	IN	3.600	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
105	18	105	IN	0.900	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
106	19	106	IN	2.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
107	107	107	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
108	108	108	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
109	109	109	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
110	110	110	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
111	111	111	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
112	112	112	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
113	113	113	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
114	114	114	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
115	115	115	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
116	116	116	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
117	117	117	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
118	118	118	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
119	119	119	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
120	120	120	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
121	121	121	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
122	122	122	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
123	123	123	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
124	124	124	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
125	125	125	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
126	126	126	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
127	127	127	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
128	128	128	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
129	129	129	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
130	130	130	IN	15.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
131	131	131	IN	15.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
132	132	132	IN	15.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
133	133	133	IN	15.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
134	134	134	IN	15.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
135	135	135	IN	15.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
136	136	136	IN	15.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
137	137	137	IN	10.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
138	138	138	IN	10.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
139	139	139	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
140	140	140	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
141	141	141	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
142	142	142	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
143	143	143	IN	12.000	Opening stock	\N	3	2026-11-13 12:02:53.49185+08
144	3	90	ADJUSTMENT	2.000	Recount	\N	2	2026-11-13 18:19:27.688023+08
145	28	9	ADJUSTMENT	3.000	Opening count correction	\N	2	2026-11-13 18:21:04.694043+08
146	107	107	ADJUSTMENT	-2.000	Measuring error	\N	2	2026-11-13 18:23:09.080358+08
147	140	140	USED	1.000	Order #0001	1	1	2026-11-15 22:07:27.224826+08
148	142	142	USED	1.000	Order #0001	1	1	2026-11-15 22:07:27.224826+08
149	127	144	IN	10.000	Stock in	\N	2	2026-11-15 22:14:53.318182+08
150	119	145	IN	10.000	Stock in	\N	2	2026-11-15 22:14:58.396665+08
151	117	146	IN	10.000	Stock in	\N	2	2026-11-15 22:15:01.745663+08
152	109	147	IN	10.000	Stock in	\N	2	2026-11-15 22:15:05.745796+08
153	125	148	IN	10.000	Stock in	\N	2	2026-11-15 22:15:12.497859+08
154	118	149	IN	10.000	Stock in	\N	2	2026-11-15 22:15:16.576667+08
155	128	150	IN	10.000	Stock in	\N	2	2026-11-15 22:15:21.859256+08
156	114	151	IN	10.000	Stock in	\N	2	2026-11-15 22:15:26.331181+08
157	129	152	IN	10.000	Stock in	\N	2	2026-11-15 22:15:30.01339+08
158	122	153	IN	10.000	Stock in	\N	2	2026-11-15 22:15:33.576111+08
159	111	154	IN	10.000	Stock in	\N	2	2026-11-15 22:15:37.759035+08
160	108	155	IN	10.000	Stock in	\N	2	2026-11-15 22:15:51.614376+08
161	119	145	USED	1.000	Order #0002	2	1	2026-11-15 22:40:24.176137+08
162	142	142	USED	2.000	Order #0002	2	1	2026-11-15 22:40:24.176137+08
163	80	61	SPOILED	2.400	Expired	\N	2	2026-11-16 14:55:17.719596+08
164	6	93	SPOILED	4.500	Expired	\N	2	2026-11-16 14:55:20.562957+08
165	7	94	SPOILED	1.200	Expired	\N	2	2026-11-16 14:55:23.499466+08
166	8	95	SPOILED	1.200	Expired	\N	2	2026-11-16 14:55:38.128336+08
167	9	96	SPOILED	0.900	Expired	\N	2	2026-11-16 14:55:40.994446+08
168	10	97	SPOILED	1.800	Expired	\N	2	2026-11-16 14:55:43.699762+08
169	11	98	SPOILED	1.500	Expired	\N	2	2026-11-16 14:55:45.90463+08
170	18	105	SPOILED	0.900	Expired	\N	2	2026-11-16 14:55:48.298181+08
171	107	107	SPOILED	10.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
172	108	108	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
173	108	155	SPOILED	10.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
174	109	109	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
175	109	147	SPOILED	10.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
176	110	110	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
177	111	111	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
178	111	154	SPOILED	10.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
179	112	112	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
180	113	113	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
181	114	114	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
182	114	151	SPOILED	10.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
183	115	115	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
184	116	116	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
185	117	117	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
186	117	146	SPOILED	10.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
187	118	118	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
188	118	149	SPOILED	10.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
189	119	119	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
190	119	145	SPOILED	9.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
191	120	120	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
192	121	121	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
193	122	122	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
194	122	153	SPOILED	10.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
195	123	123	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
196	124	124	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
197	125	125	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
198	125	148	SPOILED	10.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
199	126	126	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
200	127	127	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
201	127	144	SPOILED	10.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
202	128	128	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
203	128	150	SPOILED	10.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
204	129	129	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
205	129	152	SPOILED	10.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
206	130	130	SPOILED	15.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
207	131	131	SPOILED	15.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
208	132	132	SPOILED	15.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
209	133	133	SPOILED	15.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
210	134	134	SPOILED	15.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
211	135	135	SPOILED	15.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
212	136	136	SPOILED	15.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
213	137	137	SPOILED	10.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
214	138	138	SPOILED	10.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
215	139	139	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
216	140	140	SPOILED	11.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
217	141	141	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
218	142	142	SPOILED	9.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
219	143	143	SPOILED	12.000	Expired	\N	2	2026-11-16 15:33:09.798481+08
220	140	156	IN	10.000	Stock in	\N	2	2026-11-16 15:35:49.63593+08
221	141	157	IN	5.000	Stock in	\N	2	2026-11-16 15:35:56.207759+08
222	143	158	IN	10.000	Stock in	\N	2	2026-11-16 15:36:03.225596+08
223	142	159	IN	10.000	Stock in	\N	2	2026-11-16 15:36:10.575803+08
224	119	160	IN	10.000	Stock in	\N	2	2026-11-16 15:37:55.530066+08
225	119	160	USED	2.000	Order #0003	3	1	2026-11-16 15:39:05.259838+08
226	141	157	USED	1.000	Order #0003	3	1	2026-11-16 15:39:05.259838+08
227	119	160	SPOILED	8.000	Expired	\N	2	2026-11-17 15:32:57.92208+08
228	140	156	SPOILED	10.000	Expired	\N	2	2026-11-17 15:32:57.92208+08
229	141	157	SPOILED	4.000	Expired	\N	2	2026-11-17 15:32:57.92208+08
230	142	159	SPOILED	10.000	Expired	\N	2	2026-11-17 15:32:57.92208+08
231	143	158	SPOILED	10.000	Expired	\N	2	2026-11-17 15:32:57.92208+08
232	140	161	IN	5.000	Stock in	\N	2	2026-11-17 15:33:37.541339+08
233	141	162	IN	7.000	Stock in	\N	2	2026-11-17 15:33:49.422504+08
234	143	163	IN	9.000	Stock in	\N	2	2026-11-17 15:33:59.123004+08
235	142	164	IN	4.000	Stock in	\N	2	2026-11-17 15:34:10.624063+08
236	139	165	IN	6.000	Stock in	\N	2	2026-11-17 15:34:20.85787+08
237	127	166	IN	10.000	Stock in	\N	2	2026-11-17 15:34:51.204285+08
238	119	167	IN	8.000	Stock in	\N	2	2026-11-17 15:35:03.476186+08
239	117	168	IN	8.000	Stock in	\N	2	2026-11-17 15:35:28.604761+08
240	109	169	IN	9.000	Stock in	\N	2	2026-11-17 15:35:46.202072+08
241	125	170	IN	7.000	Stock in	\N	2	2026-11-17 15:35:51.478848+08
242	118	171	IN	9.000	Stock in	\N	2	2026-11-17 15:35:59.796183+08
243	140	172	IN	6.000	Stock in	\N	2	2026-11-17 15:36:16.681443+08
244	128	173	IN	9.000	Stock in	\N	2	2026-11-17 15:36:42.190929+08
245	114	174	IN	8.000	Stock in	\N	2	2026-11-17 15:36:47.819848+08
246	129	175	IN	8.000	Stock in	\N	2	2026-11-17 15:36:56.070581+08
247	122	176	IN	7.000	Stock in	\N	2	2026-11-17 15:37:02.970663+08
248	111	177	IN	8.000	Stock in	\N	2	2026-11-17 15:37:31.632185+08
249	108	178	IN	7.000	Stock in	\N	2	2026-11-17 15:37:37.130884+08
250	107	179	IN	9.000	Stock in	\N	2	2026-11-17 15:37:42.498679+08
251	116	180	IN	9.000	Stock in	\N	2	2026-11-17 15:37:56.199416+08
252	120	181	IN	7.000	Stock in	\N	2	2026-11-17 15:38:05.040491+08
253	115	182	IN	8.000	Stock in	\N	2	2026-11-17 15:38:11.974059+08
254	113	183	IN	10.000	Stock in	\N	2	2026-11-17 15:38:20.083103+08
255	126	184	IN	10.000	Stock in	\N	2	2026-11-17 15:38:25.388141+08
256	123	185	IN	8.000	Stock in	\N	2	2026-11-17 15:38:31.575025+08
257	124	186	IN	9.000	Stock in	\N	2	2026-11-17 15:38:36.958802+08
258	110	187	IN	10.000	Stock in	\N	2	2026-11-17 15:38:41.519539+08
259	121	188	IN	10.000	Stock in	\N	2	2026-11-17 15:38:46.903871+08
260	112	189	IN	9.000	Stock in	\N	2	2026-11-17 15:38:51.105456+08
261	136	190	IN	8.000	Stock in	\N	2	2026-11-17 15:38:58.152537+08
262	135	191	IN	10.000	Stock in	\N	2	2026-11-17 15:39:09.099362+08
263	134	192	IN	9.000	Stock in	\N	2	2026-11-17 15:39:12.836691+08
264	130	193	IN	8.000	Stock in	\N	2	2026-11-17 15:39:17.257697+08
265	133	194	IN	8.000	Stock in	\N	2	2026-11-17 15:39:21.31444+08
266	132	195	IN	10.000	Stock in	\N	2	2026-11-17 15:39:27.839036+08
267	131	196	IN	9.000	Stock in	\N	2	2026-11-17 15:39:31.819775+08
268	137	197	IN	8.000	Stock in	\N	2	2026-11-17 15:39:36.286125+08
269	138	198	IN	9.000	Stock in	\N	2	2026-11-17 15:39:40.950114+08
270	144	199	IN	4.000	Initial stock	\N	2	2026-11-17 15:42:11.950362+08
271	127	166	USED	1.000	Order #0004	4	1	2026-11-17 15:43:22.546891+08
272	143	163	USED	1.000	Order #0004	4	1	2026-11-17 15:43:22.546891+08
273	109	169	USED	1.000	Order #0005	5	1	2026-11-17 15:45:27.293607+08
274	143	163	USED	1.000	Order #0005	5	1	2026-11-17 15:45:27.293607+08
275	55	36	SPOILED	6.000	Expired	\N	2	2026-11-17 15:49:26.616749+08
276	74	55	SPOILED	3.000	Expired	\N	2	2026-11-17 15:49:28.828214+08
277	75	56	SPOILED	3.000	Expired	\N	2	2026-11-17 15:49:31.381272+08
278	141	162	USED	1.000	Order #0006	6	1	2026-11-17 15:55:07.107969+08
279	113	183	USED	1.000	Order #0007	7	1	2026-11-17 15:55:14.7844+08
280	124	186	USED	1.000	Order #0007	7	1	2026-11-17 15:55:14.7844+08
281	133	194	USED	1.000	Order #0008	8	1	2026-11-17 15:55:21.793398+08
282	138	198	USED	1.000	Order #0008	8	1	2026-11-17 15:55:21.793398+08
283	112	189	USED	1.000	Order #0009	9	1	2026-11-17 15:55:37.746477+08
284	130	193	USED	1.000	Order #0009	9	1	2026-11-17 15:55:37.746477+08
285	107	179	SPOILED	9.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
286	108	178	SPOILED	7.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
287	109	169	SPOILED	8.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
288	110	187	SPOILED	10.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
289	111	177	SPOILED	8.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
290	112	189	SPOILED	8.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
291	113	183	SPOILED	9.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
292	114	174	SPOILED	8.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
293	115	182	SPOILED	8.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
294	116	180	SPOILED	9.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
295	117	168	SPOILED	8.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
296	118	171	SPOILED	9.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
297	119	167	SPOILED	8.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
298	120	181	SPOILED	7.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
299	121	188	SPOILED	10.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
300	122	176	SPOILED	7.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
301	123	185	SPOILED	8.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
302	124	186	SPOILED	8.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
303	125	170	SPOILED	7.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
304	126	184	SPOILED	10.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
305	127	166	SPOILED	9.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
306	128	173	SPOILED	9.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
307	129	175	SPOILED	8.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
308	130	193	SPOILED	7.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
309	131	196	SPOILED	9.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
310	132	195	SPOILED	10.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
311	133	194	SPOILED	7.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
312	134	192	SPOILED	9.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
313	135	191	SPOILED	10.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
314	136	190	SPOILED	8.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
315	137	197	SPOILED	8.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
316	138	198	SPOILED	8.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
317	139	165	SPOILED	6.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
318	140	161	SPOILED	5.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
319	140	172	SPOILED	6.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
320	141	162	SPOILED	6.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
321	142	164	SPOILED	4.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
322	143	163	SPOILED	7.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
323	144	199	SPOILED	4.000	Expired	\N	2	2026-11-20 18:13:08.018656+08
324	94	200	IN	3.000	Stock in	\N	2	2026-11-20 18:13:56.552819+08
325	28	201	IN	6.000	New batch	\N	2	2026-11-20 18:14:34.430976+08
326	4	91	SPOILED	3.000	Expired	\N	2	2026-11-20 23:10:35.26347+08
327	145	202	IN	10.000	Initial stock	\N	2	2026-11-21 18:14:53.83135+08
328	146	203	IN	10.000	Initial stock	\N	2	2026-11-21 18:15:51.803782+08
329	107	204	IN	10.000	Stock in	\N	2	2026-11-21 18:16:10.256943+08
330	147	205	IN	5.000	Initial stock	\N	2	2026-11-21 18:17:03.123036+08
331	148	206	IN	5.000	Initial stock	\N	2	2026-11-21 18:17:41.76152+08
332	145	202	USED	3.000	Order #0010	10	1	2026-11-21 18:22:31.633174+08
333	146	203	USED	2.000	Order #0010	10	1	2026-11-21 18:22:31.633174+08
334	107	204	SPOILED	10.000	Expired	\N	2	2026-11-22 15:26:26.300409+08
335	145	202	SPOILED	7.000	Expired	\N	2	2026-11-22 15:26:26.300409+08
336	146	203	SPOILED	8.000	Expired	\N	2	2026-11-22 15:26:26.300409+08
337	147	205	SPOILED	5.000	Expired	\N	2	2026-11-22 15:26:26.300409+08
338	148	206	SPOILED	5.000	Expired	\N	2	2026-11-22 15:26:26.300409+08
339	28	207	IN	3.000	New batch	\N	2	2026-11-22 15:27:37.609923+08
340	28	9	ADJUSTMENT	-2.000	Used	\N	2	2026-11-22 15:49:36.990381+08
341	28	9	ADJUSTMENT	-5.000	Recount	\N	2	2026-11-22 16:04:44.389482+08
342	77	58	SPOILED	3.000	Expired	\N	2	2026-11-22 16:05:33.570819+08
343	13	100	SPOILED	3.000	Expired	\N	2	2026-11-22 16:05:36.237814+08
344	17	104	DAMAGED	1.000	Dropped	\N	2	2026-11-22 16:23:55.862952+08
345	16	103	SPOILED	4.500	Expired	\N	2	2026-11-22 17:54:30.477669+08
346	17	104	SPOILED	2.600	Expired	\N	2	2026-11-22 17:54:32.720531+08
347	66	47	SPOILED	6.000	Expired	\N	2	2026-11-22 17:54:34.955518+08
348	1	88	SPOILED	7.500	Expired	\N	2	2026-11-22 17:54:38.114643+08
349	2	89	SPOILED	3.000	Expired	\N	2	2026-11-22 17:54:40.392219+08
350	3	90	SPOILED	9.500	Expired	\N	2	2026-11-22 17:54:42.952415+08
351	5	92	SPOILED	6.000	Expired	\N	2	2026-11-22 17:54:51.359373+08
352	12	99	SPOILED	3.000	Expired	\N	2	2026-11-22 17:54:53.430251+08
353	14	101	SPOILED	2.400	Expired	\N	2	2026-11-22 17:54:55.398304+08
354	15	102	SPOILED	4.500	Expired	\N	2	2026-11-22 17:54:57.467341+08
355	22	3	SPOILED	3.000	Expired	\N	2	2026-11-22 17:54:59.64453+08
356	53	34	SPOILED	6.000	Expired	\N	2	2026-11-22 17:55:01.647389+08
357	54	35	SPOILED	9.000	Expired	\N	2	2026-11-22 17:55:03.741756+08
358	56	37	SPOILED	3.000	Expired	\N	2	2026-11-22 17:55:05.861367+08
359	67	48	SPOILED	1.500	Expired	\N	2	2026-11-22 17:55:07.962945+08
360	68	49	SPOILED	1.500	Expired	\N	2	2026-11-22 17:55:11.544491+08
361	72	53	SPOILED	3.600	Expired	\N	2	2026-11-22 17:55:13.759717+08
362	81	62	SPOILED	1.200	Expired	\N	2	2026-11-22 17:55:15.789686+08
363	83	64	SPOILED	2.400	Expired	\N	2	2026-11-22 17:55:17.841858+08
364	85	66	SPOILED	12.000	Expired	\N	2	2026-11-22 17:55:19.943815+08
365	86	67	SPOILED	4.500	Expired	\N	2	2026-11-22 17:55:22.207969+08
366	67	208	IN	3.000	New batch	\N	2	2026-11-22 17:55:50.016613+08
367	67	209	IN	5.000	New batch	\N	2	2026-11-22 17:56:16.134365+08
368	38	210	IN	3.000	New batch	\N	2	2026-11-22 17:56:32.345594+08
369	39	211	IN	4.000	New batch	\N	2	2026-11-22 17:56:51.396918+08
370	56	212	IN	4.000	New batch	\N	2	2026-11-22 17:57:28.382799+08
371	80	213	IN	4.000	New batch	\N	2	2026-11-22 17:58:00.631713+08
372	59	214	IN	5.000	New batch	\N	2	2026-11-22 17:58:42.676513+08
373	72	215	IN	3.000	New batch	\N	2	2026-11-22 17:59:01.581346+08
390	4	232	IN	4.000	New batch	\N	2	2026-11-22 18:05:02.246479+08
392	12	234	IN	5.000	New batch	\N	2	2026-11-22 18:05:21.419607+08
395	13	237	IN	5.000	New batch	\N	2	2026-11-22 18:05:55.087487+08
397	6	239	IN	6.000	New batch	\N	2	2026-11-22 18:06:26.811078+08
399	3	241	IN	6.000	New batch	\N	2	2026-11-22 18:06:46.249641+08
401	3	243	IN	3.000	New batch	\N	2	2026-11-22 18:07:04.926272+08
404	9	246	IN	6.000	New batch	\N	2	2026-11-22 18:07:37.031371+08
407	1	248	IN	5.000	New batch	\N	2	2026-11-22 18:08:20.41017+08
374	71	216	IN	6.000	New batch	\N	2	2026-11-22 17:59:17.880283+08
380	53	222	IN	4.000	New batch	\N	2	2026-11-22 18:01:50.005033+08
382	77	224	IN	4.000	New batch	\N	2	2026-11-22 18:02:18.292568+08
386	83	228	IN	3.000	New batch	\N	2	2026-11-22 18:03:21.865901+08
387	68	229	IN	4.000	New batch	\N	2	2026-11-22 18:03:33.509532+08
396	16	238	IN	6.000	New batch	\N	2	2026-11-22 18:06:04.780969+08
402	8	244	IN	7.000	New batch	\N	2	2026-11-22 18:07:17.194429+08
405	7	247	IN	7.000	New batch	\N	2	2026-11-22 18:07:48.158211+08
406	7	247	ADJUSTMENT	-2.000	Recount	\N	2	2026-11-22 18:08:04.224002+08
375	55	217	IN	5.000	New batch	\N	2	2026-11-22 18:00:16.696823+08
376	86	218	IN	6.000	New batch	\N	2	2026-11-22 18:00:33.795288+08
377	54	219	IN	4.000	New batch	\N	2	2026-11-22 18:00:42.624117+08
378	85	220	IN	8.000	New batch	\N	2	2026-11-22 18:01:26.92381+08
379	85	221	IN	3.000	New batch	\N	2	2026-11-22 18:01:37.667421+08
381	81	223	IN	2.000	New batch	\N	2	2026-11-22 18:02:08.886528+08
383	64	225	IN	3.000	New batch	\N	2	2026-11-22 18:02:28.0466+08
384	74	226	IN	4.000	New batch	\N	2	2026-11-22 18:02:38.792302+08
385	22	227	IN	6.000	New batch	\N	2	2026-11-22 18:03:12.811191+08
388	75	230	IN	5.000	New batch	\N	2	2026-11-22 18:03:54.036536+08
389	66	231	IN	4.000	New batch	\N	2	2026-11-22 18:04:02.150489+08
391	17	233	IN	5.000	New batch	\N	2	2026-11-22 18:05:11.477729+08
393	14	235	IN	5.000	New batch	\N	2	2026-11-22 18:05:32.809751+08
394	15	236	IN	5.000	New batch	\N	2	2026-11-22 18:05:42.184041+08
398	5	240	IN	5.000	New batch	\N	2	2026-11-22 18:06:35.777466+08
400	11	242	IN	7.000	New batch	\N	2	2026-11-22 18:06:54.345393+08
403	10	245	IN	6.000	New batch	\N	2	2026-11-22 18:07:28.631557+08
408	2	249	IN	6.000	New batch	\N	2	2026-11-22 18:08:29.466714+08
409	18	250	IN	3.000	New batch	\N	2	2026-11-22 18:08:41.409391+08
410	140	251	IN	5.000	Stock in	\N	2	2026-11-22 18:09:08.595763+08
411	141	252	IN	5.000	Stock in	\N	2	2026-11-22 18:09:14.314658+08
412	143	253	IN	6.000	Stock in	\N	2	2026-11-22 18:09:18.703063+08
413	142	254	IN	7.000	Stock in	\N	2	2026-11-22 18:09:23.625595+08
414	139	255	IN	5.000	Stock in	\N	2	2026-11-22 18:09:28.769925+08
415	127	256	IN	5.000	Stock in	\N	2	2026-11-22 18:09:34.26678+08
416	119	257	IN	5.000	Stock in	\N	2	2026-11-22 18:09:40.563927+08
417	117	258	IN	10.000	Stock in	\N	2	2026-11-22 18:09:45.900266+08
418	109	259	IN	7.000	Stock in	\N	2	2026-11-22 18:09:51.34939+08
419	125	260	IN	8.000	Stock in	\N	2	2026-11-22 18:09:57.192723+08
420	118	261	IN	5.000	Stock in	\N	2	2026-11-22 18:10:04.019683+08
421	145	262	IN	5.000	Stock in	\N	2	2026-11-22 18:10:09.886773+08
422	128	263	IN	10.000	Stock in	\N	2	2026-11-22 18:10:17.767294+08
423	149	264	IN	40.000	Initial stock	\N	2	2026-11-22 18:11:32.612879+08
424	150	265	IN	40.000	Initial stock	\N	2	2026-11-22 18:12:12.390743+08
425	114	266	IN	10.000	Stock in	\N	2	2026-11-22 18:12:26.786925+08
426	129	267	IN	10.000	Stock in	\N	2	2026-11-22 18:12:30.484675+08
427	122	268	IN	10.000	Stock in	\N	2	2026-11-22 18:12:34.950148+08
428	111	269	IN	10.000	Stock in	\N	2	2026-11-22 18:12:38.445749+08
429	108	270	IN	5.000	Stock in	\N	2	2026-11-22 18:12:56.919351+08
430	107	271	IN	5.000	Stock in	\N	2	2026-11-22 18:13:01.762046+08
431	116	272	IN	5.000	Stock in	\N	2	2026-11-22 18:13:06.295318+08
432	120	273	IN	101.000	Stock in	\N	2	2026-11-22 18:13:10.13524+08
433	120	273	ADJUSTMENT	-91.000	Mistyped	\N	2	2026-11-22 18:13:29.041939+08
434	115	274	IN	5.000	Stock in	\N	2	2026-11-22 18:13:34.946267+08
435	113	275	IN	5.000	Stock in	\N	2	2026-11-22 18:13:50.216518+08
436	136	276	IN	5.000	Stock in	\N	2	2026-11-22 18:14:14.596787+08
437	135	277	IN	5.000	Stock in	\N	2	2026-11-22 18:14:18.924295+08
438	136	278	IN	3.000	Stock in	\N	2	2026-11-22 18:14:25.714868+08
439	135	279	IN	1.000	Stock in	\N	2	2026-11-22 18:14:32.106709+08
440	134	280	IN	10.000	Stock in	\N	2	2026-11-22 18:14:39.848667+08
441	130	281	IN	15.000	Stock in	\N	2	2026-11-22 18:14:46.236861+08
442	137	282	IN	8.000	Stock in	\N	2	2026-11-22 18:14:57.282556+08
443	146	283	IN	8.000	Stock in	\N	2	2026-11-22 18:15:01.118831+08
444	138	284	IN	8.000	Stock in	\N	2	2026-11-22 18:15:05.116283+08
445	119	257	USED	1.000	Order #0011	11	1	2026-11-22 18:57:18.384967+08
446	137	282	USED	1.000	Order #0011	11	1	2026-11-22 18:57:18.384967+08
447	114	266	USED	1.000	Order #0012	12	1	2026-11-22 18:57:31.445404+08
448	128	263	USED	1.000	Order #0012	12	1	2026-11-22 18:57:31.445404+08
449	137	282	USED	1.000	Order #0013	13	1	2026-11-22 18:57:48.057952+08
450	149	264	USED	1.000	Order #0013	13	1	2026-11-22 18:57:48.057952+08
451	117	258	USED	1.000	Order #0014	14	1	2026-11-22 19:49:48.290083+08
452	127	256	USED	1.000	Order #0014	14	1	2026-11-22 19:49:48.290083+08
453	134	280	USED	1.000	Order #0014	14	1	2026-11-22 19:49:48.290083+08
454	117	258	USED	1.000	Order #0015	15	1	2026-11-22 19:50:20.987574+08
455	134	280	USED	1.000	Order #0015	15	1	2026-11-22 19:50:20.987574+08
456	136	276	USED	1.000	Order #0015	15	1	2026-11-22 19:50:20.987574+08
457	150	265	USED	1.000	Order #0015	15	1	2026-11-22 19:50:20.987574+08
458	146	283	USED	1.000	Order #0016	16	1	2026-11-22 19:50:35.552221+08
459	107	271	USED	1.000	Order #0017	17	1	2026-11-22 19:51:10.838262+08
460	108	270	USED	1.000	Order #0017	17	1	2026-11-22 19:51:10.838262+08
461	109	259	USED	1.000	Order #0017	17	1	2026-11-22 19:51:10.838262+08
462	111	269	USED	1.000	Order #0017	17	1	2026-11-22 19:51:10.838262+08
463	113	275	USED	1.000	Order #0017	17	1	2026-11-22 19:51:10.838262+08
464	114	266	USED	1.000	Order #0017	17	1	2026-11-22 19:51:10.838262+08
465	115	274	USED	1.000	Order #0017	17	1	2026-11-22 19:51:10.838262+08
466	116	272	USED	1.000	Order #0017	17	1	2026-11-22 19:51:10.838262+08
467	117	258	USED	1.000	Order #0017	17	1	2026-11-22 19:51:10.838262+08
468	118	261	USED	1.000	Order #0017	17	1	2026-11-22 19:51:10.838262+08
469	119	257	USED	1.000	Order #0017	17	1	2026-11-22 19:51:10.838262+08
470	120	273	USED	1.000	Order #0017	17	1	2026-11-22 19:51:10.838262+08
471	122	268	USED	1.000	Order #0017	17	1	2026-11-22 19:51:10.838262+08
472	125	260	USED	1.000	Order #0017	17	1	2026-11-22 19:51:10.838262+08
473	127	256	USED	1.000	Order #0017	17	1	2026-11-22 19:51:10.838262+08
474	128	263	USED	1.000	Order #0017	17	1	2026-11-22 19:51:10.838262+08
475	129	267	USED	1.000	Order #0017	17	1	2026-11-22 19:51:10.838262+08
476	145	262	USED	1.000	Order #0017	17	1	2026-11-22 19:51:10.838262+08
477	107	271	USED	2.000	Order #0018	18	1	2026-11-22 19:51:57.528272+08
478	120	273	USED	2.000	Order #0018	18	1	2026-11-22 19:51:57.528272+08
479	116	272	USED	2.000	Order #0019	19	1	2026-11-22 19:52:27.132882+08
480	119	257	USED	2.000	Order #0019	19	1	2026-11-22 19:52:27.132882+08
481	127	256	USED	3.000	Order #0019	19	1	2026-11-22 19:52:27.132882+08
482	107	271	USED	1.000	Order #0020	20	1	2026-11-22 19:52:36.94415+08
483	108	270	USED	1.000	Order #0020	20	1	2026-11-22 19:52:36.94415+08
484	122	268	USED	1.000	Order #0020	20	1	2026-11-22 19:52:36.94415+08
485	125	260	USED	1.000	Order #0020	20	1	2026-11-22 19:52:36.94415+08
486	128	263	USED	1.000	Order #0020	20	1	2026-11-22 19:52:36.94415+08
487	113	275	USED	4.000	Order #0021	21	1	2026-11-22 19:52:51.580905+08
488	115	274	USED	4.000	Order #0021	21	1	2026-11-22 19:52:51.580905+08
489	116	272	USED	1.000	Order #0021	21	1	2026-11-22 19:52:51.580905+08
490	107	271	USED	1.000	Order #0022	22	1	2026-11-22 19:53:06.98181+08
491	111	269	USED	1.000	Order #0022	22	1	2026-11-22 19:53:06.98181+08
492	116	272	USED	1.000	Order #0022	22	1	2026-11-22 19:53:06.98181+08
493	120	273	USED	1.000	Order #0022	22	1	2026-11-22 19:53:06.98181+08
494	122	268	USED	1.000	Order #0022	22	1	2026-11-22 19:53:06.98181+08
495	129	267	USED	1.000	Order #0022	22	1	2026-11-22 19:53:06.98181+08
496	108	270	USED	3.000	Order #0023	23	1	2026-11-22 19:53:15.711138+08
497	109	259	USED	1.000	Order #0024	24	1	2026-11-22 19:53:54.199201+08
498	111	269	USED	1.000	Order #0024	24	1	2026-11-22 19:53:54.199201+08
499	114	266	USED	1.000	Order #0024	24	1	2026-11-22 19:53:54.199201+08
500	117	258	USED	1.000	Order #0024	24	1	2026-11-22 19:53:54.199201+08
501	118	261	USED	1.000	Order #0024	24	1	2026-11-22 19:53:54.199201+08
502	119	257	USED	1.000	Order #0024	24	1	2026-11-22 19:53:54.199201+08
503	120	273	USED	1.000	Order #0024	24	1	2026-11-22 19:53:54.199201+08
504	122	268	USED	1.000	Order #0024	24	1	2026-11-22 19:53:54.199201+08
505	125	260	USED	1.000	Order #0024	24	1	2026-11-22 19:53:54.199201+08
506	128	263	USED	1.000	Order #0024	24	1	2026-11-22 19:53:54.199201+08
507	129	267	USED	1.000	Order #0024	24	1	2026-11-22 19:53:54.199201+08
508	145	262	USED	1.000	Order #0024	24	1	2026-11-22 19:53:54.199201+08
509	109	259	USED	1.000	Order #0025	25	1	2026-11-22 19:54:24.686581+08
510	114	266	USED	1.000	Order #0025	25	1	2026-11-22 19:54:24.686581+08
511	117	258	USED	1.000	Order #0025	25	1	2026-11-22 19:54:24.686581+08
512	118	261	USED	1.000	Order #0025	25	1	2026-11-22 19:54:24.686581+08
513	125	260	USED	1.000	Order #0025	25	1	2026-11-22 19:54:24.686581+08
514	129	267	USED	1.000	Order #0025	25	1	2026-11-22 19:54:24.686581+08
515	149	264	USED	4.000	Order #0025	25	1	2026-11-22 19:54:24.686581+08
516	111	269	USED	2.000	Order #0026	26	1	2026-11-22 19:54:44.399518+08
517	114	266	USED	1.000	Order #0026	26	1	2026-11-22 19:54:44.399518+08
518	117	258	USED	1.000	Order #0026	26	1	2026-11-22 19:54:44.399518+08
519	118	261	USED	1.000	Order #0026	26	1	2026-11-22 19:54:44.399518+08
520	128	263	USED	1.000	Order #0026	26	1	2026-11-22 19:54:44.399518+08
521	145	262	USED	3.000	Order #0027	27	1	2026-11-22 19:55:04.106843+08
522	109	259	USED	2.000	Order #0028	28	1	2026-11-22 19:55:19.504415+08
523	117	258	USED	2.000	Order #0028	28	1	2026-11-22 19:55:19.504415+08
524	118	261	USED	1.000	Order #0028	28	1	2026-11-22 19:55:19.504415+08
525	125	260	USED	2.000	Order #0028	28	1	2026-11-22 19:55:19.504415+08
526	109	259	USED	1.000	Order #0029	29	1	2026-11-22 19:55:28.963441+08
527	114	266	USED	1.000	Order #0029	29	1	2026-11-22 19:55:28.963441+08
528	117	258	USED	1.000	Order #0029	29	1	2026-11-22 19:55:28.963441+08
529	122	268	USED	1.000	Order #0029	29	1	2026-11-22 19:55:28.963441+08
530	129	267	USED	1.000	Order #0029	29	1	2026-11-22 19:55:28.963441+08
531	129	267	USED	5.000	Order #0030	30	1	2026-11-22 19:55:37.902936+08
532	111	269	USED	1.000	Order #0031	31	1	2026-11-22 19:55:46.088939+08
533	120	273	USED	1.000	Order #0031	31	1	2026-11-22 19:55:46.088939+08
534	125	260	USED	1.000	Order #0031	31	1	2026-11-22 19:55:46.088939+08
535	128	263	USED	1.000	Order #0031	31	1	2026-11-22 19:55:46.088939+08
536	109	259	USED	1.000	Order #0032	32	1	2026-11-22 19:56:05.089704+08
537	111	269	USED	1.000	Order #0032	32	1	2026-11-22 19:56:05.089704+08
538	117	258	USED	1.000	Order #0032	32	1	2026-11-22 19:56:05.089704+08
539	120	273	USED	1.000	Order #0032	32	1	2026-11-22 19:56:05.089704+08
540	125	260	USED	1.000	Order #0032	32	1	2026-11-22 19:56:05.089704+08
541	137	282	USED	1.000	Order #0032	32	1	2026-11-22 19:56:05.089704+08
542	120	273	USED	1.000	Order #0033	33	1	2026-11-22 19:56:17.599879+08
543	130	281	USED	1.000	Order #0033	33	1	2026-11-22 19:56:17.599879+08
544	134	280	USED	1.000	Order #0033	33	1	2026-11-22 19:56:17.599879+08
545	138	284	USED	1.000	Order #0033	33	1	2026-11-22 19:56:17.599879+08
546	146	283	USED	1.000	Order #0033	33	1	2026-11-22 19:56:17.599879+08
547	149	264	USED	5.000	Order #0033	33	1	2026-11-22 19:56:17.599879+08
548	111	269	USED	1.000	Order #0034	34	1	2026-11-22 19:56:50.485774+08
549	114	266	USED	1.000	Order #0034	34	1	2026-11-22 19:56:50.485774+08
550	122	268	USED	1.000	Order #0034	34	1	2026-11-22 19:56:50.485774+08
551	128	263	USED	1.000	Order #0034	34	1	2026-11-22 19:56:50.485774+08
552	135	277	USED	1.000	Order #0034	34	1	2026-11-22 19:56:50.485774+08
553	136	276	USED	1.000	Order #0034	34	1	2026-11-22 19:56:50.485774+08
554	137	282	USED	1.000	Order #0034	34	1	2026-11-22 19:56:50.485774+08
555	136	276	USED	2.000	Order #0035	35	1	2026-11-22 19:57:01.737124+08
556	137	282	USED	2.000	Order #0035	35	1	2026-11-22 19:57:01.737124+08
557	149	264	USED	2.000	Order #0035	35	1	2026-11-22 19:57:01.737124+08
558	128	263	USED	3.000	Order #0036	36	1	2026-11-22 19:57:17.276938+08
559	137	282	USED	2.000	Order #0036	36	1	2026-11-22 19:57:17.276938+08
560	135	277	USED	2.000	Order #0037	37	1	2026-11-22 19:57:26.173455+08
561	111	269	USED	2.000	Order #0038	38	1	2026-11-22 19:57:46.206683+08
562	114	266	USED	1.000	Order #0038	38	1	2026-11-22 19:57:46.206683+08
563	120	273	USED	2.000	Order #0038	38	1	2026-11-22 19:57:46.206683+08
564	122	268	USED	1.000	Order #0038	38	1	2026-11-22 19:57:46.206683+08
565	135	277	USED	2.000	Order #0038	38	1	2026-11-22 19:57:46.206683+08
566	135	279	USED	1.000	Order #0038	38	1	2026-11-22 19:57:46.206683+08
567	149	264	USED	12.000	Order #0038	38	1	2026-11-22 19:57:46.206683+08
568	114	266	USED	2.000	Order #0039	39	1	2026-11-22 19:57:58.645979+08
569	122	268	USED	2.000	Order #0039	39	1	2026-11-22 19:57:58.645979+08
570	122	268	USED	1.000	Order #0040	40	1	2026-11-22 19:58:15.335217+08
571	130	281	USED	1.000	Order #0040	40	1	2026-11-22 19:58:15.335217+08
572	134	280	USED	1.000	Order #0040	40	1	2026-11-22 19:58:15.335217+08
573	136	276	USED	1.000	Order #0040	40	1	2026-11-22 19:58:15.335217+08
574	136	278	USED	3.000	Order #0040	40	1	2026-11-22 19:58:15.335217+08
575	138	284	USED	1.000	Order #0040	40	1	2026-11-22 19:58:15.335217+08
576	146	283	USED	1.000	Order #0040	40	1	2026-11-22 19:58:15.335217+08
577	149	264	USED	1.000	Order #0040	40	1	2026-11-22 19:58:15.335217+08
578	130	281	USED	13.000	Order #0041	41	1	2026-11-22 19:58:33.602922+08
579	134	280	USED	1.000	Order #0041	41	1	2026-11-22 19:58:33.602922+08
580	146	283	USED	1.000	Order #0041	41	1	2026-11-22 19:58:33.602922+08
581	134	280	USED	5.000	Order #0042	42	1	2026-11-22 19:58:49.369936+08
582	138	284	USED	6.000	Order #0042	42	1	2026-11-22 19:58:49.369936+08
583	146	283	USED	1.000	Order #0042	42	1	2026-11-22 19:58:49.369936+08
584	145	285	IN	10.000	Stock in	\N	3	2026-11-22 20:06:03.05273+08
585	146	286	IN	5.000	Stock in	\N	3	2026-11-22 20:06:35.746679+08
586	147	287	IN	4.000	Stock in	\N	3	2026-11-22 20:06:53.112136+08
587	148	288	IN	5.000	Stock in	\N	3	2026-11-22 20:07:02.413985+08
588	145	285	USED	3.000	Order #0043	43	1	2026-11-22 20:11:19.391761+08
589	146	283	USED	2.000	Order #0043	43	1	2026-11-22 20:11:19.391761+08
590	147	287	USED	2.000	Order #0044	44	1	2026-11-22 20:17:08.948779+08
591	148	288	USED	1.000	Order #0044	44	1	2026-11-22 20:17:08.948779+08
592	147	287	USED	2.000	Order #0045	45	1	2026-11-22 20:17:51.776302+08
593	148	288	USED	4.000	Order #0045	45	1	2026-11-22 20:17:51.776302+08
594	148	289	IN	2.000	Stock in	\N	2	2026-11-22 20:19:44.709305+08
595	148	289	USED	2.000	Order #0046	46	1	2026-11-22 20:21:32.207259+08
596	127	290	IN	5.000	Stock in	\N	2	2026-11-22 23:31:42.079076+08
597	119	291	IN	6.000	Stock in	\N	2	2026-11-22 23:31:47.409112+08
598	117	292	IN	6.000	Stock in	\N	2	2026-11-22 23:31:54.387435+08
599	117	293	IN	4.000	Stock in	\N	2	2026-11-22 23:31:58.805336+08
600	109	294	IN	4.000	Stock in	\N	2	2026-11-22 23:32:04.137172+08
601	125	295	IN	6.000	Stock in	\N	2	2026-11-22 23:32:09.030648+08
602	118	296	IN	6.000	Stock in	\N	2	2026-11-22 23:32:16.118983+08
603	128	297	IN	6.000	Stock in	\N	2	2026-11-22 23:32:21.555411+08
604	114	298	IN	6.000	Stock in	\N	2	2026-11-22 23:32:27.342611+08
605	145	299	IN	13.000	Stock in	\N	2	2026-11-22 23:39:50.51853+08
606	146	300	IN	7.000	Stock in	\N	2	2026-11-22 23:40:09.488405+08
607	146	301	IN	2.000	Stock in	\N	2	2026-11-22 23:40:14.293496+08
608	147	302	IN	55.000	Stock in	\N	2	2026-11-22 23:40:33.931954+08
609	147	302	ADJUSTMENT	-50.000	Mistyped	\N	2	2026-11-22 23:40:42.738544+08
610	148	303	ADJUSTMENT	3.000	Stock count	\N	2	2026-11-22 23:40:52.668438+08
611	109	294	SPOILED	4.000	Expired	\N	2	2026-11-23 00:10:04.214433+08
612	114	298	SPOILED	6.000	Expired	\N	2	2026-11-23 00:10:04.214433+08
613	117	292	SPOILED	6.000	Expired	\N	2	2026-11-23 00:10:04.214433+08
614	117	293	SPOILED	4.000	Expired	\N	2	2026-11-23 00:10:04.214433+08
615	118	296	SPOILED	6.000	Expired	\N	2	2026-11-23 00:10:04.214433+08
616	119	291	SPOILED	6.000	Expired	\N	2	2026-11-23 00:10:04.214433+08
617	125	295	SPOILED	6.000	Expired	\N	2	2026-11-23 00:10:04.214433+08
618	127	290	SPOILED	5.000	Expired	\N	2	2026-11-23 00:10:04.214433+08
619	128	297	SPOILED	6.000	Expired	\N	2	2026-11-23 00:10:04.214433+08
620	139	255	SPOILED	5.000	Expired	\N	2	2026-11-23 00:10:04.214433+08
621	140	251	SPOILED	5.000	Expired	\N	2	2026-11-23 00:10:04.214433+08
622	141	252	SPOILED	5.000	Expired	\N	2	2026-11-23 00:10:04.214433+08
623	142	254	SPOILED	7.000	Expired	\N	2	2026-11-23 00:10:04.214433+08
624	143	253	SPOILED	6.000	Expired	\N	2	2026-11-23 00:10:04.214433+08
625	145	285	SPOILED	7.000	Expired	\N	2	2026-11-23 00:10:04.214433+08
626	145	299	SPOILED	13.000	Expired	\N	2	2026-11-23 00:10:04.214433+08
627	146	283	SPOILED	1.000	Expired	\N	2	2026-11-23 00:10:04.214433+08
628	146	286	SPOILED	5.000	Expired	\N	2	2026-11-23 00:10:04.214433+08
629	146	300	SPOILED	7.000	Expired	\N	2	2026-11-23 00:10:04.214433+08
630	146	301	SPOILED	2.000	Expired	\N	2	2026-11-23 00:10:04.214433+08
631	147	302	SPOILED	5.000	Expired	\N	2	2026-11-23 00:10:04.214433+08
632	148	303	SPOILED	3.000	Expired	\N	2	2026-11-23 00:10:04.214433+08
633	149	264	SPOILED	15.000	Expired	\N	2	2026-11-23 00:10:04.214433+08
634	150	265	SPOILED	39.000	Expired	\N	2	2026-11-23 00:10:04.214433+08
635	145	304	IN	20.000	Stock in	\N	2	2026-11-23 00:10:14.995718+08
636	146	305	IN	15.000	Stock in	\N	2	2026-11-23 00:10:25.290834+08
637	148	306	IN	3.000	Stock in	\N	2	2026-11-23 00:10:36.936097+08
638	147	307	IN	5.000	Stock in	\N	2	2026-11-23 00:10:44.033306+08
639	145	304	USED	3.000	Order #0047	47	1	2026-11-23 00:16:52.256238+08
640	146	305	USED	2.000	Order #0047	47	1	2026-11-23 00:16:52.256238+08
641	147	307	USED	2.000	Order #0048	48	1	2026-11-23 00:33:09.710179+08
642	148	306	USED	1.000	Order #0048	48	1	2026-11-23 00:33:09.710179+08
643	147	308	IN	2.000	Stock in	\N	2	2026-11-23 00:34:17.253787+08
644	148	309	IN	1.000	Stock in	\N	2	2026-11-23 00:34:22.324638+08
645	147	307	USED	2.000	Order #0049	49	1	2026-11-23 00:34:42.844015+08
646	148	306	USED	1.000	Order #0049	49	1	2026-11-23 00:34:42.844015+08
647	148	306	USED	1.000	Order #0050	50	1	2026-11-23 00:37:40.859829+08
648	148	309	USED	1.000	Order #0050	50	1	2026-11-23 00:37:40.859829+08
649	146	305	ADJUSTMENT	-11.000	Used	\N	2	2026-11-23 00:46:14.974459+08
650	146	305	USED	2.000	Order #0051	51	1	2026-11-23 00:51:07.230094+08
651	146	310	IN	2.000	Stock in	\N	2	2026-11-23 00:58:26.814065+08
652	146	310	USED	2.000	Order #0052	52	1	2026-11-23 00:59:15.006205+08
653	145	311	IN	3.000	Stock in	\N	2	2026-11-23 01:06:58.270055+08
654	145	304	USED	17.000	Order #0053	53	1	2026-11-23 01:07:23.962705+08
655	145	311	USED	1.000	Order #0053	53	1	2026-11-23 01:07:23.962705+08
656	3	312	IN	10.000	New batch	\N	2	2026-11-23 01:33:34.371075+08
657	3	312	ADJUSTMENT	-1.000	Measuring error	\N	2	2026-11-23 01:34:34.642721+08
658	145	313	IN	20.000	Stock in	\N	2	2026-11-23 01:38:28.846829+08
659	145	311	ADJUSTMENT	-2.000	Recount	\N	2	2026-11-23 01:39:21.265525+08
660	145	313	DAMAGED	2.000	Dropped	\N	2	2026-11-23 01:40:30.874222+08
661	151	314	IN	10.000	Initial stock	\N	2	2026-11-23 01:44:41.973136+08
662	17	315	IN	5.000	New batch	\N	2	2026-11-23 01:47:20.084159+08
663	17	316	IN	5.000	New batch	\N	2	2026-11-23 01:47:30.527739+08
664	17	317	IN	5.000	New batch	\N	2	2026-11-23 01:48:40.211768+08
665	17	233	SPOILED	5.000	Spoiled (smell)	\N	2	2026-11-23 01:48:58.312668+08
666	17	315	ADJUSTMENT	-5.000	Used	\N	2	2026-11-23 01:58:05.235285+08
667	17	316	ADJUSTMENT	-2.000	Used	\N	2	2026-11-23 01:58:25.454379+08
668	12	318	IN	5.000	New batch	\N	2	2026-11-23 02:00:59.216714+08
669	12	319	IN	5.000	New batch	\N	2	2026-11-23 02:01:33.990109+08
670	62	43	SPOILED	6.000	Expired	\N	2	2026-11-23 02:16:08.352899+08
671	96	320	IN	4.000	Stock in	\N	2	2026-11-23 02:21:49.190762+08
672	145	313	USED	1.000	Order #0054	54	1	2026-11-23 02:25:10.388439+08
673	145	313	ADJUSTMENT	-13.000	Recount	\N	2	2026-11-23 02:50:57.90266+08
674	145	321	IN	10.000	Stock in	\N	2	2026-11-23 03:01:06.430051+08
675	145	322	IN	11.000	Stock in	\N	2	2026-11-23 03:01:29.825978+08
676	145	313	ADJUSTMENT	-4.000	Recount	\N	2	2026-11-23 03:01:38.967055+08
677	145	321	ADJUSTMENT	-6.000	Recount	\N	2	2026-11-23 03:01:38.967055+08
678	145	321	USED	1.000	Order #0055	55	1	2026-11-23 03:17:25.142491+08
679	145	321	USED	1.000	Order #0056	56	1	2026-11-23 03:17:43.580534+08
680	147	307	USED	1.000	Order #0057	57	1	2026-11-23 03:21:16.604498+08
681	147	308	USED	2.000	Order #0057	57	1	2026-11-23 03:21:16.604498+08
682	145	321	USED	2.000	Order #0058	58	1	2026-11-23 03:21:38.011634+08
683	145	322	USED	2.000	Order #0058	58	1	2026-11-23 03:21:38.011634+08
685	127	323	IN	100.000	Stock in	\N	2	2026-11-23 03:39:12.963451+08
686	127	324	IN	100000.000	Stock in	\N	2	2026-11-23 03:39:30.819078+08
687	127	323	ADJUSTMENT	-100.000	Recount	\N	2	2026-11-23 03:39:55.733969+08
688	127	324	ADJUSTMENT	-99990.000	Recount	\N	2	2026-11-23 03:39:55.733969+08
689	119	325	IN	6.000	Stock in	\N	2	2026-11-23 03:40:35.146191+08
690	117	326	IN	6.000	Stock in	\N	2	2026-11-23 03:40:39.40231+08
691	109	327	IN	6.000	Stock in	\N	2	2026-11-23 03:40:43.528861+08
692	152	328	IN	6.000	Initial stock	\N	2	2026-11-23 03:46:21.598711+08
693	117	326	USED	1.000	Order #0059	60	1	2026-11-23 03:56:04.242277+08
694	119	325	USED	1.000	Order #0059	60	1	2026-11-23 03:56:04.242277+08
695	127	324	USED	1.000	Order #0059	60	1	2026-11-23 03:56:04.242277+08
696	109	327	USED	1.000	Order #0060	61	1	2026-11-23 16:27:37.253581+08
697	117	326	USED	1.000	Order #0060	61	1	2026-11-23 16:27:37.253581+08
698	109	327	SPOILED	5.000	Expired	\N	2	2026-11-25 07:05:51.276515+08
699	117	326	SPOILED	4.000	Expired	\N	2	2026-11-25 07:05:51.276515+08
700	119	325	SPOILED	5.000	Expired	\N	2	2026-11-25 07:05:51.276515+08
701	127	324	SPOILED	9.000	Expired	\N	2	2026-11-25 07:05:51.276515+08
702	145	322	SPOILED	9.000	Expired	\N	2	2026-11-25 07:05:51.276515+08
703	152	328	SPOILED	6.000	Expired	\N	2	2026-11-25 07:05:51.276515+08
704	1	248	USED	3.000	Cooked 2 trays of Kare-Kare (Pork Pata)	\N	2	2026-11-25 12:52:19.731501+08
705	37	18	USED	0.500	Cooked 2 trays of Kare-Kare (Pork Pata)	\N	2	2026-11-25 12:52:19.731501+08
706	38	19	USED	0.300	Cooked 2 trays of Kare-Kare (Pork Pata)	\N	2	2026-11-25 12:52:19.731501+08
707	53	222	USED	0.600	Cooked 2 trays of Kare-Kare (Pork Pata)	\N	2	2026-11-25 12:52:19.731501+08
708	54	219	USED	4.000	Cooked 2 trays of Kare-Kare (Pork Pata)	\N	2	2026-11-25 12:52:19.731501+08
709	55	217	USED	2.000	Cooked 2 trays of Kare-Kare (Pork Pata)	\N	2	2026-11-25 12:52:19.731501+08
710	56	212	USED	2.000	Cooked 2 trays of Kare-Kare (Pork Pata)	\N	2	2026-11-25 12:52:19.731501+08
711	60	41	USED	0.200	Cooked 2 trays of Kare-Kare (Pork Pata)	\N	2	2026-11-25 12:52:19.731501+08
712	61	42	USED	0.080	Cooked 2 trays of Kare-Kare (Pork Pata)	\N	2	2026-11-25 12:52:19.731501+08
713	89	70	USED	0.020	Cooked 2 trays of Kare-Kare (Pork Pata)	\N	2	2026-11-25 12:52:19.731501+08
714	98	79	USED	0.030	Cooked 2 trays of Kare-Kare (Pork Pata)	\N	2	2026-11-25 12:52:19.731501+08
715	107	329	IN	20.000	2 trays cooked (20 servings)	\N	2	2026-11-25 12:52:19.731501+08
716	13	237	USED	1.200	Cooked 1 tray of Beef Broccoli	\N	2	2026-11-25 12:53:50.293858+08
717	31	12	USED	0.045	Cooked 1 tray of Beef Broccoli	\N	2	2026-11-25 12:53:50.293858+08
718	33	14	USED	0.075	Cooked 1 tray of Beef Broccoli	\N	2	2026-11-25 12:53:50.293858+08
719	60	41	USED	0.100	Cooked 1 tray of Beef Broccoli	\N	2	2026-11-25 12:53:50.293858+08
720	61	42	USED	0.040	Cooked 1 tray of Beef Broccoli	\N	2	2026-11-25 12:53:50.293858+08
721	72	215	USED	0.500	Cooked 1 tray of Beef Broccoli	\N	2	2026-11-25 12:53:50.293858+08
722	92	73	USED	0.005	Cooked 1 tray of Beef Broccoli	\N	2	2026-11-25 12:53:50.293858+08
723	94	75	USED	0.015	Cooked 1 tray of Beef Broccoli	\N	2	2026-11-25 12:53:50.293858+08
724	127	330	IN	10.000	1 tray cooked (10 servings)	\N	2	2026-11-25 12:53:50.293858+08
725	54	331	IN	7.000	New batch	\N	2	2026-11-25 13:01:13.222921+08
726	12	234	USED	1.200	Cooked 1 tray of Beef Mushroom	\N	3	2026-11-25 13:04:44.134259+08
727	31	12	USED	0.060	Cooked 1 tray of Beef Mushroom	\N	3	2026-11-25 13:04:44.134259+08
728	33	14	USED	0.060	Cooked 1 tray of Beef Mushroom	\N	3	2026-11-25 13:04:44.134259+08
729	45	26	USED	0.250	Cooked 1 tray of Beef Mushroom	\N	3	2026-11-25 13:04:44.134259+08
730	60	41	USED	0.150	Cooked 1 tray of Beef Mushroom	\N	3	2026-11-25 13:04:44.134259+08
731	61	42	USED	0.040	Cooked 1 tray of Beef Mushroom	\N	3	2026-11-25 13:04:44.134259+08
732	83	228	USED	0.300	Cooked 1 tray of Beef Mushroom	\N	3	2026-11-25 13:04:44.134259+08
733	92	73	USED	0.005	Cooked 1 tray of Beef Mushroom	\N	3	2026-11-25 13:04:44.134259+08
734	94	75	USED	0.015	Cooked 1 tray of Beef Mushroom	\N	3	2026-11-25 13:04:44.134259+08
735	119	332	IN	10.000	1 tray cooked (10 servings)	\N	3	2026-11-25 13:04:44.134259+08
736	67	208	DAMAGED	0.500	Rotten	\N	3	2026-11-25 13:05:32.980687+08
737	1	248	USED	1.500	Cooked 1 tray of Kare-Kare (Pork Pata)	\N	2	2026-11-25 15:39:04.788842+08
738	37	18	USED	0.250	Cooked 1 tray of Kare-Kare (Pork Pata)	\N	2	2026-11-25 15:39:04.788842+08
739	38	19	USED	0.150	Cooked 1 tray of Kare-Kare (Pork Pata)	\N	2	2026-11-25 15:39:04.788842+08
740	53	222	USED	0.300	Cooked 1 tray of Kare-Kare (Pork Pata)	\N	2	2026-11-25 15:39:04.788842+08
741	54	331	USED	2.000	Cooked 1 tray of Kare-Kare (Pork Pata)	\N	2	2026-11-25 15:39:04.788842+08
742	55	217	USED	1.000	Cooked 1 tray of Kare-Kare (Pork Pata)	\N	2	2026-11-25 15:39:04.788842+08
743	56	212	USED	1.000	Cooked 1 tray of Kare-Kare (Pork Pata)	\N	2	2026-11-25 15:39:04.788842+08
744	60	41	USED	0.100	Cooked 1 tray of Kare-Kare (Pork Pata)	\N	2	2026-11-25 15:39:04.788842+08
745	61	42	USED	0.040	Cooked 1 tray of Kare-Kare (Pork Pata)	\N	2	2026-11-25 15:39:04.788842+08
746	89	70	USED	0.010	Cooked 1 tray of Kare-Kare (Pork Pata)	\N	2	2026-11-25 15:39:04.788842+08
747	98	79	USED	0.015	Cooked 1 tray of Kare-Kare (Pork Pata)	\N	2	2026-11-25 15:39:04.788842+08
748	107	333	IN	10.000	1 tray cooked (10 servings)	\N	2	2026-11-25 15:39:04.788842+08
749	127	330	USED	1.000	Order #0061	62	1	2026-11-25 19:30:42.227063+08
750	119	332	USED	1.000	Order #0062	63	1	2026-11-25 19:30:50.564931+08
751	127	330	USED	1.000	Order #0062	63	1	2026-11-25 19:30:50.564931+08
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, username, password_hash, full_name, role, is_active, failed_logins, locked_until, last_login_at, created_at, must_change_password, session_version) FROM stdin;
4	smoke_cashier	$2b$12$SmacWWcQ05RoSKiFIBKOx.a.FXPqP0rr5VPOzBkBbA9igFo4URbk2	Smoke test cashier	cashier	f	0	\N	2026-11-07 15:29:15.364017+08	2026-11-07 15:24:52.610861+08	t	3
3	owner	$2b$12$olcnONLXwQot/Xf.zdYIc.yr21WVZykmykM4yI/bdCo9LKqFbbWIK	Owner	owner	t	0	\N	2026-11-25 15:40:59.702153+08	2026-11-06 17:01:30.766545+08	f	1
2	kitchen	$2b$12$gvLc7lrpFnu5gIfcui34z.jBcKbNaWWYFdctY7HVWlwThi9ydGEOq	Kitchen Staff	kitchen	t	0	\N	2026-11-25 19:31:00.974745+08	2026-11-06 17:01:30.766545+08	f	3
1	cashier	$2b$12$816ZpG/rRLRt5LT2RmrSY.CKCb6w14so4zRX2uCQUps/cXqeU5mEG	Cashier	cashier	t	0	\N	2026-11-25 19:33:28.235773+08	2026-11-06 17:01:30.766545+08	f	3
5	smoke_owner	$2b$04$2KLBoN7mhS1FCGd6Zp0UTe7srfREY/hszn6PfXqe9IP1AL25Cbzdu	Smoke test owner	owner	f	0	\N	2026-11-07 15:29:15.256648+08	2026-11-07 15:24:52.618395+08	f	1
6	smoke_kitchen	$2b$04$ELNY6GtDUjyOGnzjIG/PIuTsyi3l5KYDW/ZjfR6kZNFf4DdemysTK	Smoke test kitchen	kitchen	f	0	\N	\N	2026-11-13 18:05:35.696458+08	f	1
\.


--
-- Name: audit_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.audit_log_id_seq', 873, true);


--
-- Name: batch_code_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.batch_code_seq', 333, true);


--
-- Name: cashier_sessions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.cashier_sessions_id_seq', 12, true);


--
-- Name: categories_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.categories_id_seq', 8, true);


--
-- Name: inventory_batches_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.inventory_batches_id_seq', 333, true);


--
-- Name: items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.items_id_seq', 152, true);


--
-- Name: order_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.order_items_id_seq', 187, true);


--
-- Name: orders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.orders_id_seq', 63, true);


--
-- Name: payments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.payments_id_seq', 62, true);


--
-- Name: recipe_ingredients_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.recipe_ingredients_id_seq', 364, true);


--
-- Name: stock_movements_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.stock_movements_id_seq', 751, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.users_id_seq', 6, true);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: inventory_batches batches_id_item_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_batches
    ADD CONSTRAINT batches_id_item_key UNIQUE (id, item_id);


--
-- Name: cashier_sessions cashier_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cashier_sessions
    ADD CONSTRAINT cashier_sessions_pkey PRIMARY KEY (id);


--
-- Name: categories categories_id_kind_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_id_kind_key UNIQUE (id, kind);


--
-- Name: categories categories_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_name_key UNIQUE (name);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: counters counters_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.counters
    ADD CONSTRAINT counters_pkey PRIMARY KEY (name);


--
-- Name: inventory_batches inventory_batches_batch_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_batches
    ADD CONSTRAINT inventory_batches_batch_code_key UNIQUE (batch_code);


--
-- Name: inventory_batches inventory_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_batches
    ADD CONSTRAINT inventory_batches_pkey PRIMARY KEY (id);


--
-- Name: items items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_one_line_per_item; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_one_line_per_item UNIQUE (order_id, item_id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: orders orders_order_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_order_number_key UNIQUE (order_number);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: payments payments_order_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_order_id_key UNIQUE (order_id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: recipe_ingredients recipe_alt_rank_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recipe_ingredients
    ADD CONSTRAINT recipe_alt_rank_unique UNIQUE (menu_item_id, alt_group, alt_rank);


--
-- Name: recipe_ingredients recipe_ingredients_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recipe_ingredients
    ADD CONSTRAINT recipe_ingredients_pkey PRIMARY KEY (id);


--
-- Name: recipe_ingredients recipe_one_line_per_ingredient; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recipe_ingredients
    ADD CONSTRAINT recipe_one_line_per_ingredient UNIQUE (menu_item_id, ingredient_item_id);


--
-- Name: shop_settings shop_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shop_settings
    ADD CONSTRAINT shop_settings_pkey PRIMARY KEY (id);


--
-- Name: stock_movements stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: audit_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX audit_created_idx ON public.audit_log USING btree (created_at DESC);


--
-- Name: audit_user_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX audit_user_idx ON public.audit_log USING btree (user_id);


--
-- Name: batches_expiry_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX batches_expiry_idx ON public.inventory_batches USING btree (expiry_date) WHERE ((expiry_date IS NOT NULL) AND (qty_remaining > (0)::numeric));


--
-- Name: batches_fifo_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX batches_fifo_idx ON public.inventory_batches USING btree (item_id, received_date, id) WHERE (qty_remaining > (0)::numeric);


--
-- Name: items_name_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX items_name_unique ON public.items USING btree (lower(name));


--
-- Name: movements_batch_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX movements_batch_idx ON public.stock_movements USING btree (batch_id);


--
-- Name: movements_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX movements_created_idx ON public.stock_movements USING btree (created_at DESC);


--
-- Name: movements_item_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX movements_item_idx ON public.stock_movements USING btree (item_id, created_at DESC);


--
-- Name: order_items_item_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX order_items_item_idx ON public.order_items USING btree (item_id);


--
-- Name: order_items_order_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX order_items_order_idx ON public.order_items USING btree (order_id);


--
-- Name: orders_client_request_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX orders_client_request_key ON public.orders USING btree (client_request_id) WHERE (client_request_id IS NOT NULL);


--
-- Name: orders_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX orders_created_idx ON public.orders USING btree (created_at DESC);


--
-- Name: orders_session_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX orders_session_idx ON public.orders USING btree (session_id);


--
-- Name: orders_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX orders_status_idx ON public.orders USING btree (status);


--
-- Name: sessions_one_open_per_cashier; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX sessions_one_open_per_cashier ON public.cashier_sessions USING btree (cashier_id) WHERE (closed_at IS NULL);


--
-- Name: sessions_opened_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sessions_opened_idx ON public.cashier_sessions USING btree (opened_at DESC);


--
-- Name: users_username_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX users_username_unique ON public.users USING btree (lower(username));


--
-- Name: v_item_stock _RETURN; Type: RULE; Schema: public; Owner: postgres
--

CREATE OR REPLACE VIEW public.v_item_stock AS
 SELECT i.id AS item_id,
    i.name,
    i.item_type,
    c.name AS category,
    i.unit,
    i.min_level,
    i.price,
    i.has_expiry,
    COALESCE(sum(b.qty_remaining), (0)::numeric) AS qty_on_hand,
    COALESCE(sum(b.qty_remaining) FILTER (WHERE ((b.expiry_date IS NULL) OR (b.expiry_date >= CURRENT_DATE))), (0)::numeric) AS qty_usable,
    count(b.id) FILTER (WHERE (b.qty_remaining > (0)::numeric)) AS open_batches,
    min(b.expiry_date) FILTER (WHERE ((b.qty_remaining > (0)::numeric) AND (b.expiry_date IS NOT NULL))) AS next_expiry,
    i.servings_per_tray
   FROM ((public.items i
     JOIN public.categories c ON ((c.id = i.category_id)))
     LEFT JOIN public.inventory_batches b ON ((b.item_id = i.id)))
  WHERE i.is_active
  GROUP BY i.id, c.name;


--
-- Name: v_session_summary _RETURN; Type: RULE; Schema: public; Owner: postgres
--

CREATE OR REPLACE VIEW public.v_session_summary AS
 SELECT s.id AS session_id,
    s.cashier_id,
    u.full_name AS cashier,
    s.opened_at,
    ((s.opened_at AT TIME ZONE 'Asia/Singapore'::text))::date AS opened_date,
    s.opening_cash,
    s.closed_at,
    s.expected_cash,
    s.counted_cash,
    s.cash_difference,
    s.close_note,
    count(o.id) AS orders,
    COALESCE(sum(o.total), (0)::numeric) AS net_sales,
    COALESCE(sum(o.total) FILTER (WHERE (p.method = 'cash'::public.payment_method)), (0)::numeric) AS cash_sales,
    COALESCE(sum(o.total) FILTER (WHERE (p.method = 'paynow'::public.payment_method)), (0)::numeric) AS paynow_sales,
    COALESCE(sum(o.total) FILTER (WHERE (p.method = 'card'::public.payment_method)), (0)::numeric) AS card_sales,
    (s.opening_cash + COALESCE(sum(o.total) FILTER (WHERE (p.method = 'cash'::public.payment_method)), (0)::numeric)) AS expected_now
   FROM (((public.cashier_sessions s
     JOIN public.users u ON ((u.id = s.cashier_id)))
     LEFT JOIN public.orders o ON ((o.session_id = s.id)))
     LEFT JOIN public.payments p ON ((p.order_id = o.id)))
  GROUP BY s.id, u.full_name;


--
-- Name: audit_log audit_log_append_only; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER audit_log_append_only BEFORE DELETE OR UPDATE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.fn_block_changes();


--
-- Name: inventory_batches batches_rules; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER batches_rules BEFORE INSERT OR UPDATE OF item_id, qty_received, qty_remaining, received_date, expiry_date ON public.inventory_batches FOR EACH ROW EXECUTE FUNCTION public.fn_check_batch_rules();


--
-- Name: orders orders_require_session; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER orders_require_session BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.fn_require_session();


--
-- Name: recipe_ingredients recipe_rules; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER recipe_rules BEFORE INSERT OR UPDATE OF menu_item_id, ingredient_item_id ON public.recipe_ingredients FOR EACH ROW EXECUTE FUNCTION public.fn_check_recipe_rules();


--
-- Name: stock_movements stock_movements_append_only; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER stock_movements_append_only BEFORE DELETE OR UPDATE ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION public.fn_block_changes();


--
-- Name: audit_log audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: cashier_sessions cashier_sessions_cashier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cashier_sessions
    ADD CONSTRAINT cashier_sessions_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES public.users(id);


--
-- Name: inventory_batches inventory_batches_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_batches
    ADD CONSTRAINT inventory_batches_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: inventory_batches inventory_batches_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_batches
    ADD CONSTRAINT inventory_batches_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: items items_category_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_category_fk FOREIGN KEY (category_id, item_type) REFERENCES public.categories(id, kind);


--
-- Name: order_items order_items_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: orders orders_cashier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES public.users(id);


--
-- Name: orders orders_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.cashier_sessions(id);


--
-- Name: payments payments_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: recipe_ingredients recipe_ingredients_ingredient_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recipe_ingredients
    ADD CONSTRAINT recipe_ingredients_ingredient_item_id_fkey FOREIGN KEY (ingredient_item_id) REFERENCES public.items(id);


--
-- Name: recipe_ingredients recipe_ingredients_menu_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recipe_ingredients
    ADD CONSTRAINT recipe_ingredients_menu_item_id_fkey FOREIGN KEY (menu_item_id) REFERENCES public.items(id);


--
-- Name: stock_movements stock_movements_batch_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_batch_fk FOREIGN KEY (batch_id, item_id) REFERENCES public.inventory_batches(id, item_id);


--
-- Name: stock_movements stock_movements_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: stock_movements stock_movements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO mk_app;


--
-- Name: FUNCTION fn_add_menu_trays(p_item_id integer, p_trays integer, p_user_id integer, p_reason text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fn_add_menu_trays(p_item_id integer, p_trays integer, p_user_id integer, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fn_add_menu_trays(p_item_id integer, p_trays integer, p_user_id integer, p_reason text) TO mk_app;


--
-- Name: FUNCTION fn_consume_stock(p_item_id integer, p_qty numeric, p_order_id integer, p_user_id integer, p_reason text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fn_consume_stock(p_item_id integer, p_qty numeric, p_order_id integer, p_user_id integer, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fn_consume_stock(p_item_id integer, p_qty numeric, p_order_id integer, p_user_id integer, p_reason text) TO mk_app;


--
-- Name: FUNCTION fn_next_order_number(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fn_next_order_number() FROM PUBLIC;
GRANT ALL ON FUNCTION public.fn_next_order_number() TO mk_app;


--
-- Name: TABLE audit_log; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.audit_log TO mk_app;


--
-- Name: SEQUENCE audit_log_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,USAGE ON SEQUENCE public.audit_log_id_seq TO mk_app;


--
-- Name: SEQUENCE batch_code_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,USAGE ON SEQUENCE public.batch_code_seq TO mk_app;


--
-- Name: TABLE cashier_sessions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.cashier_sessions TO mk_app;


--
-- Name: SEQUENCE cashier_sessions_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,USAGE ON SEQUENCE public.cashier_sessions_id_seq TO mk_app;


--
-- Name: TABLE categories; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.categories TO mk_app;


--
-- Name: SEQUENCE categories_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,USAGE ON SEQUENCE public.categories_id_seq TO mk_app;


--
-- Name: TABLE counters; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,UPDATE ON TABLE public.counters TO mk_app;


--
-- Name: TABLE inventory_batches; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.inventory_batches TO mk_app;


--
-- Name: SEQUENCE inventory_batches_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,USAGE ON SEQUENCE public.inventory_batches_id_seq TO mk_app;


--
-- Name: TABLE items; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.items TO mk_app;


--
-- Name: SEQUENCE items_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,USAGE ON SEQUENCE public.items_id_seq TO mk_app;


--
-- Name: TABLE order_items; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.order_items TO mk_app;


--
-- Name: SEQUENCE order_items_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,USAGE ON SEQUENCE public.order_items_id_seq TO mk_app;


--
-- Name: TABLE orders; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.orders TO mk_app;


--
-- Name: SEQUENCE orders_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,USAGE ON SEQUENCE public.orders_id_seq TO mk_app;


--
-- Name: TABLE payments; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.payments TO mk_app;


--
-- Name: SEQUENCE payments_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,USAGE ON SEQUENCE public.payments_id_seq TO mk_app;


--
-- Name: TABLE recipe_ingredients; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.recipe_ingredients TO mk_app;


--
-- Name: TABLE shop_settings; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.shop_settings TO mk_app;


--
-- Name: TABLE stock_movements; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.stock_movements TO mk_app;


--
-- Name: SEQUENCE stock_movements_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,USAGE ON SEQUENCE public.stock_movements_id_seq TO mk_app;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.users TO mk_app;


--
-- Name: SEQUENCE users_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,USAGE ON SEQUENCE public.users_id_seq TO mk_app;


--
-- Name: TABLE v_batch_status; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.v_batch_status TO mk_app;


--
-- Name: TABLE v_daily_sales; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.v_daily_sales TO mk_app;


--
-- Name: TABLE v_item_sales; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.v_item_sales TO mk_app;


--
-- Name: TABLE v_item_stock; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.v_item_stock TO mk_app;


--
-- Name: TABLE v_session_summary; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.v_session_summary TO mk_app;


--
-- PostgreSQL database dump complete
--

\unrestrict cyD1p8kYqpCLI5kjDwbQuzqnCl4muPvu9cNj9cRiMQy7Sg3Q80sNYUTN0QeIGrC

