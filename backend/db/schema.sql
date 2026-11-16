--
-- PostgreSQL database dump
--

\restrict bhplHDasgYHUYYoaWlspjtHGZRGefJS3paitMjD9BBsThywaE5aMIWHyKwdcvpH

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
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS '';


--
-- Name: audit_log_block_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_log_block_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% blocked)', TG_OP;
END
$$;


--
-- Name: bills_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bills_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.status = 'final' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'final bill % cannot be deleted', OLD.bill_no;
    END IF;
    IF (to_jsonb(NEW) - 'paid_paise' - 'pdf_path') IS DISTINCT FROM
       (to_jsonb(OLD) - 'paid_paise' - 'pdf_path') THEN
      RAISE EXCEPTION 'final bill % is locked', OLD.bill_no;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;


--
-- Name: collections_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.collections_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'milk entries are never deleted; void them through a correction';
  END IF;
  IF TG_OP = 'UPDATE' AND is_date_finalized(OLD.center_id, OLD.date) THEN
    RAISE EXCEPTION 'entry % is in a finalized bill cycle and cannot be changed', OLD.id;
  END IF;
  IF is_date_finalized(NEW.center_id, NEW.date) THEN
    RAISE EXCEPTION 'date % is in a finalized bill cycle', NEW.date;
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: feed_moves_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.feed_moves_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'feed moves are never deleted; add an adjust move instead';
  END IF;
  IF OLD.bill_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM bills b WHERE b.id = OLD.bill_id AND b.status = 'final') THEN
    RAISE EXCEPTION 'feed sale % is on a final bill and cannot be changed', OLD.id;
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: is_date_finalized(text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_date_finalized(p_center text, p_date date) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM bill_cycles bc
    WHERE bc.center_id = p_center
      AND p_date BETWEEN bc.start_date AND bc.end_date
      AND bc.status = 'finalized'
  );
$$;


