-- Supplier payments (money out). Counterpart to customer_payments.
-- Posting: DR Accounts payable · CR Bank/Cash.

CREATE TABLE IF NOT EXISTS supplier_payments (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_number      varchar(48),
  supplier_id         uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  payment_date        date NOT NULL DEFAULT current_date,
  method              varchar(16) NOT NULL,
  amount_cents        bigint NOT NULL,
  currency            varchar(3) NOT NULL DEFAULT 'LKR',
  bank_account_id     uuid NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  reference           varchar(64),
  cheque_number       varchar(32),
  cheque_date         date,
  memo                text,
  status              varchar(16) NOT NULL DEFAULT 'posted',
  journal_entry_id    uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  posted_at           timestamptz,
  posted_by_user_id   uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by_user_id  uuid,
  deleted_at          timestamptz,
  CONSTRAINT supplier_payments_amount_positive CHECK (amount_cents > 0),
  CONSTRAINT supplier_payments_method_check CHECK (
    method IN ('cash','bank_transfer','cheque','slips','other')
  ),
  CONSTRAINT supplier_payments_status_check CHECK (status IN ('draft','posted','reversed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS supplier_payments_tenant_number_unique
  ON supplier_payments(tenant_id, payment_number)
  WHERE payment_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS supplier_payments_tenant_supplier
  ON supplier_payments(tenant_id, supplier_id);
CREATE INDEX IF NOT EXISTS supplier_payments_tenant_date
  ON supplier_payments(tenant_id, payment_date);

CREATE TABLE IF NOT EXISTS bill_allocations (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_id       uuid NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
  bill_id          uuid NOT NULL REFERENCES bills(id) ON DELETE RESTRICT,
  allocated_cents  bigint NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bill_allocations_positive CHECK (allocated_cents > 0)
);

CREATE INDEX IF NOT EXISTS bill_allocations_payment_idx ON bill_allocations(payment_id);
CREATE INDEX IF NOT EXISTS bill_allocations_bill_idx ON bill_allocations(bill_id);
CREATE UNIQUE INDEX IF NOT EXISTS bill_allocations_unique_pair
  ON bill_allocations(payment_id, bill_id);

ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_payments_tenant_isolation ON supplier_payments;
CREATE POLICY supplier_payments_tenant_isolation ON supplier_payments
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE bill_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_allocations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bill_allocations_tenant_isolation ON bill_allocations;
CREATE POLICY bill_allocations_tenant_isolation ON bill_allocations
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
