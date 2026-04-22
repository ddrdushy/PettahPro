import type { FastifyRequest, FastifyReply } from "fastify";
import { sql } from "drizzle-orm";
import { withTenant } from "@pettahpro/db";
import { requireAuth } from "./with-tenant.js";

// Per-route permission enforcement — roadmap #42, follow-up to #27.
//
// The role + permissions data model shipped in PR #63. This file is
// the enforcement layer: `requirePermission(req, reply, "invoices.post")`
// returns `{tenantId, userId}` on pass and sends a 403 on deny, so
// call sites swap `const ctx = requireAuth(...)` for
// `const ctx = await requirePermission(...)` with no other change.
//
// Three passes let a request through:
//
//   1. users.is_owner = true                   — owner bypass. Owners
//      can't have permissions stripped beneath them (tenant-admin §3.4).
//
//   2. The tenant has ZERO user_role assignments
//                                              — enforcement is dormant.
//      This is the migration safety valve: every existing tenant keeps
//      working on deploy. Once an admin assigns ANY role to ANY user,
//      enforcement activates for everyone in that tenant. This is a
//      deliberate opt-in: "turn on RBAC by assigning your first role."
//      Simpler than a tenant-level feature flag and self-discoverable.
//
//   3. The caller has a role whose permissions JSON maps
//      `{permission: true}`                    — normal allow path.
//      Union across all roles the user holds (user_roles many-to-many).
//
// Anything else → 403 FORBIDDEN with the missing permission in the
// error body so the UI can show a useful message.
//
// Cost: one SQL round-trip per gated request. The query is keyed on
// indexed columns (user_roles.user_id, roles.id) so it's cheap.

export async function requirePermission(
  req: FastifyRequest,
  reply: FastifyReply,
  permission: string,
): Promise<{ tenantId: string; userId: string } | null> {
  const ctx = requireAuth(req, reply);
  if (!ctx) return null;

  const result = await withTenant(ctx.tenantId, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT
        (SELECT is_owner FROM users WHERE id = ${ctx.userId} AND tenant_id = ${ctx.tenantId}) AS is_owner,
        EXISTS(SELECT 1 FROM user_roles WHERE tenant_id = ${ctx.tenantId}) AS tenant_has_assignments,
        COALESCE(
          (
            SELECT BOOL_OR((r.permissions ->> ${permission})::boolean)
            FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
            WHERE ur.user_id = ${ctx.userId} AND ur.tenant_id = ${ctx.tenantId}
          ),
          false
        ) AS allowed
    `)) as unknown as Array<{
      is_owner: boolean | null;
      tenant_has_assignments: boolean;
      allowed: boolean;
    }>;
    return rows[0] ?? { is_owner: false, tenant_has_assignments: false, allowed: false };
  });

  // Owner bypass — always allow.
  if (result.is_owner === true) return ctx;

  // Dormant mode — no role assignments anywhere in the tenant.
  // Existing tenants without RBAC configured keep working unchanged.
  if (!result.tenant_has_assignments) return ctx;

  // Normal allow path — at least one of the user's roles grants the permission.
  if (result.allowed === true) return ctx;

  reply.status(403).send({
    error: {
      code: "FORBIDDEN",
      permission,
      message: `Missing permission: ${permission}`,
    },
  });
  return null;
}

// Fetch the full permission picture for the authenticated caller.
// Used by GET /me/permissions so the web app can hide buttons it
// knows will 403. Returns `{ isOwner, enforcementActive, permissions }`.
// `enforcementActive` mirrors rule (2) above — when false, the UI
// should treat every permission as granted (dormant mode).
export async function getCallerPermissions(
  tenantId: string,
  userId: string,
): Promise<{
  isOwner: boolean;
  enforcementActive: boolean;
  permissions: Record<string, boolean>;
}> {
  return withTenant(tenantId, async (tx) => {
    const summary = (await tx.execute(sql`
      SELECT
        (SELECT is_owner FROM users WHERE id = ${userId} AND tenant_id = ${tenantId}) AS is_owner,
        EXISTS(SELECT 1 FROM user_roles WHERE tenant_id = ${tenantId}) AS tenant_has_assignments
    `)) as unknown as Array<{ is_owner: boolean | null; tenant_has_assignments: boolean }>;
    const s = summary[0] ?? { is_owner: false, tenant_has_assignments: false };

    // Union of all permission keys the caller's roles grant.
    const permRows = (await tx.execute(sql`
      SELECT DISTINCT perm.key
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
      CROSS JOIN LATERAL jsonb_each_text(r.permissions) AS perm(key, value)
      WHERE ur.user_id = ${userId}
        AND ur.tenant_id = ${tenantId}
        AND perm.value = 'true'
    `)) as unknown as Array<{ key: string }>;

    const permissions: Record<string, boolean> = {};
    for (const row of permRows) permissions[row.key] = true;

    return {
      isOwner: s.is_owner === true,
      enforcementActive: s.tenant_has_assignments === true,
      permissions,
    };
  });
}