--
-- Name: payments_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payments_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments are never deleted; void and re-enter instead';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM bills b
                   WHERE b.id = NEW.bill_id AND b.status = 'final'
                     AND b.farmer_id = NEW.farmer_id AND b.center_id = NEW.center_id) THEN
      RAISE EXCEPTION 'payment must be for a final bill of the same farmer';
    END IF;
  ELSIF (to_jsonb(NEW) - 'void' - 'void_reason') IS DISTINCT FROM
        (to_jsonb(OLD) - 'void' - 'void_reason')
        OR (OLD.void AND NOT NEW.void) THEN
    RAISE EXCEPTION 'payment % can only be voided, not edited', OLD.id;
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: payments_sync_bill(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payments_sync_bill() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE bills b
     SET paid_paise = COALESCE((SELECT SUM(p.amount_paise) FROM payments p
                                WHERE p.bill_id = b.id AND NOT p.void), 0)
   WHERE b.id = NEW.bill_id;
  RETURN NULL;
END
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: advance_recoveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.advance_recoveries (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    center_id text NOT NULL,
    bill_id text NOT NULL,
    advance_id text NOT NULL,
    amount_paise bigint NOT NULL,
    CONSTRAINT advance_recoveries_amount_paise_check CHECK ((amount_paise > 0))
);


--
-- Name: advances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.advances (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    center_id text NOT NULL,
    farmer_id text NOT NULL,
    date date NOT NULL,
    amount_paise bigint NOT NULL,
    installment_paise bigint NOT NULL,
    mode text DEFAULT 'cash'::text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text NOT NULL,
    CONSTRAINT advances_amount_paise_check CHECK ((amount_paise > 0)),
    CONSTRAINT advances_check CHECK (((installment_paise >= 1) AND (installment_paise <= amount_paise))),
    CONSTRAINT advances_mode_check CHECK ((mode = ANY (ARRAY['cash'::text, 'upi'::text])))
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    center_id text NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    user_id text,
    farmer_id text,
    action text NOT NULL,
    entity text NOT NULL,
    entity_id text,
    before_json jsonb,
    after_json jsonb,
    ip inet
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
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
-- Name: bill_cycles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_cycles (
    id text NOT NULL,
    center_id text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    bill_count integer DEFAULT 0 NOT NULL,
    stale boolean DEFAULT false NOT NULL,
    generated_at timestamp with time zone,
    finalized_at timestamp with time zone,
    finalized_by text,
    CONSTRAINT bill_cycles_bill_count_check CHECK ((bill_count >= 0)),
    CONSTRAINT bill_cycles_check CHECK ((end_date >= start_date)),
    CONSTRAINT bill_cycles_check1 CHECK (((status <> 'finalized'::text) OR ((finalized_at IS NOT NULL) AND (finalized_by IS NOT NULL)))),
    CONSTRAINT bill_cycles_status_check CHECK ((status = ANY (ARRAY['open'::text, 'generated'::text, 'finalized'::text])))
);


--
-- Name: bills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bills (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    center_id text NOT NULL,
    cycle_id text NOT NULL,
    farmer_id text NOT NULL,
    bill_no text NOT NULL,
    bill_date date NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    litres_x100 integer NOT NULL,
    avg_fat_x100 integer NOT NULL,
    avg_snf_x100 integer NOT NULL,
    avg_rate_paise bigint NOT NULL,
    gross_paise bigint NOT NULL,
    feed_paise bigint DEFAULT 0 NOT NULL,
    advance_paise bigint DEFAULT 0 NOT NULL,
    previous_dues_paise bigint DEFAULT 0 NOT NULL,
    total_deduct_paise bigint NOT NULL,
    net_paise bigint NOT NULL,
    payable_paise bigint NOT NULL,
    carry_forward_dues_paise bigint DEFAULT 0 NOT NULL,
    advance_remaining_paise bigint DEFAULT 0 NOT NULL,
    paid_paise bigint DEFAULT 0 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    token text NOT NULL,
    pdf_path text,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bills_advance_paise_check CHECK ((advance_paise >= 0)),
    CONSTRAINT bills_advance_remaining_paise_check CHECK ((advance_remaining_paise >= 0)),
    CONSTRAINT bills_check CHECK ((end_date >= start_date)),
    CONSTRAINT bills_check1 CHECK ((total_deduct_paise = ((feed_paise + advance_paise) + previous_dues_paise))),
    CONSTRAINT bills_check2 CHECK ((net_paise = (gross_paise - total_deduct_paise))),
    CONSTRAINT bills_check3 CHECK ((payable_paise = GREATEST(net_paise, (0)::bigint))),
    CONSTRAINT bills_check4 CHECK ((carry_forward_dues_paise = GREATEST((- net_paise), (0)::bigint))),
    CONSTRAINT bills_check5 CHECK (((paid_paise >= 0) AND (paid_paise <= payable_paise))),
    CONSTRAINT bills_feed_paise_check CHECK ((feed_paise >= 0)),
    CONSTRAINT bills_gross_paise_check CHECK ((gross_paise >= 0)),
    CONSTRAINT bills_litres_x100_check CHECK ((litres_x100 >= 0)),
    CONSTRAINT bills_previous_dues_paise_check CHECK ((previous_dues_paise >= 0)),
    CONSTRAINT bills_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'final'::text])))
);


--
-- Name: centers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.centers (
    id text NOT NULL,
    name text NOT NULL,
    name_en text,
    address text NOT NULL,
    mobile text NOT NULL,
    dairy_name text DEFAULT ''::text NOT NULL,
    cycle_days integer DEFAULT 10 NOT NULL,
    cycle_anchor date NOT NULL,
    rate_rule text DEFAULT 'nearest-lower'::text NOT NULL,
    daily_summary_time time without time zone DEFAULT '20:30:00'::time without time zone NOT NULL,
    sms_cap integer DEFAULT 95 NOT NULL,
    marathi_digits_on_bill boolean DEFAULT false NOT NULL,
    public_base_url text DEFAULT ''::text NOT NULL,
    morning_from time without time zone DEFAULT '07:00:00'::time without time zone NOT NULL,
    morning_to time without time zone DEFAULT '10:00:00'::time without time zone NOT NULL,
    evening_from time without time zone DEFAULT '18:00:00'::time without time zone NOT NULL,
    evening_to time without time zone DEFAULT '21:00:00'::time without time zone NOT NULL,
    owner_name text DEFAULT ''::text NOT NULL,
    owner_title text DEFAULT ''::text NOT NULL,
    owner_message text DEFAULT ''::text NOT NULL,
    owner_photo_path text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT centers_check CHECK ((morning_from < morning_to)),
    CONSTRAINT centers_check1 CHECK ((evening_from < evening_to)),
    CONSTRAINT centers_cycle_days_check CHECK ((cycle_days = ANY (ARRAY[7, 10]))),
    CONSTRAINT centers_mobile_check CHECK ((mobile ~ '^[6-9][0-9]{9}$'::text)),
    CONSTRAINT centers_rate_rule_check CHECK ((rate_rule = ANY (ARRAY['exact'::text, 'nearest-lower'::text, 'nearest'::text]))),
    CONSTRAINT centers_sms_cap_check CHECK (((sms_cap >= 0) AND (sms_cap <= 100)))
);


