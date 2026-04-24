import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema, withTenant } from "@pettahpro/db";
import { destroySession } from "../identity/sessions.js";
import { recordAuditEvent } from "../../lib/audit.js";
import { recordPlatformAuditEvent } from "../platform-admin/audit.js";
import { requireAuth } from "../../lib/with-tenant.js";

/**
 * Operator impersonation — tenant side (#57 / gap L1 v1).
 *
 * Mounted under /impersonation-requests and /impersonation-sessions.
 * Tenant users hit these to:
 *   - see pending platform requests against their books
 *   - approve / refuse requests (OWNER ONLY — non-owners get 403)
 *   - revoke an active impersonation session (OWNER ONLY)
 *
 * Why Owner-only for approve/refuse/revoke: the whole premise of this
 * feature is that the tenant is in control. A non-owner saying "sure,
 * log into our books" doesn't carry enough authority — we want the
 * person who owns the business liability for that tenant to make
 * the call. Ops folks assigning a role to an assistant doesn't
 * override that.
 *
 * Approval is "I'm lending you MY seat": the Owner who approves is
 * also the tenant user the platform operator logs in AS. We snapshot
 * the Owner's email + id into impersonation_requests.approved_by_*
 * so the platform-side `start` route has all it needs.
 */

const ApproveSchema = z.object({
  minutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
});

const RefuseSchema = z.object({
  reason: z.string().trim().min(3).max(2000),
});

const RevokeSchema = z.object({
  reason: z.string().trim().min(3).max(2000),
});

async function requireOwner(
  ctx: { tenantId: string; userId: string },
): Promise<{ email: string; isOwner: boolean } | null> {
  const [u] = await db
    .select({
      email: schema.users.email,
      isOwner: schema.users.isOwner,
      isActive: schema.users.isActive,
      deletedAt: schema.users.deletedAt,
    })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.id, ctx.userId),
        eq(schema.users.tenantId, ctx.tenantId),
      ),
    )
    .limit(1);
  if (!u || !u.isActive || u.deletedAt) return null;
  return { email: u.email, isOwner: u.isOwner };
}

