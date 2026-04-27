import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@pettahpro/db";
import { requirePlatformSession, requirePlatformRole } from "./routes.js";
import { recordPlatformAuditEvent } from "./audit.js";

/**
 * Dunning ops endpoints (L2 §10). Reads the data the dunning cron
 * produces (charge attempts + per-subscription state) and exposes
 * super-admin override actions on top of it.
 *
 *   GET  /platform/dunning                          — at-risk dashboard
 *   GET  /platform/dunning/tenants/:id              — per-tenant detail
 *                                                     with attempt history
 *   POST /platform/dunning/tenants/:id/retry-now    — schedule immediate retry
 *   POST /platform/dunning/tenants/:id/mark-paid    — record success without
 *                                                     calling the gateway
 *   POST /platform/dunning/tenants/:id/suspend-now  — cancel immediately
 *   POST /platform/dunning/tenants/:id/pause        — pause/unpause dunning for
 *                                                     this subscription's effective
 *                                                     policy
 *
 * Read access: super_admin / billing — same permission level as the
 * existing revenue routes.
 *
 * Mutations: super_admin / billing. Each mutation writes a
 * platform_audit_log row capturing operator + reason + before/after.
 */

interface DunningRow {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  subscription_id: string;
  status: string;
  plan_code: string;
  plan_name: string;
  billing_cycle: string;
  current_period_start: Date;
  current_period_end: Date;
  consecutive_failed_attempts: number;
  next_charge_attempt_at: Date | null;
  policy_id: string;
  policy_name: string;
  policy_is_paused: boolean;
  policy_suspend_after: number;
  last_attempt_at: Date | null;
  last_attempt_status: string | null;
  last_failure_reason: string | null;
}

interface ChargeAttemptRow {
  id: string;
  attempt_number: number;
  amount_cents: string;
  period_start: Date;
  period_end: Date;
  status: string;
  attempted_at: Date;
  completed_at: Date | null;
  gateway_response: string | null;
  failure_code: string | null;
  failure_reason: string | null;
  triggered_by_platform_user_id: string | null;
}

const ReasonSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

const MarkPaidSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  gatewayReference: z.string().trim().max(200).optional(),
});

const PauseSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  paused: z.boolean(),
});

