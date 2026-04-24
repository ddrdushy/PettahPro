import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, schema, withTenant } from "@pettahpro/db";
import { createSession, destroySession } from "../identity/sessions.js";
import { emitNotification } from "../notifications/emit.js";
import { recordAuditEvent } from "../../lib/audit.js";
import { recordPlatformAuditEvent } from "./audit.js";
import {
  requirePlatformRole,
  requirePlatformSession,
} from "./routes.js";

/**
 * Operator impersonation — platform side (#57 / gap L1 v1).
 *
 * Split into its own file because the parent routes.ts is already
 * ~1600 lines and this feature is a self-contained subdomain. Mounted
 * from plugin.ts alongside platformAdminRoutes under /platform.
 *
 * Permission summary (see spec: super-admin-layer1-spec.md §7):
 *   - Request: super_admin + support. (Billing never touches
 *     tenant business data, so they cannot request.)
 *   - Approve / refuse: ONLY the target tenant's Owner. Lives in
 *     the tenant-side routes module, not here.
 *   - Start: only the platform user who requested. Super-admin
 *     override NOT allowed — consent is for the specific operator,
 *     not "any platform staff."
 *   - Force-end (platform): super_admin can end any session.
 *     support can end only their own.
 *
 * Every route writes a platform_audit_log row. Tenant-visible events
 * (request created, session started, session ended) also write a
 * tenant-side audit_events row via withTenant + recordAuditEvent so
 * the tenant's own audit viewer sees the full picture.
 */

const SESSION_TTL_DEFAULT_MINUTES = 30;

// Pending request window — a pending request auto-expires after 24h
// without Owner action. See impersonation_sweep_expired().
const REQUEST_EXPIRY_MINUTES = 60 * 24;

const CreateRequestSchema = z.object({
  requestedMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  reason: z.string().trim().min(10).max(2000),
});

