-- SL cheque lifecycle per spec + Bounced Cheques Act.
-- Unified table for both directions (received from customer, issued to supplier).
-- Mirrors the 9-state model documented in the spec; state transitions are
-- enforced in application code (Fastify routes) where GL postings also happen.

CREATE TABLE IF NOT EXISTS cheques (
  id                          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  direction                   varchar(12) NOT NULL,            -- 'received' | 'issued'
  status                      varchar(24) NOT NULL,            -- see state machine
  cheque_number               varchar(32) NOT NULL,
  cheque_date                 date NOT NULL,
  amount_cents                bigint NOT NULL,
  currency                    varchar(3) NOT NULL DEFAULT 'LKR',
  -- Parties
  customer_id                 uuid REFERENCES customers(id) ON DELETE RESTRICT,
  supplier_id                 uuid REFERENCES suppliers(id) ON DELETE RESTRICT,
  other_party_name            varchar(255),
  payee_name                  varchar(255),
  -- Bank info (for received: drawee = the customer's bank; for issued: our bank is bank_account_id)
  bank_account_id             uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  drawee_bank_name            varchar(128),
  drawee_branch_name          varchar(128),
  drawee_account_number       varchar(64),
  -- Source linkage
  source_payment_id           uuid REFERENCES supplier_payments(id) ON DELETE SET NULL,
  source_receipt_id           uuid REFERENCES customer_payments(id) ON DELETE SET NULL,
  -- Lifecycle timestamps
  issued_at                   timestamptz,
  handed_over_at              timestamptz,
  deposited_at                timestamptz,
  presented_at                timestamptz,
  cleared_at                  timestamptz,
  bounced_at                  timestamptz,
  cancelled_at                timestamptz,
  stale_at                    date,                             -- auto-set to cheque_date + 6 months
  -- Bounce tracking (denormalized count; full detail in cheque_bounce_events)
  bounce_count                smallint NOT NULL DEFAULT 0,
  last_bounce_reason          varchar(64),
  -- GL linkage per transition
  journal_entry_id_create     uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  journal_entry_id_clear      uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  journal_entry_id_bounce     uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  -- Legal action (Bounced Cheques Act §138 NIA)
  legal_action_initiated      boolean NOT NULL DEFAULT false,
  legal_action_initiated_at   timestamptz,
  legal_case_reference        varchar(64),
  -- Audit
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by_user_id          uuid,
  memo                        text,
  CONSTRAINT cheques_direction_check CHECK (direction IN ('received','issued')),
  CONSTRAINT cheques_status_check CHECK (status IN (
    -- issued cheques
    'drafted','issued','presented','cleared','bounced','cancelled','stale','reissued','replaced',
    -- received cheques
    'received','deposited','in_clearing','returned_to_customer'
  )),
  CONSTRAINT cheques_amount_positive CHECK (amount_cents > 0),
  CONSTRAINT cheques_party_check CHECK (
    -- Received cheque must reference a customer
    (direction = 'received' AND (customer_id IS NOT NULL OR other_party_name IS NOT NULL))
    OR
    -- Issued cheque must reference a supplier
    (direction = 'issued' AND (supplier_id IS NOT NULL OR other_party_name IS NOT NULL))
  )
);

CREATE INDEX IF NOT EXISTS cheques_tenant_status
  ON cheques(tenant_id, status)
  WHERE status NOT IN ('cleared','cancelled','replaced');
CREATE INDEX IF NOT EXISTS cheques_tenant_direction_date
  ON cheques(tenant_id, direction, cheque_date);
CREATE INDEX IF NOT EXISTS cheques_tenant_customer ON cheques(tenant_id, customer_id)
  WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cheques_tenant_supplier ON cheques(tenant_id, supplier_id)
  WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cheques_source_receipt ON cheques(source_receipt_id)
  WHERE source_receipt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cheques_source_payment ON cheques(source_payment_id)
  WHERE source_payment_id IS NOT NULL;

-- ------------------------------------------------------------------------------
-- Bounce events — one row per bounce (a cheque can bounce, be re-presented, bounce again)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cheque_bounce_events (
  id                          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cheque_id                   uuid NOT NULL REFERENCES cheques(id) ON DELETE CASCADE,
  bounce_number               smallint NOT NULL,               -- 1st bounce, 2nd bounce, …
  bounced_at                  timestamptz NOT NULL DEFAULT now(),
  reason_code                 varchar(32) NOT NULL,            -- insufficient_funds | account_closed | stopped_payment | signature_mismatch | post_dated | stale | other
  reason_details              text,
  bank_charges_cents          bigint NOT NULL DEFAULT 0,
  bank_charges_account_id     uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  customer_notified_at        timestamptz,
  notification_channel        varchar(32),                     -- sms | whatsapp | email | phone | in_person
  re_presented                boolean NOT NULL DEFAULT false,
  re_presented_at             timestamptz,
  reversal_journal_entry_id   uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by_user_id          uuid,
  CONSTRAINT cheque_bounce_reason_check CHECK (
    reason_code IN (
      'insufficient_funds','account_closed','stopped_payment',
      'signature_mismatch','post_dated','stale','refer_to_drawer','other'
    )
  ),
  CONSTRAINT cheque_bounce_charges_non_negative CHECK (bank_charges_cents >= 0)
);

CREATE INDEX IF NOT EXISTS cheque_bounce_events_cheque_idx ON cheque_bounce_events(cheque_id);
CREATE UNIQUE INDEX IF NOT EXISTS cheque_bounce_events_unique_num
  ON cheque_bounce_events(cheque_id, bounce_number);

-- RLS
ALTER TABLE cheques ENABLE ROW LEVEL SECURITY;
ALTER TABLE cheques FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cheques_tenant_isolation ON cheques;
CREATE POLICY cheques_tenant_isolation ON cheques
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE cheque_bounce_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cheque_bounce_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cheque_bounce_events_tenant_isolation ON cheque_bounce_events;
CREATE POLICY cheque_bounce_events_tenant_isolation ON cheque_bounce_events
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
