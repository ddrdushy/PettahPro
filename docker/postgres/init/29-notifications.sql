-- In-app notifications — the header bell + red-dot with recent events.
-- No external fan-out (no email/push yet). Writes happen inside the same
-- transaction as the triggering event (invoice post, bill post, payment
-- received, etc.) via a single helper, so they roll back together.
--
-- user_id nullable = broadcast to every user in the tenant. The list
-- endpoint fans broadcast rows out at read time rather than at write time
-- (fewer rows, cheaper writes).

CREATE TABLE IF NOT EXISTS notifications (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid,                            -- null = broadcast to all tenant users
  kind        varchar(48) NOT NULL,            -- invoice_posted, bill_posted, payment_received, cheque_bounced, leave_submitted, overdue_aging, etc.
  title       varchar(200) NOT NULL,
  body        varchar(500),
  ref_type    varchar(32),                     -- invoice, bill, customer_payment, cheque, leave_request, ...
  ref_id      uuid,
  read_at     timestamptz,                     -- null = unread
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Query access patterns:
--   (a) unread count for header bell                           → (tenant, user_id, read_at IS NULL)
--   (b) recent list for dropdown panel (unread first, then read) → (tenant, user_id, created_at DESC)
CREATE INDEX IF NOT EXISTS notifications_tenant_user_unread
  ON notifications(tenant_id, user_id, read_at)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_tenant_user_recent
  ON notifications(tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_tenant_broadcast_recent
  ON notifications(tenant_id, created_at DESC)
  WHERE user_id IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_tenant_isolation ON notifications;
CREATE POLICY notifications_tenant_isolation ON notifications
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
