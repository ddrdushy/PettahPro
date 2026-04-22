-- Number series config (#23)
-- Extends document_sequences with a user-editable template so tenants can
-- customise their doc number format without schema changes.
--
-- Before this migration:
--   next_document_number('invoice') → hardcoded format 'INV-2026-0042'
-- After:
--   Templates like '{PREFIX}-{YYYY}-{SEQ}', '{PREFIX}/{YY}{MM}/{SEQ}',
--   'INV{YY}-{SEQ}' — whatever the tenant wants.
--
-- Idempotent: safe to re-run. Backfill preserves the exact current output
-- format for every existing tenant, so live numbering does not shift.

-- 1. New columns ------------------------------------------------------------

ALTER TABLE document_sequences
  ADD COLUMN IF NOT EXISTS template varchar(128);

ALTER TABLE document_sequences
  ADD COLUMN IF NOT EXISTS display_name varchar(64);

-- 2. Backfill template to match current legacy format exactly ---------------

-- Any row with NULL template gets the canonical template for its current scope.
UPDATE document_sequences
   SET template = CASE scope
                    WHEN 'year'   THEN '{PREFIX}-{YYYY}-{SEQ}'
                    WHEN 'month'  THEN '{PREFIX}-{YYYY}{MM}-{SEQ}'
                    WHEN 'global' THEN '{PREFIX}-{SEQ}'
                    ELSE              '{PREFIX}-{SEQ}'
                  END
 WHERE template IS NULL;

-- Friendly labels for the settings UI. Safe to extend — the UI reads whatever
-- is here and falls back to sequence_name for anything not listed.
UPDATE document_sequences SET display_name = COALESCE(display_name, CASE sequence_name
  WHEN 'invoice'          THEN 'Invoice'
  WHEN 'bill'             THEN 'Bill'
  WHEN 'payment'          THEN 'Customer payment'
  WHEN 'receipt'          THEN 'Receipt'
  WHEN 'journal'          THEN 'Journal entry'
  WHEN 'credit_note'      THEN 'Credit note'
  WHEN 'debit_note'       THEN 'Debit note'
  WHEN 'quotation'        THEN 'Quotation'
  WHEN 'proforma_invoice' THEN 'Proforma invoice'
  WHEN 'sales_order'      THEN 'Sales order'
  WHEN 'purchase_order'   THEN 'Purchase order'
  WHEN 'delivery_note'    THEN 'Delivery note'
  WHEN 'grn'              THEN 'Goods received note'
  WHEN 'payroll'          THEN 'Payroll run'
  WHEN 'bonus_run'        THEN 'Bonus run'
  WHEN 'stock_transfer'   THEN 'Stock transfer'
  WHEN 'stock_count'      THEN 'Stock count'
  WHEN 'staff_loan'       THEN 'Staff loan'
  ELSE initcap(replace(sequence_name, '_', ' '))
END);

-- Make template NOT NULL now that it's backfilled.
ALTER TABLE document_sequences
  ALTER COLUMN template SET NOT NULL;

-- 3. Shared formatter -------------------------------------------------------
--
-- Pure function: given all the inputs, produce the formatted string.
-- Used by next_document_number (after incrementing) and the preview endpoint
-- (no side effects). Accepts an arbitrary "reference date" so callers can
-- preview what a given template would produce right now.
CREATE OR REPLACE FUNCTION format_document_number(
  p_template  varchar,
  p_prefix    varchar,
  p_pad_width smallint,
  p_counter   integer,
  p_ref_date  date
) RETURNS varchar
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_out   varchar := p_template;
  v_yyyy  varchar := to_char(p_ref_date, 'YYYY');
  v_yy    varchar := to_char(p_ref_date, 'YY');
  v_mm    varchar := to_char(p_ref_date, 'MM');
  v_mmm   varchar := to_char(p_ref_date, 'Mon');   -- e.g. Apr
  v_month varchar := trim(to_char(p_ref_date, 'Month')); -- e.g. April
  v_seq   varchar := lpad(p_counter::text, GREATEST(p_pad_width, 1), '0');
BEGIN
  v_out := replace(v_out, '{PREFIX}', COALESCE(p_prefix, ''));
  v_out := replace(v_out, '{YYYY}',   v_yyyy);
  v_out := replace(v_out, '{YY}',     v_yy);
  v_out := replace(v_out, '{MM}',     v_mm);
  v_out := replace(v_out, '{MMM}',    v_mmm);
  v_out := replace(v_out, '{MONTH}',  v_month);
  v_out := replace(v_out, '{SEQ}',    v_seq);
  RETURN v_out;
END;
$$;

-- 4. Rewrite next_document_number -------------------------------------------
--
-- Same locking semantics as before (SELECT FOR UPDATE + period-boundary reset)
-- but delegates string formatting to format_document_number().
CREATE OR REPLACE FUNCTION next_document_number(p_sequence_name varchar)
RETURNS varchar
LANGUAGE plpgsql
AS $$
DECLARE
  v_seq         document_sequences%ROWTYPE;
  v_today       date     := current_date;
  v_year        smallint := EXTRACT(year  FROM v_today)::smallint;
  v_month       smallint := EXTRACT(month FROM v_today)::smallint;
  v_new_counter integer;
BEGIN
  SELECT * INTO v_seq
  FROM document_sequences
  WHERE sequence_name = p_sequence_name
    AND tenant_id = current_tenant_id()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sequence % not configured for tenant', p_sequence_name
      USING ERRCODE = 'P0002';
  END IF;

  -- Reset counter on period boundary
  IF v_seq.scope = 'year'
     AND v_seq.current_year IS DISTINCT FROM v_year THEN
    v_seq.counter      := 0;
    v_seq.current_year := v_year;
    v_seq.current_month := NULL;
  ELSIF v_seq.scope = 'month'
     AND (v_seq.current_year  IS DISTINCT FROM v_year
       OR v_seq.current_month IS DISTINCT FROM v_month) THEN
    v_seq.counter      := 0;
    v_seq.current_year := v_year;
    v_seq.current_month := v_month;
  END IF;

  v_new_counter := v_seq.counter + 1;

  UPDATE document_sequences
     SET counter       = v_new_counter,
         current_year  = v_seq.current_year,
         current_month = v_seq.current_month,
         updated_at    = now()
   WHERE id = v_seq.id;

  RETURN format_document_number(
    v_seq.template,
    v_seq.prefix,
    v_seq.pad_width,
    v_new_counter,
    v_today
  );
END;
$$;

-- 5. Seed template for future tenants ---------------------------------------
--
-- Patch seed_tenant_defaults so newly-created tenants get the same default
-- templates as the backfill above — otherwise fresh signups would see NULL
-- template on new rows and the NOT NULL constraint would break.
--
-- Rather than duplicate seed_tenant_defaults wholesale, we rely on the
-- per-row default-template handler below. This trigger fires on any insert
-- into document_sequences without an explicit template and fills in the
-- canonical scope-based default.

CREATE OR REPLACE FUNCTION document_sequences_default_template()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.template IS NULL THEN
    NEW.template := CASE NEW.scope
                      WHEN 'year'   THEN '{PREFIX}-{YYYY}-{SEQ}'
                      WHEN 'month'  THEN '{PREFIX}-{YYYY}{MM}-{SEQ}'
                      WHEN 'global' THEN '{PREFIX}-{SEQ}'
                      ELSE              '{PREFIX}-{SEQ}'
                    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS document_sequences_default_template_trg ON document_sequences;
CREATE TRIGGER document_sequences_default_template_trg
  BEFORE INSERT ON document_sequences
  FOR EACH ROW EXECUTE FUNCTION document_sequences_default_template();