--
-- Name: TABLE centers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.centers IS 'Collection center and its settings. Secrets live only in .env.';


--
-- Name: collections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collections (
    id text NOT NULL,
    center_id text NOT NULL,
    farmer_id text NOT NULL,
    date date NOT NULL,
    shift text NOT NULL,
    milk_type text NOT NULL,
    litres_x100 integer NOT NULL,
    fat_x10 integer NOT NULL,
    snf_x10 integer NOT NULL,
    chart_id text NOT NULL,
    rate_paise bigint NOT NULL,
    amount_paise bigint NOT NULL,
    void boolean DEFAULT false NOT NULL,
    bill_id text,
    repriced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text NOT NULL,
    device_id text,
    CONSTRAINT collections_amount_paise_check CHECK ((amount_paise >= 0)),
    CONSTRAINT collections_fat_x10_check CHECK ((fat_x10 > 0)),
    CONSTRAINT collections_litres_x100_check CHECK ((litres_x100 > 0)),
    CONSTRAINT collections_milk_type_check CHECK ((milk_type = ANY (ARRAY['cow'::text, 'buffalo'::text]))),
    CONSTRAINT collections_rate_paise_check CHECK ((rate_paise > 0)),
    CONSTRAINT collections_shift_check CHECK ((shift = ANY (ARRAY['morning'::text, 'evening'::text]))),
    CONSTRAINT collections_snf_x10_check CHECK ((snf_x10 > 0))
);


