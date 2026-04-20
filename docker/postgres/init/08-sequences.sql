-- Per-tenant document sequences (invoice numbers, bill numbers, journal numbers, etc.)
-- Uses PG advisory locks on (tenant_id, sequence_name) to serialize nextval within a tx.

CREATE TABLE IF NOT EXISTS document_sequences (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sequence_name varchar(64) NOT NULL,
  prefix        varchar(32) NOT NULL,         -- e.g. 'INV'
  scope         varchar(16) NOT NULL DEFAULT 'year', -- year | month | global
  pad_width     smallint NOT NULL DEFAULT 4,
  current_year  smallint,
  current_month smallint,
  counter       integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS doc_seq_tenant_name_unique
  ON document_sequences(tenant_id, sequence_name);

ALTER TABLE document_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_sequences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_sequences_tenant_isolation ON document_sequences;
CREATE POLICY document_sequences_tenant_isolation ON document_sequences
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Returns the next formatted document number for (tenant, sequence_name).
-- Caller must have set app.tenant_id beforehand (for RLS).
CREATE OR REPLACE FUNCTION next_document_number(p_sequence_name varchar)
RETURNS varchar
LANGUAGE plpgsql
AS $$
DECLARE
  v_seq        document_sequences%ROWTYPE;
  v_year       smallint := EXTRACT(year FROM current_date)::smallint;
  v_month      smallint := EXTRACT(month FROM current_date)::smallint;
  v_new_counter integer;
  v_result     varchar;
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
  IF v_seq.scope = 'year' AND v_seq.current_year IS DISTINCT FROM v_year THEN
    v_seq.counter := 0;
    v_seq.current_year := v_year;
    v_seq.current_month := NULL;
  ELSIF v_seq.scope = 'month' AND (v_seq.current_year IS DISTINCT FROM v_year OR v_seq.current_month IS DISTINCT FROM v_month) THEN
    v_seq.counter := 0;
    v_seq.current_year := v_year;
    v_seq.current_month := v_month;
  END IF;

  v_new_counter := v_seq.counter + 1;

  UPDATE document_sequences
  SET counter = v_new_counter,
      current_year = v_seq.current_year,
      current_month = v_seq.current_month,
      updated_at = now()
  WHERE id = v_seq.id;

  -- Format: PREFIX-YYYY-NNNN (year scope) or PREFIX-YYYYMM-NNNN (month) or PREFIX-NNNN (global)
  IF v_seq.scope = 'year' THEN
    v_result := format('%s-%s-%s',
      v_seq.prefix,
      v_seq.current_year,
      lpad(v_new_counter::text, v_seq.pad_width, '0'));
  ELSIF v_seq.scope = 'month' THEN
    v_result := format('%s-%s%s-%s',
      v_seq.prefix,
      v_seq.current_year,
      lpad(v_seq.current_month::text, 2, '0'),
      lpad(v_new_counter::text, v_seq.pad_width, '0'));
  ELSE
    v_result := format('%s-%s',
      v_seq.prefix,
      lpad(v_new_counter::text, v_seq.pad_width, '0'));
  END IF;

  RETURN v_result;
END;
$$;
