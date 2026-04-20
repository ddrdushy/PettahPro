-- Customer payments (receipts). Bills-side payments in a later migration.
-- A payment consists of header + N allocations (each against a posted invoice).
-- Posting creates: DR Bank/Cash · CR Accounts receivable.

CREATE TABLE IF NOT EXISTS customer_payments (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_number      varchar(48),
  customer_id         uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  payment_date        date NOT NULL DEFAULT current_date,
  method              varchar(16) NOT NULL,
  amount_cents        bigint NOT NULL,
  currency            varchar(3) NOT NULL DEFAULT 'LKR',
  bank_account_id     uuid NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  reference           varchar(64),        -- cheque no, bank ref, etc.
  cheque_date         date,
  memo                text,
  status              varchar(16) NOT NULL DEFAULT 'posted',  -- draft | posted | reversed
  journal_entry_id    uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  posted_at           timestamptz,
  posted_by_user_id   uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by_user_id  uuid,
  deleted_at          timestamptz,
  CONSTRAINT customer_payments_amount_positive CHECK (amount_cents > 0),
  CONSTRAINT customer_payments_method_check CHECK (
    method IN ('cash','bank_transfer','cheque','card','lankaqr','payhere','frimi','genie','ipay','other')
  ),
  CONSTRAINT customer_payments_status_check CHECK (status IN ('draft','posted','reversed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_payments_tenant_number_unique
  ON customer_payments(tenant_id, payment_number)
  WHERE payment_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_payments_tenant_customer
  ON customer_payments(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS customer_payments_tenant_date
  ON customer_payments(tenant_id, payment_date);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_id       uuid NOT NULL REFERENCES customer_payments(id) ON DELETE CASCADE,
  invoice_id       uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  allocated_cents  bigint NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_allocations_positive CHECK (allocated_cents > 0)
);

CREATE INDEX IF NOT EXISTS payment_allocations_payment_idx ON payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS payment_allocations_invoice_idx ON payment_allocations(invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS payment_allocations_unique_pair
  ON payment_allocations(payment_id, invoice_id);

ALTER TABLE customer_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_payments_tenant_isolation ON customer_payments;
CREATE POLICY customer_payments_tenant_isolation ON customer_payments
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_allocations_tenant_isolation ON payment_allocations;
CREATE POLICY payment_allocations_tenant_isolation ON payment_allocations
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