--
-- Name: corrections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corrections (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    center_id text NOT NULL,
    collection_id text NOT NULL,
    reason text NOT NULL,
    before_json jsonb NOT NULL,
    after_json jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    requested_by text NOT NULL,
    decided_at timestamp with time zone,
    decided_by text,
    CONSTRAINT corrections_check CHECK (((status = 'pending'::text) = (decided_at IS NULL))),
    CONSTRAINT corrections_reason_check CHECK ((btrim(reason) <> ''::text)),
    CONSTRAINT corrections_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: dispatches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispatches (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    center_id text NOT NULL,
    date date NOT NULL,
    shift text NOT NULL,
    milk_type text NOT NULL,
    litres_x100 integer NOT NULL,
    fat_x10 integer NOT NULL,
    snf_x10 integer NOT NULL,
    rate_paise bigint NOT NULL,
    amount_paise bigint NOT NULL,
    dairy_name text DEFAULT ''::text NOT NULL,
    slip_no text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text NOT NULL,
    CONSTRAINT dispatches_amount_paise_check CHECK ((amount_paise >= 0)),
    CONSTRAINT dispatches_fat_x10_check CHECK ((fat_x10 > 0)),
    CONSTRAINT dispatches_litres_x100_check CHECK ((litres_x100 > 0)),
    CONSTRAINT dispatches_milk_type_check CHECK ((milk_type = ANY (ARRAY['cow'::text, 'buffalo'::text]))),
    CONSTRAINT dispatches_rate_paise_check CHECK ((rate_paise > 0)),
    CONSTRAINT dispatches_shift_check CHECK ((shift = ANY (ARRAY['morning'::text, 'evening'::text]))),
    CONSTRAINT dispatches_snf_x10_check CHECK ((snf_x10 > 0))
);


--
-- Name: farmers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.farmers (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    center_id text NOT NULL,
    code integer NOT NULL,
    name text NOT NULL,
    village text DEFAULT ''::text NOT NULL,
    mobile text DEFAULT ''::text NOT NULL,
    has_whatsapp boolean DEFAULT true NOT NULL,
    consent boolean DEFAULT false NOT NULL,
    consent_at timestamp with time zone,
    milk_cow boolean DEFAULT false NOT NULL,
    milk_buffalo boolean DEFAULT false NOT NULL,
    upi_id text DEFAULT ''::text NOT NULL,
    bank_name text DEFAULT ''::text NOT NULL,
    bank_account text DEFAULT ''::text NOT NULL,
    bank_ifsc text DEFAULT ''::text NOT NULL,
    aadhaar_enc bytea,
    aadhaar_last4 text DEFAULT ''::text NOT NULL,
    pin_hash text,
    pin_set_at timestamp with time zone,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT farmers_aadhaar_last4_check CHECK (((aadhaar_last4 = ''::text) OR (aadhaar_last4 ~ '^[0-9]{4}$'::text))),
    CONSTRAINT farmers_bank_ifsc_check CHECK (((bank_ifsc = ''::text) OR (bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'::text))),
    CONSTRAINT farmers_check CHECK ((milk_cow OR milk_buffalo)),
    CONSTRAINT farmers_check1 CHECK (((NOT consent) OR (consent_at IS NOT NULL))),
    CONSTRAINT farmers_check2 CHECK (((pin_hash IS NULL) OR (mobile <> ''::text))),
    CONSTRAINT farmers_code_check CHECK ((code > 0)),
    CONSTRAINT farmers_mobile_check CHECK (((mobile = ''::text) OR (mobile ~ '^[6-9][0-9]{9}$'::text)))
);


--
-- Name: feed_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feed_items (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    center_id text NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    price_paise bigint NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT feed_items_price_paise_check CHECK ((price_paise >= 0))
);


--
-- Name: feed_moves; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feed_moves (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    center_id text NOT NULL,
    item_id text NOT NULL,
    type text NOT NULL,
    date date NOT NULL,
    qty integer NOT NULL,
    price_paise bigint NOT NULL,
    amount_paise bigint NOT NULL,
    farmer_id text,
    bill_id text,
    note text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text NOT NULL,
    CONSTRAINT feed_moves_check CHECK (((type = 'adjust'::text) OR (qty > 0))),
    CONSTRAINT feed_moves_check1 CHECK (((type <> 'sale'::text) OR (farmer_id IS NOT NULL))),
    CONSTRAINT feed_moves_check2 CHECK (((type = 'sale'::text) OR (bill_id IS NULL))),
    CONSTRAINT feed_moves_check3 CHECK ((amount_paise = (qty * price_paise))),
    CONSTRAINT feed_moves_price_paise_check CHECK ((price_paise >= 0)),
    CONSTRAINT feed_moves_qty_check CHECK ((qty <> 0)),
    CONSTRAINT feed_moves_type_check CHECK ((type = ANY (ARRAY['in'::text, 'sale'::text, 'adjust'::text])))
);


--
-- Name: outbox_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbox_messages (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    center_id text NOT NULL,
    farmer_id text NOT NULL,
    kind text NOT NULL,
    date date NOT NULL,
    bill_id text,
    payment_id text,
    channel text NOT NULL,
    to_mobile text NOT NULL,
    template text,
    body_json jsonb NOT NULL,
    attachment_path text,
    status text DEFAULT 'queued'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone,
    fell_back boolean DEFAULT false NOT NULL,
    provider_message_id text,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    delivered_at timestamp with time zone,
    CONSTRAINT outbox_messages_attempts_check CHECK (((attempts >= 0) AND (attempts <= 6))),
    CONSTRAINT outbox_messages_channel_check CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'sms'::text]))),
    CONSTRAINT outbox_messages_check CHECK (((kind <> 'bill'::text) OR (bill_id IS NOT NULL))),
    CONSTRAINT outbox_messages_check1 CHECK (((kind <> ALL (ARRAY['payment'::text, 'payment-corrected'::text])) OR (payment_id IS NOT NULL))),
    CONSTRAINT outbox_messages_kind_check CHECK ((kind = ANY (ARRAY['daily'::text, 'bill'::text, 'payment'::text, 'payment-corrected'::text]))),
    CONSTRAINT outbox_messages_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'deferred'::text, 'sent'::text, 'delivered'::text, 'failed'::text]))),
    CONSTRAINT outbox_messages_to_mobile_check CHECK ((to_mobile ~ '^[6-9][0-9]{9}$'::text))
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    center_id text NOT NULL,
    bill_id text NOT NULL,
    farmer_id text NOT NULL,
    date date NOT NULL,
    mode text NOT NULL,
    amount_paise bigint NOT NULL,
    upi_ref text DEFAULT ''::text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    void boolean DEFAULT false NOT NULL,
    void_reason text DEFAULT ''::text NOT NULL,
    replaces_payment_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text NOT NULL,
    CONSTRAINT payments_amount_paise_check CHECK ((amount_paise > 0)),
    CONSTRAINT payments_check CHECK (((mode = 'cash'::text) OR (upi_ref <> ''::text))),
    CONSTRAINT payments_check1 CHECK (((mode = 'upi'::text) OR (upi_ref = ''::text))),
    CONSTRAINT payments_check2 CHECK (((NOT void) OR (btrim(void_reason) <> ''::text))),
    CONSTRAINT payments_mode_check CHECK ((mode = ANY (ARRAY['cash'::text, 'upi'::text])))
);


