import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@pettahpro/db";
import { requirePlatformSession, requirePlatformRole } from "./routes.js";
import { recordPlatformAuditEvent } from "./audit.js";
import { runTenantHealthCron } from "./health-cron.js";

/**
 * Tenant-health read endpoints (#134). The cron persists snapshots
 * daily; these routes read the latest per tenant and let an operator
 * fire the sweep manually for testing / immediate-after-fix
 * verification.
 *
 *   GET  /platform/health-scores            — at-risk dashboard
 *                                              (latest per tenant)
 *   GET  /platform/tenants/:id/health       — per-tenant detail
 *                                              with score history
 *   POST /platform/health-scores/run        — manual sweep, super-
 *                                              admin only
 *
 * Read access: super_admin / support / billing — same surface that
 * sees the tenant directory should see the score next to each row.
 */

interface HealthRow {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: string;
  score: number | null;
  riskLevel: string | null;
  loginScore: number | null;
  transactionScore: number | null;
  subscriptionScore: number | null;
  setupScore: number | null;
  reasons: string[];
  calculatedAt: string | null;
}

export const tenantHealthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/health-scores", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    if (
      !(await requirePlatformRole(req, reply, session, [
        "super_admin",
        "support",
        "billing",
      ]))
    ) {
      return;
    }

    const querySchema = z.object({
      risk: z.enum(["low", "medium", "high", "critical"]).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }

    // Latest row per tenant via DISTINCT ON. Joins to the tenant
    // table so the response carries name + status without a second
    // round-trip. Tenants without a score yet (fresh signups before
    // first cron tick) come through with NULL fields — UI renders
    // "not yet scored."
    const riskFilter = parsed.data.risk;
    const rows = (await db.execute(sql`
      SELECT
        t.id AS tenant_id,
        t.business_name AS tenant_name,
        t.slug AS tenant_slug,
        t.status AS tenant_status,
        latest.score,
        latest.risk_level,
        latest.login_score,
        latest.transaction_score,
        latest.subscription_score,
        latest.setup_score,
        latest.reasons,
        latest.calculated_at
      FROM tenants t
      LEFT JOIN LATERAL (
        SELECT score, risk_level, login_score, transaction_score,
               subscription_score, setup_score, reasons, calculated_at
        FROM tenant_health_scores
        WHERE tenant_id = t.id
        ORDER BY calculated_at DESC
        LIMIT 1
      ) latest ON true
      WHERE t.deleted_at IS NULL
        ${riskFilter ? sql`AND latest.risk_level = ${riskFilter}` : sql``}
      ORDER BY
        CASE latest.risk_level
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
          ELSE 5
        END,
        latest.score ASC NULLS LAST,
        t.business_name ASC
      LIMIT ${parsed.data.limit}
    `)) as unknown as Array<{
      tenant_id: string;
      tenant_name: string;
      tenant_slug: string;
      tenant_status: string;
      score: number | null;
      risk_level: string | null;
      login_score: number | null;
      transaction_score: number | null;
      subscription_score: number | null;
      setup_score: number | null;
      reasons: string[] | null;
      calculated_at: Date | string | null;
    }>;

    const tenants: HealthRow[] = rows.map((r) => ({
      tenantId: r.tenant_id,
      tenantName: r.tenant_name,
      tenantSlug: r.tenant_slug,
      tenantStatus: r.tenant_status,
      score: r.score,
      riskLevel: r.risk_level,
      loginScore: r.login_score,
      transactionScore: r.transaction_score,
      subscriptionScore: r.subscription_score,
      setupScore: r.setup_score,
      reasons: Array.isArray(r.reasons) ? r.reasons : [],
      calculatedAt:
        r.calculated_at instanceof Date
          ? r.calculated_at.toISOString()
          : (r.calculated_at as string | null),
    }));

    // Counts by risk for the dashboard summary strip.
    const counts = (await db.execute(sql`
      SELECT
        latest.risk_level,
        COUNT(*)::int AS n
      FROM tenants t
      LEFT JOIN LATERAL (
        SELECT risk_level
        FROM tenant_health_scores
        WHERE tenant_id = t.id
        ORDER BY calculated_at DESC
        LIMIT 1
      ) latest ON true
      WHERE t.deleted_at IS NULL
      GROUP BY latest.risk_level
    `)) as unknown as Array<{ risk_level: string | null; n: number }>;

    const byRisk = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
      not_scored: 0,
    };
    for (const c of counts) {
      if (c.risk_level && c.risk_level in byRisk) {
        byRisk[c.risk_level as keyof typeof byRisk] = c.n;
      } else {
        byRisk.not_scored += c.n;
      }
    }

    return reply.send({ tenants, byRisk });
  });

  fastify.get("/tenants/:id/health", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    if (
      !(await requirePlatformRole(req, reply, session, [
        "super_admin",
        "support",
        "billing",
      ]))
    ) {
      return;
    }

    const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }

    // Last 30 snapshots = roughly a month of trend data.
    const rows = (await db.execute(sql`
      SELECT score, risk_level, login_score, transaction_score,
             subscription_score, setup_score, reasons, calculated_at
      FROM tenant_health_scores
      WHERE tenant_id = ${parsed.data.id}::uuid
      ORDER BY calculated_at DESC
      LIMIT 30
    `)) as unknown as Array<{
      score: number;
      risk_level: string;
      login_score: number;
      transaction_score: number;
      subscription_score: number;
      setup_score: number;
      reasons: string[] | null;
      calculated_at: Date | string;
    }>;

    return reply.send({
      history: rows.map((r) => ({
        score: r.score,
        riskLevel: r.risk_level,
        loginScore: r.login_score,
        transactionScore: r.transaction_score,
        subscriptionScore: r.subscription_score,
        setupScore: r.setup_score,
        reasons: Array.isArray(r.reasons) ? r.reasons : [],
        calculatedAt:
          r.calculated_at instanceof Date
            ? r.calculated_at.toISOString()
            : r.calculated_at,
      })),
    });
  });

  fastify.post("/health-scores/run", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    if (!(await requirePlatformRole(req, reply, session, ["super_admin"]))) {
      return;
    }

    const result = await runTenantHealthCron(db, {
      info: (obj, msg) => req.log.info(obj, msg),
      error: (obj, msg) => req.log.error(obj, msg),
    });

    await recordPlatformAuditEvent({
      platformUserId: session.platformUserId,
      platformUserEmail: session.email,
      kind: "platform.tenant_health.recomputed",
      summary: `Manual tenant-health sweep — ${result.tenantsScored} scored`,
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      metadata: { result },
    });

    return reply.send({ result });
  });
};
