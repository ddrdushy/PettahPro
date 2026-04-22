-- Proforma invoices — pre-sale invoice-shaped documents (§sell 11.7).
--
-- What a proforma is, exactly, and why it's NOT a quotation:
-- ----------------------------------------------------------
-- A quotation says "here's my offer, negotiate if you like". A proforma
-- says "we've agreed on the deal — here's the paperwork so you can (a) pay
-- the advance, (b) clear customs, (c) raise your internal PO, (d) apply
-- for a letter of credit". It's a formal, invoice-shaped document with
-- the *exact* final amount, but no GL impact and no AR balance. The real
-- invoice gets raised after delivery/payment and copies the proforma.
--
-- Sri Lankan use cases that drive this:
--   * Export customers need a proforma for customs clearance before goods
--     ship — the real invoice follows once the Bill of Lading is ready.
--   * Government / institutional buyers require a proforma to route through
--     procurement before they'll raise their own PO against you.
--   * Advance-payment deals: 50% upfront → invoice is raised only after
--     delivery, but the customer needs *something* to wire against. A
--     proforma is that something.
--
-- Why not reuse quotations?
--   Two reasons: (1) tenants want distinct numbering (PF-2026-001 vs
--   QT-2026-001) and distinct PDF styling ("PROFORMA INVOICE" header
--   centered, different terms block); (2) the lifecycle is simpler — no
--   accept/reject, just sent → converted (or cancelled). Mashing it into
--   quotations adds an `is_proforma` boolean which always leaks into every
--   query with WHERE is_proforma = false.
--
-- States: draft → sent → converted (to invoice) | cancelled
-- One proforma can only convert once. The converted_invoice_id back-
-- reference lets the invoice's PDF cite the proforma number.

CREATE TABLE IF NOT EXISTS proforma_invoices (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  proforma_number        varchar(48),
  customer_id            uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  branch_id              uuid REFERENCES branches(id) ON DELETE SET NULL,
  status                 varchar(16) NOT NULL DEFAULT 'draft',
  issue_date             date NOT NULL DEFAULT current_date,
  valid_until            date NOT NULL,
  currency               varchar(3) NOT NULL DEFAULT 'LKR',
  subtotal_cents         bigint NOT NULL DEFAULT 0,
  discount_cents         bigint NOT NULL DEFAULT 0,
  tax_cents              bigint NOT NULL DEFAULT 0,
  total_cents            bigint NOT NULL DEFAULT 0,
  reference              varchar(64),
  notes                  text,
  terms                  text,
  sent_at                timestamptz,
  converted_invoice_id   uuid REFERENCES invoices(id) ON DELETE SET NULL,
  converted_at           timestamptz,
  cancelled_at           timestamptz,
  cancelled_reason       text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by_user_id     uuid,
  deleted_at             timestamptz,
  CONSTRAINT proforma_invoices_status_check CHECK (status IN (
    'draft','sent','converted','cancelled'
  )),
  CONSTRAINT proforma_invoices_totals_non_negative CHECK (
    subtotal_cents >= 0 AND discount_cents >= 0 AND tax_cents >= 0 AND total_cents >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS proforma_invoices_tenant_number_unique
  ON proforma_invoices(tenant_id, proforma_number)
  WHERE proforma_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS proforma_invoices_tenant_status
  ON proforma_invoices(tenant_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS proforma_invoices_tenant_customer
  ON proforma_invoices(tenant_id, customer_id);

CREATE TABLE IF NOT EXISTS proforma_invoice_lines (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  proforma_invoice_id  uuid NOT NULL REFERENCES proforma_invoices(id) ON DELETE CASCADE,
  line_no              smallint NOT NULL,
  item_id              uuid REFERENCES items(id) ON DELETE SET NULL,
  description          varchar(500) NOT NULL,
  quantity             numeric(18,4) NOT NULL DEFAULT 1,
  unit_price_cents     bigint NOT NULL DEFAULT 0,
  line_subtotal_cents  bigint NOT NULL DEFAULT 0,
  discount_pct_bps     integer NOT NULL DEFAULT 0,
  discount_cents       bigint NOT NULL DEFAULT 0,
  tax_code_id          uuid REFERENCES tax_codes(id) ON DELETE SET NULL,
  tax_rate_bps         integer NOT NULL DEFAULT 0,
  tax_cents            bigint NOT NULL DEFAULT 0,
  line_total_cents     bigint NOT NULL DEFAULT 0,
  income_account_id    uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proforma_invoice_lines_qty_positive CHECK (quantity > 0),
  CONSTRAINT proforma_invoice_lines_amounts_non_negative CHECK (
    unit_price_cents >= 0 AND line_subtotal_cents >= 0
    AND discount_cents >= 0 AND tax_cents >= 0 AND line_total_cents >= 0
  ),
  CONSTRAINT proforma_invoice_lines_discount_pct_range CHECK (
    discount_pct_bps BETWEEN 0 AND 10000
  )
);

CREATE INDEX IF NOT EXISTS proforma_invoice_lines_header
  ON proforma_invoice_lines(proforma_invoice_id, line_no);

ALTER TABLE proforma_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE proforma_invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS proforma_invoices_isolation ON proforma_invoices;
CREATE POLICY proforma_invoices_isolation ON proforma_invoices
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Document-number sequence: PF-2026-0001 style. Seeded for all existing
-- tenants; the seed in 07-seed-defaults.sql handles new tenants going
-- forward (we update that file too).
INSERT INTO document_sequences (tenant_id, sequence_name, prefix, scope, pad_width)
SELECT t.id, 'proforma_invoice', 'PF', 'year', 4
  FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM document_sequences d
    WHERE d.tenant_id = t.id AND d.sequence_name = 'proforma_invoice'
 );

ALTER TABLE proforma_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE proforma_invoice_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS proforma_invoice_lines_isolation ON proforma_invoice_lines;
CREATE POLICY proforma_invoice_lines_isolation ON proforma_invoice_lines
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