--
-- Name: rate_chart_cells; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_chart_cells (
    chart_id text NOT NULL,
    fat_x10 integer NOT NULL,
    snf_x10 integer NOT NULL,
    rate_paise bigint NOT NULL,
    CONSTRAINT rate_chart_cells_rate_paise_check CHECK ((rate_paise > 0))
);


--
-- Name: rate_charts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_charts (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    center_id text NOT NULL,
    milk_type text NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    fat_min_x10 integer NOT NULL,
    fat_max_x10 integer NOT NULL,
    snf_min_x10 integer NOT NULL,
    snf_max_x10 integer NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    adjust_paise bigint,
    note text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text NOT NULL,
    CONSTRAINT rate_charts_check CHECK (((effective_to IS NULL) OR (effective_to >= effective_from))),
    CONSTRAINT rate_charts_check1 CHECK (((fat_min_x10 > 0) AND (fat_min_x10 <= fat_max_x10))),
    CONSTRAINT rate_charts_check2 CHECK (((snf_min_x10 > 0) AND (snf_min_x10 <= snf_max_x10))),
    CONSTRAINT rate_charts_check3 CHECK (((source = 'adjust'::text) = (adjust_paise IS NOT NULL))),
    CONSTRAINT rate_charts_milk_type_check CHECK ((milk_type = ANY (ARRAY['cow'::text, 'buffalo'::text]))),
    CONSTRAINT rate_charts_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'excel'::text, 'adjust'::text])))
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    center_id text NOT NULL,
    user_id text,
    farmer_id text,
    token_hash text NOT NULL,
    login_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    logout_at timestamp with time zone,
    user_agent text,
    ip inet,
    via_tunnel boolean DEFAULT false NOT NULL,
    CONSTRAINT sessions_check CHECK ((num_nonnulls(user_id, farmer_id) = 1))
);


--
-- Name: sms_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sms_counters (
    center_id text NOT NULL,
    date date NOT NULL,
    sent integer DEFAULT 0 NOT NULL,
    CONSTRAINT sms_counters_sent_check CHECK ((sent >= 0))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    center_id text NOT NULL,
    name text NOT NULL,
    role text NOT NULL,
    pin_hash text NOT NULL,
    pin_length integer NOT NULL,
    mobile text DEFAULT ''::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_check CHECK (((role <> 'owner'::text) OR active)),
    CONSTRAINT users_mobile_check CHECK (((mobile = ''::text) OR (mobile ~ '^[6-9][0-9]{9}$'::text))),
    CONSTRAINT users_pin_length_check CHECK (((pin_length >= 4) AND (pin_length <= 6))),
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'operator'::text])))
);


--
-- Name: advance_recoveries advance_recoveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.advance_recoveries
    ADD CONSTRAINT advance_recoveries_pkey PRIMARY KEY (id);


--
-- Name: advances advances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.advances
    ADD CONSTRAINT advances_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: bill_cycles bill_cycles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_cycles
    ADD CONSTRAINT bill_cycles_pkey PRIMARY KEY (id);


--
-- Name: bills bills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_pkey PRIMARY KEY (id);


--
-- Name: bills bills_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_token_key UNIQUE (token);


--
-- Name: centers centers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.centers
    ADD CONSTRAINT centers_pkey PRIMARY KEY (id);


--
-- Name: collections collections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_pkey PRIMARY KEY (id);


--
-- Name: corrections corrections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrections
    ADD CONSTRAINT corrections_pkey PRIMARY KEY (id);


--
-- Name: dispatches dispatches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatches
    ADD CONSTRAINT dispatches_pkey PRIMARY KEY (id);


--
-- Name: farmers farmers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmers
    ADD CONSTRAINT farmers_pkey PRIMARY KEY (id);


--
-- Name: feed_items feed_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_items
    ADD CONSTRAINT feed_items_pkey PRIMARY KEY (id);


--
-- Name: feed_moves feed_moves_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_moves
    ADD CONSTRAINT feed_moves_pkey PRIMARY KEY (id);


