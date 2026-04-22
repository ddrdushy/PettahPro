import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

// Viewer API for the audit log. Read-only — writes happen inline in the
// feature routes via recordAuditEvent. See apps/api/src/lib/audit.ts for
// the writer + current list of `kind` strings.

// Query schema for the list endpoint. All filters are optional and
// compose. When neither from nor to is supplied we default to the last
// 30 days — the viewer is a governance tool, not a forever-scroll.
const ListQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  kind: z.string().max(64).optional(),
  actorUserId: z.string().uuid().optional(),
  refType: z.string().max(64).optional(),
  refId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const auditLogRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /audit-log — filtered list. Sorted newest first; the table index
  // (tenant_id, created_at DESC) keeps the unfiltered case snappy.
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = ListQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const q = parsed.data;

    // Default window: last 30 days. Keeps the initial page snappy and
    // forces the user to opt in to deeper scans via explicit from.
    const to = q.to ?? new Date().toISOString().slice(0, 10);
    const from =
      q.from ??
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT ae.id,
               ae.kind,
               ae.ref_type,
               ae.ref_id,
               ae.summary,
               ae.diff,
               ae.actor_user_id,
               u.full_name AS actor_name,
               u.email     AS actor_email,
               ae.ip_address::text AS ip_address,
               ae.user_agent,
               ae.created_at
          FROM audit_events ae
          LEFT JOIN users u ON u.id = ae.actor_user_id
         WHERE ae.tenant_id = current_tenant_id()
           AND ae.created_at >= ${from}::date
           AND ae.created_at <  (${to}::date + interval '1 day')
           AND (${q.kind ?? null}::varchar IS NULL OR ae.kind = ${q.kind ?? null})
           AND (${q.actorUserId ?? null}::uuid IS NULL OR ae.actor_user_id = ${q.actorUserId ?? null}::uuid)
           AND (${q.refType ?? null}::varchar IS NULL OR ae.ref_type = ${q.refType ?? null})
           AND (${q.refId ?? null}::uuid IS NULL OR ae.ref_id = ${q.refId ?? null}::uuid)
         ORDER BY ae.created_at DESC
         LIMIT ${q.limit}
        OFFSET ${q.offset}
      `)) as unknown as Array<{
        id: string;
        kind: string;
        ref_type: string | null;
        ref_id: string | null;
        summary: string;
        diff: Record<string, unknown> | null;
        actor_user_id: string | null;
        actor_name: string | null;
        actor_email: string | null;
        ip_address: string | null;
        user_agent: string | null;
        created_at: string;
      }>;

      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        refType: r.ref_type,
        refId: r.ref_id,
        summary: r.summary,
        diff: r.diff,
        actorUserId: r.actor_user_id,
        actorName: r.actor_name,
        actorEmail: r.actor_email,
        ipAddress: r.ip_address,
        userAgent: r.user_agent,
        createdAt: r.created_at,
      }));
    });

    return reply.send({
      events: data,
      filters: { from, to, kind: q.kind ?? null, actorUserId: q.actorUserId ?? null, refType: q.refType ?? null, refId: q.refId ?? null },
      paging: { limit: q.limit, offset: q.offset },
    });
  });

  // GET /audit-log/kinds — distinct list of event kinds actually used by
  // this tenant. Powers the filter dropdown so users only see kinds
  // they've produced, not the full global enum.
  fastify.get("/kinds", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) => {
      return (await tx.execute(sql`
        SELECT kind, COUNT(*)::int AS count
          FROM audit_events
         WHERE tenant_id = current_tenant_id()
         GROUP BY kind
         ORDER BY kind ASC
      `)) as unknown as Array<{ kind: string; count: number }>;
    });
    return reply.send({ kinds: rows });
  });

  // GET /audit-log/:id — single event for the detail drawer. diff can be
  // large, so the list endpoint returns it too (no extra round-trip),
  // but this is here for deep-links and for future diff-rendering views.
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT ae.id,
               ae.kind,
               ae.ref_type,
               ae.ref_id,
               ae.summary,
               ae.diff,
               ae.actor_user_id,
               u.full_name AS actor_name,
               u.email     AS actor_email,
               ae.ip_address::text AS ip_address,
               ae.user_agent,
               ae.created_at
          FROM audit_events ae
          LEFT JOIN users u ON u.id = ae.actor_user_id
         WHERE ae.tenant_id = current_tenant_id()
           AND ae.id = ${req.params.id}::uuid
         LIMIT 1
      `)) as unknown as Array<{
        id: string;
        kind: string;
        ref_type: string | null;
        ref_id: string | null;
        summary: string;
        diff: Record<string, unknown> | null;
        actor_user_id: string | null;
        actor_name: string | null;
        actor_email: string | null;
        ip_address: string | null;
        user_agent: string | null;
        created_at: string;
      }>;
      return rows[0] ?? null;
    });

    if (!data) {
      return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    }
    return reply.send({
      event: {
        id: data.id,
        kind: data.kind,
        refType: data.ref_type,
        refId: data.ref_id,
        summary: data.summary,
        diff: data.diff,
        actorUserId: data.actor_user_id,
        actorName: data.actor_name,
        actorEmail: data.actor_email,
        ipAddress: data.ip_address,
        userAgent: data.user_agent,
        createdAt: data.created_at,
      },
    });
  });
};