const ListRequestsQuerySchema = z.object({
  status: z
    .enum(["pending", "approved", "refused", "expired", "cancelled", "all"])
    .optional()
    .default("all"),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const EndSessionSchema = z.object({
  reason: z.string().trim().min(3).max(2000),
});

export const platformImpersonationRoutes: FastifyPluginAsync = async (
  fastify,
) => {
  // -----------------------------------------------------------------
  // POST /platform/tenants/:tenantId/impersonation-requests
  //
  // Create a new request for support/super_admin to impersonate a
  // tenant Owner. No session is minted here — this is just the
  // permission slip. Must be approved by an Owner before /start
  // will work.
  // -----------------------------------------------------------------
  fastify.post<{ Params: { tenantId: string } }>(
    "/tenants/:tenantId/impersonation-requests",
    async (req, reply) => {
      const session = await requirePlatformSession(req, reply);
      if (!session) return;
      // Billing role is deliberately excluded — they don't need to
      // see inside a tenant's books to do plan / refund ops.
      if (
        !(await requirePlatformRole(req, reply, session, [
          "super_admin",
          "support",
        ]))
      )
        return;

      const parsed = CreateRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "INVALID_INPUT", issues: parsed.error.issues },
        });
      }
      const { requestedMinutes, reason } = parsed.data;
      const { tenantId } = req.params;

      // Verify tenant exists + is not suspended. A suspended tenant's
      // books are readable platform-side already; no legitimate reason
      // to impersonate into one.
      const [tenant] = await db
        .select({
          id: schema.tenants.id,
          status: schema.tenants.status,
          businessName: schema.tenants.businessName,
        })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenantId))
        .limit(1);
      if (!tenant) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Tenant not found." } });
      }
      if (tenant.status === "suspended") {
        return reply.status(409).send({
          error: {
            code: "TENANT_SUSPENDED",
            message:
              "Can't request impersonation on a suspended tenant. Reactivate first if you need access.",
          },
        });
      }

      const expiresAt = new Date(
        Date.now() + REQUEST_EXPIRY_MINUTES * 60 * 1000,
      );

      const [row] = await db
        .insert(schema.impersonationRequests)
        .values({
          requestingPlatformUserId: session.platformUserId,
          requestingPlatformUserEmail: session.email,
          targetTenantId: tenantId,
          requestedMinutes,
          reason,
          status: "pending",
          expiresAt,
        })
        .returning({
          id: schema.impersonationRequests.id,
          createdAt: schema.impersonationRequests.createdAt,
          expiresAt: schema.impersonationRequests.expiresAt,
        });
      if (!row) throw new Error("Impersonation request insert failed");

      // Notify every active tenant Owner + write the tenant-side
      // audit row so the request is visible inside the business's
      // own audit log.
      await withTenant(tenantId, async (tx) => {
        const owners = await tx
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(
            and(
              eq(schema.users.tenantId, tenantId),
              eq(schema.users.isOwner, true),
              eq(schema.users.isActive, true),
              isNull(schema.users.deletedAt),
            ),
          );
        for (const o of owners) {
          await emitNotification(tx, {
            tenantId,
            userId: o.id,
            kind: "impersonation.requested",
            title: "PettahPro support requests access to your books",
            body: `${session.email} wants ${requestedMinutes} minutes of operator access to help you. You decide — approve or refuse from Settings → Security.`,
            refType: "impersonation_request",
            refId: row.id,
          });
        }

        await recordAuditEvent(tx, {
          kind: "impersonation.requested",
          summary: `Platform impersonation request: ${session.email} (${requestedMinutes}m)`,
          refType: "impersonation_request",
          refId: row.id,
          diff: {
            requestingPlatformUserEmail: session.email,
            requestedMinutes,
            reason,
            expiresAt: row.expiresAt,
          },
          ipAddress: req.ip ?? null,
          userAgent: req.headers["user-agent"] ?? null,
        });
      });

      await recordPlatformAuditEvent({
        platformUserId: session.platformUserId,
        platformUserEmail: session.email,
        kind: "platform.impersonation_requested",
        summary: `Requested ${requestedMinutes}m impersonation of ${tenant.businessName}`,
        reason,
        tenantId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        metadata: { requestId: row.id, requestedMinutes },
      });

      return reply.status(201).send({ id: row.id });
    },
  );

  // -----------------------------------------------------------------
  // GET /platform/impersonation-requests
  //
  // List platform-side requests. super_admin sees all; support sees
  // only their own. Powers the /platform/impersonation history page.
  // -----------------------------------------------------------------
  fastify.get("/impersonation-requests", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    if (
      !(await requirePlatformRole(req, reply, session, [
        "super_admin",
        "support",
      ]))
    )
      return;

    await db.execute(sql`SELECT impersonation_sweep_expired()`);

    const parsed = ListRequestsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "INVALID_INPUT", issues: parsed.error.issues },
      });
    }
    const { status, limit, offset } = parsed.data;

    const whereExprs = [];
    if (status !== "all")
      whereExprs.push(eq(schema.impersonationRequests.status, status));
    if (session.role !== "super_admin") {
      whereExprs.push(
        eq(
          schema.impersonationRequests.requestingPlatformUserId,
          session.platformUserId,
        ),
      );
    }

    const rows = await db
      .select({
        id: schema.impersonationRequests.id,
        requestingPlatformUserEmail:
          schema.impersonationRequests.requestingPlatformUserEmail,
        targetTenantId: schema.impersonationRequests.targetTenantId,
        tenantBusinessName: schema.tenants.businessName,
        tenantSlug: schema.tenants.slug,
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
      .leftJoin(
        schema.tenants,
        eq(schema.tenants.id, schema.impersonationRequests.targetTenantId),
      )
      .where(whereExprs.length ? and(...whereExprs) : undefined)
      .orderBy(desc(schema.impersonationRequests.createdAt))
      .limit(limit)
      .offset(offset);

    return reply.send({ requests: rows });
  });

  // -----------------------------------------------------------------
  // POST /platform/impersonation-requests/:id/start
  //
  // Given an approved-but-not-yet-started request, mint the tenant
  // session and set pp_session on the response. Browser then drives
  // the tenant app at /app/* with the impersonation stamp baked into
  // the session blob.
  //
  // Only the platform user who requested can start — consent was
  // granted to THEM specifically, not to any colleague who happens
  // to be super_admin.
  // -----------------------------------------------------------------
  fastify.post<{ Params: { id: string } }>(
    "/impersonation-requests/:id/start",
    async (req, reply) => {
      const session = await requirePlatformSession(req, reply);
      if (!session) return;
      if (
        !(await requirePlatformRole(req, reply, session, [
          "super_admin",
          "support",
        ]))
      )
        return;

      const [r] = await db
        .select()
        .from(schema.impersonationRequests)
        .where(eq(schema.impersonationRequests.id, req.params.id))
        .limit(1);
      if (!r) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Request not found." } });
      }
      if (r.requestingPlatformUserId !== session.platformUserId) {
        return reply.status(403).send({
          error: {
            code: "NOT_YOUR_REQUEST",
            message:
              "Only the requesting operator can start this session. Consent is per-person.",
          },
        });
      }
      if (r.status !== "approved") {
        return reply.status(409).send({
          error: {
            code: "NOT_APPROVED",
            message: `Request is ${r.status}, not approved.`,
          },
        });
      }
      if (!r.approvedByUserId || !r.approvedByUserEmail || !r.approvedMinutes) {
        // Should never happen — approved status without approval fields
        // would be a DB integrity problem. Fail loud rather than mint
        // a session against a half-filled row.
        return reply
          .status(500)
          .send({ error: { code: "APPROVAL_INCOMPLETE" } });
      }

      // Block double-start: an approved request can only mint once.
      // If an active session already exists for this request, refuse.
      const [active] = await db
        .select({ id: schema.impersonationSessions.id })
        .from(schema.impersonationSessions)
        .where(
          and(
            eq(schema.impersonationSessions.requestId, r.id),
            isNull(schema.impersonationSessions.endedAt),
          ),
        )
        .limit(1);
      if (active) {
        return reply.status(409).send({
          error: {
            code: "ALREADY_STARTED",
            message: "This request is already active.",
          },
        });
      }

      // Any previous session for this request was force-ended — still
      // refuse re-start. One approval = one session window.
      const [prior] = await db
        .select({ id: schema.impersonationSessions.id })
        .from(schema.impersonationSessions)
        .where(eq(schema.impersonationSessions.requestId, r.id))
        .limit(1);
      if (prior) {
        return reply.status(409).send({
          error: {
            code: "ALREADY_CONSUMED",
            message:
              "This request has already been used once. Ask for another.",
          },
        });
      }

      const minutes = r.approvedMinutes ?? SESSION_TTL_DEFAULT_MINUTES;
      const ttlSeconds = minutes * 60;
      const endsAt = new Date(Date.now() + ttlSeconds * 1000);

      const tenantSession = await createSession({
        userId: r.approvedByUserId,
        tenantId: r.targetTenantId,
        email: r.approvedByUserEmail,
        ttlSeconds,
        ip: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        impersonatedByPlatformUserId: session.platformUserId,
        impersonatedByPlatformUserEmail: session.email,
        impersonationEndsAt: Math.floor(endsAt.getTime() / 1000),
      });

      const [impSess] = await db
        .insert(schema.impersonationSessions)
        .values({
          requestId: r.id,
          platformUserId: session.platformUserId,
          platformUserEmail: session.email,
          targetTenantId: r.targetTenantId,
          targetUserId: r.approvedByUserId,
          targetUserEmail: r.approvedByUserEmail,
          sessionId: tenantSession.id,
          endsAt,
        })
        .returning({ id: schema.impersonationSessions.id });
      if (!impSess) throw new Error("Impersonation session insert failed");

      // Set pp_session + pp_csrf so the platform admin's browser drives
      // /app/* as the tenant user from this point forward.
      const { setSessionCookie, setCsrfCookie } = await import(
        "../identity/cookies.js"
      );
      setSessionCookie(reply, tenantSession.id, ttlSeconds);
      setCsrfCookie(reply, tenantSession.csrfToken, ttlSeconds);

      // Tenant-side audit: the act of someone logging in under
      // impersonation. Dual-actor fields are NOT populated from the
      // ALS here (we're mid-platform-route, no tenant session yet) —
      // we set the impersonator explicitly via the diff.
      await withTenant(r.targetTenantId, async (tx) => {
        await recordAuditEvent(tx, {
          kind: "impersonation.started",
          summary: `Platform operator ${session.email} started impersonation (${minutes}m)`,
          refType: "impersonation_session",
          refId: impSess.id,
          actorUserId: r.approvedByUserId,
          diff: {
            platformUserEmail: session.email,
            minutes,
            endsAt: endsAt.toISOString(),
            requestId: r.id,
          },
          ipAddress: req.ip ?? null,
          userAgent: req.headers["user-agent"] ?? null,
        });
      });

      await recordPlatformAuditEvent({
        platformUserId: session.platformUserId,
        platformUserEmail: session.email,
        kind: "platform.impersonation_started",
        summary: `Started impersonation (${minutes}m) of ${r.approvedByUserEmail}`,
        tenantId: r.targetTenantId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        metadata: {
          sessionId: impSess.id,
          requestId: r.id,
          minutes,
          endsAt: endsAt.toISOString(),
        },
      });

      return reply.send({
        ok: true,
        sessionId: impSess.id,
        endsAt: endsAt.toISOString(),
      });
    },
  );

  // -----------------------------------------------------------------
  // POST /platform/impersonation-sessions/:id/end
  //
  // Force-end an active impersonation session. super_admin can end
  // any; support can only end their own. The minted tenant session
  // is destroyed immediately (next /app/* request gets 401).
  // -----------------------------------------------------------------
  fastify.post<{ Params: { id: string } }>(
    "/impersonation-sessions/:id/end",
    async (req, reply) => {
      const session = await requirePlatformSession(req, reply);
      if (!session) return;
      if (
        !(await requirePlatformRole(req, reply, session, [
          "super_admin",
          "support",
        ]))
      )
        return;

      const parsed = EndSessionSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "INVALID_INPUT", issues: parsed.error.issues },
        });
      }

      const [s] = await db
        .select()
        .from(schema.impersonationSessions)
        .where(eq(schema.impersonationSessions.id, req.params.id))
        .limit(1);
      if (!s) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Session not found." } });
      }
      if (s.endedAt) {
        return reply.send({ ok: true, alreadyEnded: true });
      }
      if (
        session.role !== "super_admin" &&
        s.platformUserId !== session.platformUserId
      ) {
        return reply.status(403).send({
          error: {
            code: "NOT_YOUR_SESSION",
            message:
              "Only super admins can end other operators' impersonation sessions.",
          },
        });
      }

      await db
        .update(schema.impersonationSessions)
        .set({
          endedAt: new Date(),
          endedBy: "platform",
          endedReason: parsed.data.reason,
        })
        .where(eq(schema.impersonationSessions.id, s.id));

      await destroySession(s.sessionId);

      await withTenant(s.targetTenantId, async (tx) => {
        await recordAuditEvent(tx, {
          kind: "impersonation.ended",
          summary: `Impersonation ended by platform (${session.email})`,
          refType: "impersonation_session",
          refId: s.id,
          actorUserId: s.targetUserId,
          diff: {
            endedBy: "platform",
            endedByEmail: session.email,
            reason: parsed.data.reason,
          },
          ipAddress: req.ip ?? null,
          userAgent: req.headers["user-agent"] ?? null,
        });
      });

      await recordPlatformAuditEvent({
        platformUserId: session.platformUserId,
        platformUserEmail: session.email,
        kind: "platform.impersonation_ended",
        summary: `Force-ended impersonation session ${s.id}`,
        reason: parsed.data.reason,
        tenantId: s.targetTenantId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        metadata: { sessionId: s.id },
      });

      return reply.send({ ok: true });
    },
  );

  // -----------------------------------------------------------------
  // GET /platform/impersonation-sessions
  //
  // Active sessions + a window of recent ones. Powers the
  // /platform/impersonation dashboard.
  // -----------------------------------------------------------------
  fastify.get("/impersonation-sessions", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    if (
      !(await requirePlatformRole(req, reply, session, [
        "super_admin",
        "support",
      ]))
    )
      return;

    await db.execute(sql`SELECT impersonation_sweep_expired()`);

    const rows = await db
      .select({
        id: schema.impersonationSessions.id,
        requestId: schema.impersonationSessions.requestId,
        platformUserEmail: schema.impersonationSessions.platformUserEmail,
        targetTenantId: schema.impersonationSessions.targetTenantId,
        tenantBusinessName: schema.tenants.businessName,
        tenantSlug: schema.tenants.slug,
        targetUserEmail: schema.impersonationSessions.targetUserEmail,
        startedAt: schema.impersonationSessions.startedAt,
        endsAt: schema.impersonationSessions.endsAt,
        endedAt: schema.impersonationSessions.endedAt,
        endedBy: schema.impersonationSessions.endedBy,
      })
      .from(schema.impersonationSessions)
      .leftJoin(
        schema.tenants,
        eq(schema.tenants.id, schema.impersonationSessions.targetTenantId),
      )
      .orderBy(desc(schema.impersonationSessions.startedAt))
      .limit(200);

    return reply.send({ sessions: rows });
  });
};