export const dunningRoutes: FastifyPluginAsync = async (fastify) => {
  // ---------------------------------------------------------------
  // GET /platform/dunning
  //
  // Lists subscriptions the operator should know about: anything in
  // past_due status, plus active subs that have failed at least once
  // in their current period (rare but worth surfacing). Hides
  // already-cancelled subscriptions (those don't need ops attention
  // anymore).
  // ---------------------------------------------------------------
  fastify.get("/dunning", async (req, reply) => {
    const session = await requirePlatformSession(req, reply);
    if (!session) return;
    if (
      !(await requirePlatformRole(req, reply, session, [
        "super_admin",
        "billing",
        "support",
      ]))
    ) {
      return;
    }

    const querySchema = z.object({
      // Filter to only past_due if requested (default shows everything
      // worth ops attention, including active-with-failures).
      status: z.enum(["past_due", "all"]).default("all"),
      limit: z.coerce.number().int().min(1).max(500).default(200),
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }

    const statusFilter =
      parsed.data.status === "past_due"
        ? sql`s.status = 'past_due'`
        : sql`(s.status = 'past_due' OR (s.status = 'active' AND s.consecutive_failed_attempts > 0))`;

    const rows = (await db.execute(sql`
      SELECT
        t.id AS tenant_id,
        t.business_name AS tenant_name,
        t.slug AS tenant_slug,
        s.id AS subscription_id,
        s.status,
        p.code AS plan_code,
        p.name AS plan_name,
        s.billing_cycle,
        s.current_period_start,
        s.current_period_end,
        s.consecutive_failed_attempts,
        s.next_charge_attempt_at,
        COALESCE(plan_policy.id, default_policy.id) AS policy_id,
        COALESCE(plan_policy.name, default_policy.name) AS policy_name,
        COALESCE(plan_policy.is_paused, default_policy.is_paused) AS policy_is_paused,
        COALESCE(plan_policy.suspend_after_attempts, default_policy.suspend_after_attempts) AS policy_suspend_after,
        latest_attempt.attempted_at AS last_attempt_at,
        latest_attempt.status AS last_attempt_status,
        latest_attempt.failure_reason AS last_failure_reason
      FROM tenant_subscriptions s
      JOIN tenants t ON t.id = s.tenant_id
      JOIN plans p ON p.id = s.plan_id
      LEFT JOIN dunning_policies plan_policy
        ON plan_policy.plan_id = s.plan_id
      LEFT JOIN dunning_policies default_policy
        ON default_policy.plan_id IS NULL
      LEFT JOIN LATERAL (
        SELECT attempted_at, status, failure_reason
          FROM subscription_charge_attempts
         WHERE subscription_id = s.id
         ORDER BY attempted_at DESC
         LIMIT 1
      ) latest_attempt ON true
      WHERE ${statusFilter}
      ORDER BY
        CASE s.status WHEN 'past_due' THEN 0 ELSE 1 END,
        s.consecutive_failed_attempts DESC,
        s.next_charge_attempt_at ASC NULLS LAST
      LIMIT ${parsed.data.limit}
    `)) as unknown as DunningRow[];

    return reply.send({
      subscriptions: rows.map((r) => ({
        tenantId: r.tenant_id,
        tenantName: r.tenant_name,
        tenantSlug: r.tenant_slug,
        subscriptionId: r.subscription_id,
        status: r.status,
        planCode: r.plan_code,
        planName: r.plan_name,
        billingCycle: r.billing_cycle,
        currentPeriodStart: r.current_period_start,
        currentPeriodEnd: r.current_period_end,
        consecutiveFailedAttempts: r.consecutive_failed_attempts,
        nextChargeAttemptAt: r.next_charge_attempt_at,
        policy: {
          id: r.policy_id,
          name: r.policy_name,
          isPaused: r.policy_is_paused,
          suspendAfterAttempts: r.policy_suspend_after,
        },
        lastAttempt: r.last_attempt_at
          ? {
              attemptedAt: r.last_attempt_at,
              status: r.last_attempt_status,
              failureReason: r.last_failure_reason,
            }
          : null,
      })),
      counts: {
        pastDue: rows.filter((r) => r.status === "past_due").length,
        activeWithFailures: rows.filter(
          (r) => r.status === "active" && r.consecutive_failed_attempts > 0,
        ).length,
      },
    });
  });

  // ---------------------------------------------------------------
  // GET /platform/dunning/tenants/:id
  //
  // Per-tenant detail. Returns the subscription state plus the full
  // history of charge attempts (capped at 50 — older ones are still
  // queryable per period via the audit log).
  // ---------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>(
    "/dunning/tenants/:id",
    async (req, reply) => {
      const session = await requirePlatformSession(req, reply);
      if (!session) return;
      if (
        !(await requirePlatformRole(req, reply, session, [
          "super_admin",
          "billing",
          "support",
        ]))
      ) {
        return;
      }

      const tenantId = req.params.id;
      if (!isValidUuid(tenantId)) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
      }

      const subRows = (await db.execute(sql`
        SELECT
          t.id AS tenant_id,
          t.business_name AS tenant_name,
          t.slug AS tenant_slug,
          s.id AS subscription_id,
          s.status,
          p.code AS plan_code,
          p.name AS plan_name,
          s.billing_cycle,
          s.current_period_start,
          s.current_period_end,
          s.consecutive_failed_attempts,
          s.next_charge_attempt_at,
          COALESCE(plan_policy.id, default_policy.id) AS policy_id,
          COALESCE(plan_policy.name, default_policy.name) AS policy_name,
          COALESCE(plan_policy.is_paused, default_policy.is_paused) AS policy_is_paused,
          COALESCE(plan_policy.suspend_after_attempts, default_policy.suspend_after_attempts) AS policy_suspend_after,
          COALESCE(plan_policy.retry_intervals_days, default_policy.retry_intervals_days) AS policy_retry_intervals,
          COALESCE(plan_policy.grace_period_days, default_policy.grace_period_days) AS policy_grace_days
        FROM tenants t
        LEFT JOIN tenant_subscriptions s ON s.tenant_id = t.id
        LEFT JOIN plans p ON p.id = s.plan_id
        LEFT JOIN dunning_policies plan_policy
          ON plan_policy.plan_id = s.plan_id
        LEFT JOIN dunning_policies default_policy
          ON default_policy.plan_id IS NULL
        WHERE t.id = ${tenantId}
        LIMIT 1
      `)) as unknown as Array<DunningRow & {
        policy_retry_intervals: unknown;
        policy_grace_days: number;
      }>;

      const subRow = subRows[0];
      if (!subRow) {
        return reply.status(404).send({ error: { code: "NOT_FOUND" } });
      }
      if (!subRow.subscription_id) {
        return reply.status(404).send({ error: { code: "NO_SUBSCRIPTION" } });
      }

      const attempts = (await db.execute(sql`
        SELECT
          id,
          attempt_number,
          amount_cents,
          period_start,
          period_end,
          status,
          attempted_at,
          completed_at,
          gateway_response,
          failure_code,
          failure_reason,
          triggered_by_platform_user_id
        FROM subscription_charge_attempts
        WHERE subscription_id = ${subRow.subscription_id}
        ORDER BY attempted_at DESC
        LIMIT 50
      `)) as unknown as ChargeAttemptRow[];

      return reply.send({
        tenant: {
          id: subRow.tenant_id,
          name: subRow.tenant_name,
          slug: subRow.tenant_slug,
        },
        subscription: {
          id: subRow.subscription_id,
          status: subRow.status,
          planCode: subRow.plan_code,
          planName: subRow.plan_name,
          billingCycle: subRow.billing_cycle,
          currentPeriodStart: subRow.current_period_start,
          currentPeriodEnd: subRow.current_period_end,
          consecutiveFailedAttempts: subRow.consecutive_failed_attempts,
          nextChargeAttemptAt: subRow.next_charge_attempt_at,
        },
        policy: {
          id: subRow.policy_id,
          name: subRow.policy_name,
          isPaused: subRow.policy_is_paused,
          suspendAfterAttempts: subRow.policy_suspend_after,
          retryIntervalsDays: Array.isArray(subRow.policy_retry_intervals)
            ? (subRow.policy_retry_intervals as number[])
            : [],
          gracePeriodDays: subRow.policy_grace_days,
        },
        attempts: attempts.map((a) => ({
          id: a.id,
          attemptNumber: a.attempt_number,
          amountCents: Number(a.amount_cents),
          periodStart: a.period_start,
          periodEnd: a.period_end,
          status: a.status,
          attemptedAt: a.attempted_at,
          completedAt: a.completed_at,
          gatewayResponse: a.gateway_response,
          failureCode: a.failure_code,
          failureReason: a.failure_reason,
          triggeredByPlatformUserId: a.triggered_by_platform_user_id,
        })),
      });
    },
  );

  // ---------------------------------------------------------------
  // POST /platform/dunning/tenants/:id/retry-now
  //
  // Schedule an immediate charge attempt by setting next_charge_attempt_at
  // to now(). The dunning cron picks it up on its next tick (or you can
  // run the cron manually for tests). Doesn't increment fail counter
  // (that happens when the attempt actually fails).
  // ---------------------------------------------------------------
  fastify.post<{ Params: { id: string } }>(
    "/dunning/tenants/:id/retry-now",
    async (req, reply) => {
      const session = await requirePlatformSession(req, reply);
      if (!session) return;
      if (
        !(await requirePlatformRole(req, reply, session, [
          "super_admin",
          "billing",
        ]))
      ) {
        return;
      }

      const tenantId = req.params.id;
      if (!isValidUuid(tenantId)) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
      }
      const parsed = ReasonSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "INVALID_INPUT",
            message: "A reason (3-500 chars) is required",
          },
        });
      }

      const result = (await db.execute(sql`
        UPDATE tenant_subscriptions
           SET next_charge_attempt_at = now(),
               updated_at = now()
         WHERE tenant_id = ${tenantId}
           AND status IN ('active', 'past_due')
         RETURNING id, status
      `)) as unknown as Array<{ id: string; status: string }>;

      if (result.length === 0) {
        return reply.status(404).send({
          error: {
            code: "NOT_RETRIABLE",
            message:
              "No active/past-due subscription found for this tenant",
          },
        });
      }

      await recordPlatformAuditEvent({
        platformUserId: session.id,
        platformUserEmail: session.email,
        kind: "dunning.retry_now",
        summary: "Manual retry-now scheduled for tenant subscription",
        reason: parsed.data.reason,
        tenantId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"]
          ? String(req.headers["user-agent"]).slice(0, 512)
          : null,
        metadata: {
          subscriptionId: result[0]!.id,
          previousStatus: result[0]!.status,
        },
      });

      return reply.send({ ok: true });
    },
  );

  // ---------------------------------------------------------------
  // POST /platform/dunning/tenants/:id/mark-paid
  //
  // Records a successful charge without calling the gateway. Used when
  // the customer paid out-of-band (bank transfer, cheque cleared) and
  // ops needs to clear the past_due flag and advance the period.
  //
  // Inserts a synthetic charge_attempts row so the audit trail is
  // complete and the metrics on dunning effectiveness aren't skewed.
  // ---------------------------------------------------------------
  fastify.post<{ Params: { id: string } }>(
    "/dunning/tenants/:id/mark-paid",
    async (req, reply) => {
      const session = await requirePlatformSession(req, reply);
      if (!session) return;
      if (
        !(await requirePlatformRole(req, reply, session, [
          "super_admin",
          "billing",
        ]))
      ) {
        return;
      }

      const tenantId = req.params.id;
      if (!isValidUuid(tenantId)) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
      }
      const parsed = MarkPaidSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "INVALID_INPUT",
            message: "A reason (3-500 chars) is required",
          },
        });
      }

      // Resolve the subscription + plan price first so we can record
      // the right amount on the synthetic attempt.
      const subRows = (await db.execute(sql`
        SELECT
          s.id,
          s.tenant_id,
          s.consecutive_failed_attempts,
          s.current_period_start,
          s.current_period_end,
          s.billing_cycle,
          p.monthly_price_cents,
          p.yearly_price_cents,
          COALESCE(plan_policy.id, default_policy.id) AS policy_id
        FROM tenant_subscriptions s
        JOIN plans p ON p.id = s.plan_id
        LEFT JOIN dunning_policies plan_policy
          ON plan_policy.plan_id = s.plan_id
        LEFT JOIN dunning_policies default_policy
          ON default_policy.plan_id IS NULL
        WHERE s.tenant_id = ${tenantId}
          AND s.status IN ('active', 'past_due')
        LIMIT 1
      `)) as unknown as Array<{
        id: string;
        tenant_id: string;
        consecutive_failed_attempts: number;
        current_period_start: Date;
        current_period_end: Date;
        billing_cycle: string;
        monthly_price_cents: string;
        yearly_price_cents: string;
        policy_id: string;
      }>;

      const sub = subRows[0];
      if (!sub) {
        return reply.status(404).send({
          error: {
            code: "NOT_FOUND",
            message: "No active/past-due subscription found",
          },
        });
      }

      const amountCents = Number(
        sub.billing_cycle === "yearly"
          ? sub.yearly_price_cents
          : sub.monthly_price_cents,
      );
      const cycleDays = sub.billing_cycle === "yearly" ? 365 : 30;
      const attemptNumber = sub.consecutive_failed_attempts + 1;
      const responseLabel = parsed.data.gatewayReference
        ? `manual:paid:${parsed.data.gatewayReference}`
        : "manual:paid";

      // Record the synthetic attempt + advance the subscription in
      // one transaction. If anything fails, neither side commits.
      await db.transaction(async (tx) => {
        await tx.insert(schema.subscriptionChargeAttempts).values({
          tenantId: sub.tenant_id,
          subscriptionId: sub.id,
          attemptNumber,
          amountCents,
          periodStart: sub.current_period_start,
          periodEnd: sub.current_period_end,
          status: "succeeded",
          completedAt: new Date(),
          gatewayResponse: responseLabel,
          dunningPolicyId: sub.policy_id,
          triggeredByPlatformUserId: session.id,
        });

        await tx.execute(sql`
          UPDATE tenant_subscriptions
             SET status = 'active',
                 consecutive_failed_attempts = 0,
                 next_charge_attempt_at = current_period_end +
                   interval '${sql.raw(String(cycleDays))} days',
                 updated_at = now()
           WHERE id = ${sub.id}
        `);
      });

      await recordPlatformAuditEvent({
        platformUserId: session.id,
        platformUserEmail: session.email,
        kind: "dunning.mark_paid",
        summary: "Subscription manually marked paid (out-of-band)",
        reason: parsed.data.reason,
        tenantId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"]
          ? String(req.headers["user-agent"]).slice(0, 512)
          : null,
        metadata: {
          subscriptionId: sub.id,
          amountCents,
          gatewayReference: parsed.data.gatewayReference ?? null,
        },
      });

      return reply.send({ ok: true });
    },
  );

  // ---------------------------------------------------------------
  // POST /platform/dunning/tenants/:id/suspend-now
  //
  // Skip remaining retries and move straight to cancellation. Used
  // when ops decides further attempts are pointless (customer has
  // explicitly told us they're not paying, charged-back, etc.).
  // ---------------------------------------------------------------
  fastify.post<{ Params: { id: string } }>(
    "/dunning/tenants/:id/suspend-now",
    async (req, reply) => {
      const session = await requirePlatformSession(req, reply);
      if (!session) return;
      if (
        !(await requirePlatformRole(req, reply, session, [
          "super_admin",
          "billing",
        ]))
      ) {
        return;
      }

      const tenantId = req.params.id;
      if (!isValidUuid(tenantId)) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
      }
      const parsed = ReasonSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "INVALID_INPUT",
            message: "A reason (3-500 chars) is required",
          },
        });
      }

      const result = (await db.execute(sql`
        UPDATE tenant_subscriptions
           SET status = 'cancelled',
               cancelled_at = now(),
               cancel_reason = ${parsed.data.reason},
               next_charge_attempt_at = NULL,
               updated_at = now()
         WHERE tenant_id = ${tenantId}
           AND status IN ('active', 'past_due')
         RETURNING id, consecutive_failed_attempts
      `)) as unknown as Array<{
        id: string;
        consecutive_failed_attempts: number;
      }>;

      if (result.length === 0) {
        return reply.status(404).send({
          error: {
            code: "NOT_FOUND",
            message: "No active/past-due subscription found",
          },
        });
      }

      await recordPlatformAuditEvent({
        platformUserId: session.id,
        platformUserEmail: session.email,
        kind: "dunning.suspend_now",
        summary: "Subscription manually suspended (skipped remaining retries)",
        reason: parsed.data.reason,
        tenantId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"]
          ? String(req.headers["user-agent"]).slice(0, 512)
          : null,
        metadata: {
          subscriptionId: result[0]!.id,
          failedAttemptsAtSuspension: result[0]!.consecutive_failed_attempts,
        },
      });

      return reply.send({ ok: true });
    },
  );

  // ---------------------------------------------------------------
  // POST /platform/dunning/tenants/:id/pause
  //
  // Pause/unpause dunning for the subscription's effective policy.
  // While paused, the dunning cron records 'skipped' attempts with
  // the current consecutive_failed_attempts intact — when unpaused,
  // retries continue from where they were.
  //
  // This pauses at the POLICY level, which affects every tenant
  // sharing that policy. For per-tenant pause, see the policy CRUD
  // (separate endpoint, deferred) or use the per-tenant override
  // pattern. Pragmatic v1 — most tenants share the default policy
  // and most pauses are fine to broaden.
  // ---------------------------------------------------------------
  fastify.post<{ Params: { id: string } }>(
    "/dunning/tenants/:id/pause",
    async (req, reply) => {
      const session = await requirePlatformSession(req, reply);
      if (!session) return;
      if (
        !(await requirePlatformRole(req, reply, session, [
          "super_admin",
          "billing",
        ]))
      ) {
        return;
      }

      const tenantId = req.params.id;
      if (!isValidUuid(tenantId)) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
      }
      const parsed = PauseSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "INVALID_INPUT",
            message: "Reason + paused boolean required",
          },
        });
      }

      // Resolve the subscription's effective policy (plan-specific
      // → default).
      const policyRows = (await db.execute(sql`
        SELECT COALESCE(plan_policy.id, default_policy.id) AS id
          FROM tenant_subscriptions s
          LEFT JOIN dunning_policies plan_policy
            ON plan_policy.plan_id = s.plan_id
          LEFT JOIN dunning_policies default_policy
            ON default_policy.plan_id IS NULL
         WHERE s.tenant_id = ${tenantId}
         LIMIT 1
      `)) as unknown as Array<{ id: string }>;

      if (policyRows.length === 0 || !policyRows[0]?.id) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "No subscription found" },
        });
      }

      await db.execute(sql`
        UPDATE dunning_policies
           SET is_paused = ${parsed.data.paused},
               updated_at = now()
         WHERE id = ${policyRows[0]!.id}
      `);

      await recordPlatformAuditEvent({
        platformUserId: session.id,
        platformUserEmail: session.email,
        kind: parsed.data.paused
          ? "dunning.policy_paused"
          : "dunning.policy_resumed",
        summary: parsed.data.paused
          ? "Dunning policy paused (no further retry attempts)"
          : "Dunning policy resumed",
        reason: parsed.data.reason,
        tenantId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"]
          ? String(req.headers["user-agent"]).slice(0, 512)
          : null,
        metadata: {
          policyId: policyRows[0]!.id,
          paused: parsed.data.paused,
        },
      });

      return reply.send({ ok: true });
    },
  );
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}