--
-- Name: outbox_messages outbox_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_messages
    ADD CONSTRAINT outbox_messages_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: rate_chart_cells rate_chart_cells_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_chart_cells
    ADD CONSTRAINT rate_chart_cells_pkey PRIMARY KEY (chart_id, fat_x10, snf_x10);


--
-- Name: rate_charts rate_charts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_charts
    ADD CONSTRAINT rate_charts_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_token_hash_key UNIQUE (token_hash);


--
-- Name: sms_counters sms_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_counters
    ADD CONSTRAINT sms_counters_pkey PRIMARY KEY (center_id, date);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: advance_recoveries_adv_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX advance_recoveries_adv_idx ON public.advance_recoveries USING btree (advance_id);


--
-- Name: advance_recoveries_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX advance_recoveries_uq ON public.advance_recoveries USING btree (bill_id, advance_id);


--
-- Name: advances_farmer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX advances_farmer_idx ON public.advances USING btree (center_id, farmer_id, date);


--
-- Name: audit_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_at_idx ON public.audit_log USING btree (center_id, at DESC);


--
-- Name: audit_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_entity_idx ON public.audit_log USING btree (center_id, entity, entity_id);


--
-- Name: audit_login_fail_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_login_fail_idx ON public.audit_log USING btree (center_id, action, at DESC) WHERE (action = 'login-failed'::text);


--
-- Name: audit_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_user_idx ON public.audit_log USING btree (center_id, user_id, at DESC);


--
-- Name: bill_cycles_period_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bill_cycles_period_uq ON public.bill_cycles USING btree (center_id, start_date, end_date);


--
-- Name: bills_cycle_farmer_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bills_cycle_farmer_uq ON public.bills USING btree (cycle_id, farmer_id);


--
-- Name: bills_farmer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bills_farmer_idx ON public.bills USING btree (center_id, farmer_id, end_date DESC);


--
-- Name: bills_no_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bills_no_uq ON public.bills USING btree (center_id, bill_no);


--
-- Name: collections_bill_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX collections_bill_idx ON public.collections USING btree (bill_id);


--
-- Name: collections_farmer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX collections_farmer_idx ON public.collections USING btree (center_id, farmer_id, date);


--
-- Name: collections_one_entry_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX collections_one_entry_uq ON public.collections USING btree (center_id, farmer_id, date, shift, milk_type) WHERE (NOT void);


--
-- Name: collections_shift_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX collections_shift_idx ON public.collections USING btree (center_id, date, shift);


--
-- Name: corrections_one_pending_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX corrections_one_pending_uq ON public.corrections USING btree (collection_id) WHERE (status = 'pending'::text);


--
-- Name: corrections_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX corrections_status_idx ON public.corrections USING btree (center_id, status, requested_at DESC);


--
-- Name: dispatches_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX dispatches_uq ON public.dispatches USING btree (center_id, date, shift, milk_type);


--
-- Name: farmers_code_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX farmers_code_uq ON public.farmers USING btree (center_id, code);


--
-- Name: farmers_login_mobile_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX farmers_login_mobile_uq ON public.farmers USING btree (center_id, mobile) WHERE ((pin_hash IS NOT NULL) AND active);


--
-- Name: farmers_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX farmers_name_idx ON public.farmers USING btree (center_id, active, name);


--
-- Name: feed_moves_bill_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feed_moves_bill_idx ON public.feed_moves USING btree (bill_id);


--
-- Name: feed_moves_farmer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feed_moves_farmer_idx ON public.feed_moves USING btree (center_id, farmer_id, date);


--
-- Name: feed_moves_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feed_moves_item_idx ON public.feed_moves USING btree (center_id, item_id);


--
-- Name: outbox_farmer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_farmer_idx ON public.outbox_messages USING btree (center_id, farmer_id, created_at DESC);


--
-- Name: outbox_no_double_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX outbox_no_double_uq ON public.outbox_messages USING btree (center_id, farmer_id, kind, date, COALESCE(bill_id, ''::text), COALESCE(payment_id, ''::text));


--
-- Name: outbox_worker_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_worker_idx ON public.outbox_messages USING btree (status, next_attempt_at);


--
-- Name: payments_bill_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_bill_idx ON public.payments USING btree (bill_id);


--
-- Name: payments_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_date_idx ON public.payments USING btree (center_id, date);


--
-- Name: payments_farmer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_farmer_idx ON public.payments USING btree (center_id, farmer_id, date);


