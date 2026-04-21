import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { withTenant } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

/**
 * Notifications are scoped per (tenant, user). A row with user_id = NULL is
 * a broadcast visible to every user in the tenant — we union it in at read
 * time. Mark-read on a broadcast creates a per-user receipt by cloning the
 * row with the current user_id set (simplest model without a separate
 * receipts table; ~10× read cost for broadcasts is fine at current volume).
 *
 * For v1 we keep it even simpler: mark-read only works on rows that already
 * have the caller's user_id. Broadcasts stay "unread" until a per-user copy
 * is explicitly created. If broadcasts turn out to matter (platform
 * announcements), we'll add the receipts table then.
 */

export const notificationsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /notifications?limit=20 — recent items for the bell dropdown
  fastify.get<{ Querystring: { limit?: string } }>(
    "/",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const limit = Math.min(Math.max(Number(req.query.limit ?? 20), 1), 100);

      const rows = await withTenant(ctx.tenantId, async (tx) => {
        return (await tx.execute(sql`
          SELECT id, kind, title, body, ref_type, ref_id,
                 read_at, created_at,
                 (user_id IS NULL) AS is_broadcast
          FROM notifications
          WHERE tenant_id = current_tenant_id()
            AND (user_id = ${ctx.userId}::uuid OR user_id IS NULL)
          ORDER BY (read_at IS NULL) DESC, created_at DESC
          LIMIT ${limit}
        `)) as unknown as Array<{
          id: string;
          kind: string;
          title: string;
          body: string | null;
          ref_type: string | null;
          ref_id: string | null;
          read_at: string | null;
          created_at: string;
          is_broadcast: boolean;
        }>;
      });

      return reply.send({
        notifications: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          title: r.title,
          body: r.body,
          refType: r.ref_type,
          refId: r.ref_id,
          readAt: r.read_at,
          createdAt: r.created_at,
          isBroadcast: r.is_broadcast,
        })),
      });
    },
  );

  // GET /notifications/unread-count — tiny endpoint polled by the bell
  fastify.get("/unread-count", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const [row] = await withTenant(ctx.tenantId, async (tx) => {
      return (await tx.execute(sql`
        SELECT COUNT(*)::int AS n
        FROM notifications
        WHERE tenant_id = current_tenant_id()
          AND read_at IS NULL
          AND (user_id = ${ctx.userId}::uuid OR user_id IS NULL)
      `)) as unknown as Array<{ n: number }>;
    });

    return reply.send({ count: Number(row?.n ?? 0) });
  });

  // POST /notifications/:id/read — mark one notification read
  fastify.post<{ Params: { id: string } }>("/:id/read", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    await withTenant(ctx.tenantId, async (tx) => {
      await tx.execute(sql`
        UPDATE notifications
        SET read_at = now()
        WHERE tenant_id = current_tenant_id()
          AND id = ${req.params.id}::uuid
          AND user_id = ${ctx.userId}::uuid
          AND read_at IS NULL
      `);
    });

    return reply.send({ ok: true });
  });

  // POST /notifications/read-all — mark every unread notification read for this user
  fastify.post("/read-all", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rowCount = await withTenant(ctx.tenantId, async (tx) => {
      const result = await tx.execute(sql`
        UPDATE notifications
        SET read_at = now()
        WHERE tenant_id = current_tenant_id()
          AND user_id = ${ctx.userId}::uuid
          AND read_at IS NULL
      `);
      // drizzle returns { rowsAffected } on postgres-js via the underlying
      // result. Fall through to 0 if not present.
      return (result as unknown as { rowsAffected?: number }).rowsAffected ?? 0;
    });

    return reply.send({ ok: true, markedRead: rowCount });
  });
};
