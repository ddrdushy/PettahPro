import { sql } from "drizzle-orm";
import type { Database } from "@pettahpro/db";

/**
 * Audit event kinds.
 *
 * Centralised here so every caller uses a known string and the viewer can
 * render nice labels / icons per kind. Keep synchronised with the web
 * `AuditEventKind` type and the filter dropdown.
 */
export type AuditEventKind =
  // Identity
  | "user.login"
  | "user.logout"
  // Accounting posting flow
  | "journal.post"
  | "journal.void"
  // JE approval workflow (legacy per-domain path)
  | "journal.approve"
  | "journal.reject"
  // Generic approval engine (roadmap #43) — fires from /approvals routes
  // regardless of source document type. diff carries documentType.
  | "approval.decide"
  | "approval.cancel"
  // Period locking
  | "period.close"
  | "period.reopen"
  | "period.close_year"
  // Document void / high-impact edits
  | "invoice.void"
  | "bill.void"
  | "payment.void"
  | "supplier_payment.void"
  // AR hygiene
  | "bad_debt.writeoff"
  | "bad_debt.reverse"
  | "customer.credit_hold"
  | "customer.credit_release"
  // HR
  | "employee.exit"
  | "employee.confirm_probation"
  | "salary_revision.create"
  | "payroll.post"
  | "payroll.void"
  | "final_settlement.created"
  | "final_settlement.approved"
  | "final_settlement.posted"
  | "final_settlement.cancelled"
  // Settings
  | "settings.update"
  | "number_series.update"
  // Customer portal
  | "portal.login"
  | "portal.logout"
  | "portal.verify_failed"
  | "portal.access_toggled";

export interface RecordAuditInput {
  kind: AuditEventKind;
  summary: string;
  refType?: string | null;
  refId?: string | null;
  diff?: Record<string, unknown> | null;
  actorUserId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Write an audit event. Must be called inside a `withTenant(tenantId, ...)`
 * transaction so the RLS check against `current_tenant_id()` passes.
 *
 * By convention:
 *   - `summary` is a one-line human-readable string shown in the viewer list.
 *   - `diff` holds the machine-readable detail. Shape is event-specific.
 *     Common shapes: `{ before, after }`, `{ context: {...} }`,
 *     `{ entryNumber, lines: [...] }`.
 *   - `refType` + `refId` enable deep-linking from the viewer back to the
 *     affected domain object. Supported refTypes and their frontend routes:
 *     journal_entry → /app/journals/:id, invoice → /app/invoices/:id,
 *     bill → /app/bills/:id, employee → /app/employees/:id,
 *     period → /app/accounting/periods, customer → /app/customers/:id.
 *
 * Never throws on audit-write failure — logs and swallows. The audit log
 * is a secondary store; taking down the primary action because we couldn't
 * record it is worse than a gap in the log.
 */
export async function recordAuditEvent(
  tx: Database,
  input: RecordAuditInput,
): Promise<void> {
  try {
    await tx.execute(sql`
      INSERT INTO audit_events (
        tenant_id, actor_user_id, kind, ref_type, ref_id,
        summary, diff, ip_address, user_agent
      )
      VALUES (
        current_tenant_id(),
        ${input.actorUserId ?? null}::uuid,
        ${input.kind}::varchar,
        ${input.refType ?? null}::varchar,
        ${input.refId ?? null}::uuid,
        ${input.summary}::text,
        ${input.diff ? JSON.stringify(input.diff) : null}::jsonb,
        ${input.ipAddress ?? null}::inet,
        ${input.userAgent ?? null}::varchar
      )
    `);
  } catch (err) {
    // Swallow — never let an audit-write failure break the primary flow.
    // Use console so we don't depend on a fastify logger handle here.
    // eslint-disable-next-line no-console
    console.error("audit write failed", { kind: input.kind, err });
  }
}