--
-- Name: payments_replaces_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payments_replaces_uq ON public.payments USING btree (replaces_payment_id) WHERE (replaces_payment_id IS NOT NULL);


--
-- Name: rate_charts_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rate_charts_lookup_idx ON public.rate_charts USING btree (center_id, milk_type, effective_from DESC);


--
-- Name: sessions_farmer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_farmer_idx ON public.sessions USING btree (center_id, farmer_id, login_at DESC);


--
-- Name: sessions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_user_idx ON public.sessions USING btree (center_id, user_id, login_at DESC);


--
-- Name: users_center_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_center_idx ON public.users USING btree (center_id, active);


--
-- Name: audit_log audit_log_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON public.audit_log FOR EACH STATEMENT EXECUTE FUNCTION public.audit_log_block_change();


--
-- Name: audit_log audit_log_no_update_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_log_no_update_delete BEFORE DELETE OR UPDATE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.audit_log_block_change();


--
-- Name: bills bills_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bills_guard BEFORE DELETE OR UPDATE ON public.bills FOR EACH ROW EXECUTE FUNCTION public.bills_guard();


--
-- Name: centers centers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER centers_updated_at BEFORE UPDATE ON public.centers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: collections collections_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER collections_guard BEFORE INSERT OR DELETE OR UPDATE ON public.collections FOR EACH ROW EXECUTE FUNCTION public.collections_guard();


--
-- Name: farmers farmers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER farmers_updated_at BEFORE UPDATE ON public.farmers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: feed_items feed_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER feed_items_updated_at BEFORE UPDATE ON public.feed_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: feed_moves feed_moves_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER feed_moves_guard BEFORE DELETE OR UPDATE ON public.feed_moves FOR EACH ROW EXECUTE FUNCTION public.feed_moves_guard();


--
-- Name: payments payments_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payments_guard BEFORE INSERT OR DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.payments_guard();


--
-- Name: payments payments_sync_bill; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payments_sync_bill AFTER INSERT OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.payments_sync_bill();


--
-- Name: users users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: advance_recoveries advance_recoveries_advance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.advance_recoveries
    ADD CONSTRAINT advance_recoveries_advance_id_fkey FOREIGN KEY (advance_id) REFERENCES public.advances(id);


--
-- Name: advance_recoveries advance_recoveries_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.advance_recoveries
    ADD CONSTRAINT advance_recoveries_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bills(id) ON DELETE CASCADE;


--
-- Name: advance_recoveries advance_recoveries_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.advance_recoveries
    ADD CONSTRAINT advance_recoveries_center_id_fkey FOREIGN KEY (center_id) REFERENCES public.centers(id);


--
-- Name: advances advances_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.advances
    ADD CONSTRAINT advances_center_id_fkey FOREIGN KEY (center_id) REFERENCES public.centers(id);


--
-- Name: advances advances_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.advances
    ADD CONSTRAINT advances_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: advances advances_farmer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.advances
    ADD CONSTRAINT advances_farmer_id_fkey FOREIGN KEY (farmer_id) REFERENCES public.farmers(id);


--
-- Name: audit_log audit_log_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_center_id_fkey FOREIGN KEY (center_id) REFERENCES public.centers(id);


--
-- Name: audit_log audit_log_farmer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_farmer_id_fkey FOREIGN KEY (farmer_id) REFERENCES public.farmers(id);


--
-- Name: audit_log audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: bill_cycles bill_cycles_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_cycles
    ADD CONSTRAINT bill_cycles_center_id_fkey FOREIGN KEY (center_id) REFERENCES public.centers(id);


--
-- Name: bill_cycles bill_cycles_finalized_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_cycles
    ADD CONSTRAINT bill_cycles_finalized_by_fkey FOREIGN KEY (finalized_by) REFERENCES public.users(id);


--
-- Name: bills bills_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_center_id_fkey FOREIGN KEY (center_id) REFERENCES public.centers(id);


--
-- Name: bills bills_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.bill_cycles(id);


--
-- Name: bills bills_farmer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_farmer_id_fkey FOREIGN KEY (farmer_id) REFERENCES public.farmers(id);


--
-- Name: collections collections_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bills(id);


--
-- Name: collections collections_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_center_id_fkey FOREIGN KEY (center_id) REFERENCES public.centers(id);


--
-- Name: collections collections_chart_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_chart_id_fkey FOREIGN KEY (chart_id) REFERENCES public.rate_charts(id);


