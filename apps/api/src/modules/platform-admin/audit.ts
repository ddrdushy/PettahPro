import { db, schema } from "@pettahpro/db";

/**
 * Insert a row into platform_audit_log. Insert-only — this table has no
 * UPDATE/DELETE grants, by design.
 *
 * Unlike the tenant audit log, this one is outside RLS entirely, so no
 * withTenant wrapper. Pass the platform user + optional tenant scope
 * (set when the action is targeted at a specific tenant; null for
 * platform-wide actions like login/logout).
 */
export async function recordPlatformAuditEvent(input: {
  platformUserId: string;
  platformUserEmail: string;
  kind: string;
  summary: string;
  reason?: string | null;
  tenantId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(schema.platformAuditLog).values({
      platformUserId: input.platformUserId,
      platformUserEmail: input.platformUserEmail,
      kind: input.kind,
      summary: input.summary,
      reason: input.reason ?? null,
      tenantId: input.tenantId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ? input.userAgent.slice(0, 512) : null,
      metadata: input.metadata ?? {},
    });
  } catch (err) {
    // Don't let an audit-write failure surface as a user-visible 500.
    // The operational action itself (suspend / reactivate / login)
    // already succeeded by the time this runs; better to log and move
    // on than to roll back a legitimate state change. Missing audit
    // rows are findable from the state diff later.
    // eslint-disable-next-line no-console
    console.error("platform audit write failed", err);
  }
}