export const impersonationRoutes: FastifyPluginAsync = async (fastify) => {
  // ---------------------------------------------------------------
  // GET /impersonation-requests
  //
  // Every authenticated tenant user can see the list — transparency
  // matters more than confidentiality here. Non-owners just can't
  // act on them.
  // ---------------------------------------------------------------
  fastify.get("/requests", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    await db.execute(sql`SELECT impersonation_sweep_expired()`);

    const rows = await db
      .select({
        id: schema.impersonationRequests.id,
        requestingPlatformUserEmail:
          schema.impersonationRequests.requestingPlatformUserEmail,
        requestedMinutes: schema.impersonationRequests.requestedMinutes,
        reason: schema.impersonationRequests.reason,
        status: schema.impersonationRequests.status,
        approvedByUserEmail: schema.impersonationRequests.approvedByUserEmail,
        approvedMinutes: schema.impersonationRequests.approvedMinutes,
        approvedAt: schema.impersonationRequests.approvedAt,
        refusedAt: schema.impersonationRequests.refusedAt,
        refusedReason: schema.impersonationRequests.refusedReason,
        expiresAt: schema.impersonationRequests.expiresAt,
        createdAt: schema.impersonationRequests.createdAt,
      })
      .from(schema.impersonationRequests)
      .where(eq(schema.impersonationRequests.targetTenantId, ctx.tenantId))
      .orderBy(desc(schema.impersonationRequests.createdAt))
      .limit(100);

    return reply.send({ requests: rows });
  });

  // ---------------------------------------------------------------
  // POST /impersonation-requests/:id/approve
  //
  // Owner-only. Snapshots the owner's identity into the request so
  // platform-side `start` can mint a session as this owner.
  // ---------------------------------------------------------------
  fastify.post<{ Params: { id: string } }>(
    "/requests/:id/approve",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;
      const who = await requireOwner(ctx);
      if (!who) {
        return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
      }
      if (!who.isOwner) {
        return reply.status(403).send({
          error: {
            code: "OWNER_ONLY",
            message: "Only a business owner can approve impersonation.",
          },
        });
      }

      const parsed = ApproveSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "INVALID_INPUT", issues: parsed.error.issues },
        });
      }

      const [r] = await db
        .select()
        .from(schema.impersonationRequests)
        .where(
          and(
            eq(schema.impersonationRequests.id, req.params.id),
            eq(schema.impersonationRequests.targetTenantId, ctx.tenantId),
          ),
        )
        .limit(1);
      if (!r) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Request not found." } });
      }
      if (r.status !== "pending") {
        return reply.status(409).send({
          error: {
            code: "NOT_PENDING",
            message: `This request is ${r.status}, not pending.`,
          },
        });
      }
      if (new Date(r.expiresAt).getTime() < Date.now()) {
        return reply.status(409).send({
          error: {
            code: "EXPIRED",
            message: "This request has expired. Ask support to send a fresh one.",
          },
        });
      }

      // Owner-picked window can be ≤ the requested window but we
      // allow any of 15/30/60 regardless — the operator asked for
      // 60 minutes, the Owner can say "fine, but 15." It would be
      // tempting to also allow a number higher than requested,
      // but the request establishes the upper-bound at the consent
      // step so we keep it that way.
      const approvedMinutes = Math.min(
        parsed.data.minutes,
        r.requestedMinutes,
      ) as 15 | 30 | 60;

      await db
        .update(schema.impersonationRequests)
        .set({
          status: "approved",
          approvedByUserId: ctx.userId,
          approvedByUserEmail: who.email,
          approvedMinutes,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.impersonationRequests.id, r.id));

      await withTenant(ctx.tenantId, async (tx) => {
        await recordAuditEvent(tx, {
          kind: "impersonation.approved",
          summary: `Owner approved impersonation by ${r.requestingPlatformUserEmail} (${approvedMinutes}m)`,
          refType: "impersonation_request",
          refId: r.id,
          actorUserId: ctx.userId,
          diff: {
            requestingPlatformUserEmail: r.requestingPlatformUserEmail,
            requestedMinutes: r.requestedMinutes,
            approvedMinutes,
          },
          ipAddress: req.ip ?? null,
          userAgent: req.headers["user-agent"] ?? null,
        });
      });

      await recordPlatformAuditEvent({
        platformUserId: r.requestingPlatformUserId ?? "",
        platformUserEmail: r.requestingPlatformUserEmail,
        kind: "platform.impersonation_approved",
        summary: `Tenant owner ${who.email} approved (${approvedMinutes}m)`,
        tenantId: ctx.tenantId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        metadata: {
          requestId: r.id,
          approverEmail: who.email,
          approvedMinutes,
        },
      });

      return reply.send({ ok: true, approvedMinutes });
    },
  );

  // ---------------------------------------------------------------
  // POST /impersonation-requests/:id/refuse
  //
  // Owner-only. Captures a reason — useful for ops follow-up
  // ("we refused because the issue is resolved").
  // ---------------------------------------------------------------
  fastify.post<{ Params: { id: string } }>(
    "/requests/:id/refuse",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;
      const who = await requireOwner(ctx);
      if (!who) {
        return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
      }
      if (!who.isOwner) {
        return reply.status(403).send({
          error: {
            code: "OWNER_ONLY",
            message: "Only a business owner can refuse impersonation.",
          },
        });
      }

      const parsed = RefuseSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "INVALID_INPUT", issues: parsed.error.issues },
        });
      }

      const [r] = await db
        .select()
        .from(schema.impersonationRequests)
        .where(
          and(
            eq(schema.impersonationRequests.id, req.params.id),
            eq(schema.impersonationRequests.targetTenantId, ctx.tenantId),
          ),
        )
        .limit(1);
      if (!r) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Request not found." } });
      }
      if (r.status !== "pending") {
        return reply.status(409).send({
          error: {
            code: "NOT_PENDING",
            message: `This request is ${r.status}, not pending.`,
          },
        });
      }

      await db
        .update(schema.impersonationRequests)
        .set({
          status: "refused",
          refusedByUserId: ctx.userId,
          refusedAt: new Date(),
          refusedReason: parsed.data.reason,
          updatedAt: new Date(),
        })
        .where(eq(schema.impersonationRequests.id, r.id));

      await withTenant(ctx.tenantId, async (tx) => {
        await recordAuditEvent(tx, {
          kind: "impersonation.refused",
          summary: `Owner refused impersonation by ${r.requestingPlatformUserEmail}`,
          refType: "impersonation_request",
          refId: r.id,
          actorUserId: ctx.userId,
          diff: {
            requestingPlatformUserEmail: r.requestingPlatformUserEmail,
            reason: parsed.data.reason,
          },
          ipAddress: req.ip ?? null,
          userAgent: req.headers["user-agent"] ?? null,
        });
      });

      await recordPlatformAuditEvent({
        platformUserId: r.requestingPlatformUserId ?? "",
        platformUserEmail: r.requestingPlatformUserEmail,
        kind: "platform.impersonation_refused",
        summary: `Tenant owner ${who.email} refused`,
        reason: parsed.data.reason,
        tenantId: ctx.tenantId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        metadata: { requestId: r.id, refuserEmail: who.email },
      });

      return reply.send({ ok: true });
    },
  );

  // ---------------------------------------------------------------
  // GET /impersonation-sessions/active
  //
  // Active sessions against this tenant. Used by the Settings →
  // Security "Active platform access" card and by the global
  // <ImpersonationBanner /> to render the red banner.
  // ---------------------------------------------------------------
  fastify.get("/sessions/active", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    await db.execute(sql`SELECT impersonation_sweep_expired()`);

    const rows = await db
      .select({
        id: schema.impersonationSessions.id,
        platformUserEmail: schema.impersonationSessions.platformUserEmail,
        targetUserEmail: schema.impersonationSessions.targetUserEmail,
        startedAt: schema.impersonationSessions.startedAt,
        endsAt: schema.impersonationSessions.endsAt,
      })
      .from(schema.impersonationSessions)
      .where(
        and(
          eq(schema.impersonationSessions.targetTenantId, ctx.tenantId),
          isNull(schema.impersonationSessions.endedAt),
        ),
      )
      .orderBy(desc(schema.impersonationSessions.startedAt));

    return reply.send({ sessions: rows });
  });

  // ---------------------------------------------------------------
  // POST /impersonation-sessions/:id/revoke
  //
  // Owner-only. Tenant panic button — destroys the minted tenant
  // session so the platform operator's next request gets 401.
  // ---------------------------------------------------------------
  fastify.post<{ Params: { id: string } }>(
    "/sessions/:id/revoke",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;
      const who = await requireOwner(ctx);
      if (!who) {
        return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
      }
      if (!who.isOwner) {
        return reply.status(403).send({
          error: {
            code: "OWNER_ONLY",
            message: "Only a business owner can revoke impersonation.",
          },
        });
      }

      const parsed = RevokeSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "INVALID_INPUT", issues: parsed.error.issues },
        });
      }

      const [s] = await db
        .select()
        .from(schema.impersonationSessions)
        .where(
          and(
            eq(schema.impersonationSessions.id, req.params.id),
            eq(schema.impersonationSessions.targetTenantId, ctx.tenantId),
          ),
        )
        .limit(1);
      if (!s) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Session not found." } });
      }
      if (s.endedAt) {
        return reply.send({ ok: true, alreadyEnded: true });
      }

      await db
        .update(schema.impersonationSessions)
        .set({
          endedAt: new Date(),
          endedBy: "tenant",
          endedReason: parsed.data.reason,
        })
        .where(eq(schema.impersonationSessions.id, s.id));

      await destroySession(s.sessionId);

      await withTenant(ctx.tenantId, async (tx) => {
        await recordAuditEvent(tx, {
          kind: "impersonation.ended",
          summary: `Owner ${who.email} revoked impersonation by ${s.platformUserEmail}`,
          refType: "impersonation_session",
          refId: s.id,
          actorUserId: ctx.userId,
          diff: {
            endedBy: "tenant",
            reason: parsed.data.reason,
            platformUserEmail: s.platformUserEmail,
          },
          ipAddress: req.ip ?? null,
          userAgent: req.headers["user-agent"] ?? null,
        });
      });

      await recordPlatformAuditEvent({
        platformUserId: s.platformUserId ?? "",
        platformUserEmail: s.platformUserEmail,
        kind: "platform.impersonation_ended",
        summary: `Tenant owner ${who.email} revoked`,
        reason: parsed.data.reason,
        tenantId: ctx.tenantId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        metadata: { sessionId: s.id, endedBy: "tenant" },
      });

      return reply.send({ ok: true });
    },
  );
};