--
-- Name: collections collections_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: collections collections_farmer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_farmer_id_fkey FOREIGN KEY (farmer_id) REFERENCES public.farmers(id);


--
-- Name: corrections corrections_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrections
    ADD CONSTRAINT corrections_center_id_fkey FOREIGN KEY (center_id) REFERENCES public.centers(id);


--
-- Name: corrections corrections_collection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrections
    ADD CONSTRAINT corrections_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES public.collections(id);


--
-- Name: corrections corrections_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrections
    ADD CONSTRAINT corrections_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.users(id);


--
-- Name: corrections corrections_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrections
    ADD CONSTRAINT corrections_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: dispatches dispatches_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatches
    ADD CONSTRAINT dispatches_center_id_fkey FOREIGN KEY (center_id) REFERENCES public.centers(id);


--
-- Name: dispatches dispatches_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatches
    ADD CONSTRAINT dispatches_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: farmers farmers_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmers
    ADD CONSTRAINT farmers_center_id_fkey FOREIGN KEY (center_id) REFERENCES public.centers(id);


--
-- Name: feed_items feed_items_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_items
    ADD CONSTRAINT feed_items_center_id_fkey FOREIGN KEY (center_id) REFERENCES public.centers(id);


--
-- Name: feed_moves feed_moves_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_moves
    ADD CONSTRAINT feed_moves_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bills(id);


--
-- Name: feed_moves feed_moves_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_moves
    ADD CONSTRAINT feed_moves_center_id_fkey FOREIGN KEY (center_id) REFERENCES public.centers(id);


--
-- Name: feed_moves feed_moves_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_moves
    ADD CONSTRAINT feed_moves_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: feed_moves feed_moves_farmer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_moves
    ADD CONSTRAINT feed_moves_farmer_id_fkey FOREIGN KEY (farmer_id) REFERENCES public.farmers(id);


--
-- Name: feed_moves feed_moves_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_moves
    ADD CONSTRAINT feed_moves_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.feed_items(id);


--
-- Name: outbox_messages outbox_messages_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_messages
    ADD CONSTRAINT outbox_messages_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bills(id);


--
-- Name: outbox_messages outbox_messages_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_messages
    ADD CONSTRAINT outbox_messages_center_id_fkey FOREIGN KEY (center_id) REFERENCES public.centers(id);


--
-- Name: outbox_messages outbox_messages_farmer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_messages
    ADD CONSTRAINT outbox_messages_farmer_id_fkey FOREIGN KEY (farmer_id) REFERENCES public.farmers(id);


--
-- Name: outbox_messages outbox_messages_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_messages
    ADD CONSTRAINT outbox_messages_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id);


--
-- Name: payments payments_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bills(id);


--
-- Name: payments payments_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_center_id_fkey FOREIGN KEY (center_id) REFERENCES public.centers(id);


--
-- Name: payments payments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: payments payments_farmer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_farmer_id_fkey FOREIGN KEY (farmer_id) REFERENCES public.farmers(id);


--
-- Name: payments payments_replaces_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_replaces_payment_id_fkey FOREIGN KEY (replaces_payment_id) REFERENCES public.payments(id);


--
-- Name: rate_chart_cells rate_chart_cells_chart_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_chart_cells
    ADD CONSTRAINT rate_chart_cells_chart_id_fkey FOREIGN KEY (chart_id) REFERENCES public.rate_charts(id) ON DELETE CASCADE;


--
-- Name: rate_charts rate_charts_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_charts
    ADD CONSTRAINT rate_charts_center_id_fkey FOREIGN KEY (center_id) REFERENCES public.centers(id);


--
-- Name: rate_charts rate_charts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_charts
    ADD CONSTRAINT rate_charts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: sessions sessions_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_center_id_fkey FOREIGN KEY (center_id) REFERENCES public.centers(id);


--
-- Name: sessions sessions_farmer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_farmer_id_fkey FOREIGN KEY (farmer_id) REFERENCES public.farmers(id);


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: sms_counters sms_counters_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_counters
    ADD CONSTRAINT sms_counters_center_id_fkey FOREIGN KEY (center_id) REFERENCES public.centers(id);


--
-- Name: users users_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_center_id_fkey FOREIGN KEY (center_id) REFERENCES public.centers(id);


--
-- PostgreSQL database dump complete
--

\unrestrict bhplHDasgYHUYYoaWlspjtHGZRGefJS3paitMjD9BBsThywaE5aMIWHyKwdcvpH

