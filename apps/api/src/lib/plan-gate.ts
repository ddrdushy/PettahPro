import type { FastifyRequest, FastifyReply } from "fastify";
import { eq } from "drizzle-orm";
import { db, schema } from "@pettahpro/db";
import { requireAuth } from "./with-tenant.js";

/**
 * Plan-gate enforcement (#62, follow-up to #61).
 *
 * The plan engine shipped the data model in #61 (plans + tenant_
 * subscriptions). This file is the enforcement layer: a route calls
 * `requireFeature(req, reply, "payroll")` and gets `{tenantId, userId}`
 * on pass, or a 403 PLAN_REQUIRED response on deny with enough detail
 * for the UI to render a useful upgrade CTA.
 *
 *   {
 *     error: {
 *       code: "PLAN_REQUIRED",
 *       feature: "payroll",
 *       currentPlanCode: "starter",
 *       upgradeToPlanCodes: ["growth", "scale"],
 *       message: "Payroll requires the Growth plan or higher."
 *     }
 *   }
 *
 * Design notes:
 *
 *   - Reads outside RLS — `plans` and `tenant_subscriptions` have no
 *     tenant_id policies per PR #61, so a plain db.select() works.
 *     No `withTenant` wrapper needed.
 *
 *   - Per-request cache — most routes will only fire one gate, but a
 *     composite endpoint could fire several. Cache the subscription
 *     row on req._planContext so subsequent calls are free.
 *
 *   - We do NOT block past_due or cancelled subscriptions here. That's
 *     a separate concern (trial expiry + grace period handling in
 *     PR #63). If a subscription is cancelled but the feature is
 *     still in the plan.features list, this gate passes. The caller
 *     who cancelled shouldn't be punished mid-request.
 *
 *   - Unknown feature codes deny by default. Typo-safety: if someone
 *     writes `requireFeature("payrol")` the gate 403s, we see it in
 *     prod immediately, fix the typo. Better than silently passing.
 */

interface PlanContext {
  subscriptionStatus: string | null;
  planCode: string | null;
  features: string[];
}

declare module "fastify" {
  interface FastifyRequest {
    _planContext?: PlanContext;
  }
}

async function loadPlanContext(tenantId: string): Promise<PlanContext> {
  const rows = await db
    .select({
      status: schema.tenantSubscriptions.status,
      planCode: schema.plans.code,
      features: schema.plans.features,
    })
    .from(schema.tenantSubscriptions)
    .leftJoin(
      schema.plans,
      eq(schema.plans.id, schema.tenantSubscriptions.planId),
    )
    .where(eq(schema.tenantSubscriptions.tenantId, tenantId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    // No subscription row at all. In prod this shouldn't happen after
    // the #61 backfill, but a freshly-created tenant before the
    // backfill ran would land here. Fail closed — no plan means no
    // gated features. An operator seeing this 403 is a signal to run
    // the backfill / assign a subscription.
    return { subscriptionStatus: null, planCode: null, features: [] };
  }
  return {
    subscriptionStatus: row.status,
    planCode: row.planCode,
    // features is jsonb string[]; defensively coerce in case Drizzle
    // hands us `unknown`.
    features: Array.isArray(row.features) ? (row.features as string[]) : [],
  };
}

/**
 * Which plan codes (if any) grant the given feature? Used in the 403
 * body so the UI can say "Upgrade to Growth or Scale" instead of a
 * bare "upgrade" — much kinder to the human on the other end.
 *
 * Reads the live catalogue rather than hard-coding so new plans or
 * reshuffled feature lists don't drift out of sync with the error
 * message.
 */
async function plansGranting(feature: string): Promise<string[]> {
  const rows = await db
    .select({ code: schema.plans.code, features: schema.plans.features })
    .from(schema.plans)
    .orderBy(schema.plans.sortOrder);
  return rows
    .filter((r) => Array.isArray(r.features) && (r.features as string[]).includes(feature))
    .map((r) => r.code);
}

export async function requireFeature(
  req: FastifyRequest,
  reply: FastifyReply,
  feature: string,
): Promise<{ tenantId: string; userId: string } | null> {
  const ctx = requireAuth(req, reply);
  if (!ctx) return null;

  const planCtx =
    req._planContext ?? (await loadPlanContext(ctx.tenantId));
  req._planContext = planCtx;

  if (planCtx.features.includes(feature)) return ctx;

  // Miss. Build a useful error payload so the UI can show "Upgrade to
  // Growth" inline, not just "Forbidden". If the feature doesn't
  // exist in ANY plan, upgradeToPlanCodes is empty — the UI falls back
  // to a generic "this feature isn't available on your plan" message.
  const upgradeToPlanCodes = await plansGranting(feature);

  reply.status(403).send({
    error: {
      code: "PLAN_REQUIRED",
      feature,
      currentPlanCode: planCtx.planCode,
      upgradeToPlanCodes,
      message: upgradeToPlanCodes.length
        ? `This feature requires the ${upgradeToPlanCodes[0]?.charAt(0).toUpperCase()}${upgradeToPlanCodes[0]?.slice(1)} plan or higher.`
        : `This feature is not available on any plan.`,
    },
  });
  return null;
}

/**
 * Load a tenant's own subscription — used by `GET /subscription` on
 * the tenant-side so the settings page can render "Your plan". Same
 * query as loadPlanContext but returns the richer shape that matches
 * the platform-admin endpoint so the UI types can be shared.
 */
export async function getTenantSubscription(tenantId: string): Promise<{
  id: string;
  status: string;
  billingCycle: string;
  trialEndsAt: Date | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  plan: {
    id: string;
    code: string;
    name: string;
    tagline: string;
    monthlyPriceCents: number;
    yearlyPriceCents: number;
    currency: string;
    maxUsers: number | null;
    maxInvoicesMonthly: number | null;
    maxBranches: number | null;
    maxWarehouses: number | null;
    features: string[];
  };
} | null> {
  const rows = await db
    .select({
      subscription: schema.tenantSubscriptions,
      plan: schema.plans,
    })
    .from(schema.tenantSubscriptions)
    .leftJoin(
      schema.plans,
      eq(schema.plans.id, schema.tenantSubscriptions.planId),
    )
    .where(eq(schema.tenantSubscriptions.tenantId, tenantId))
    .limit(1);
  const row = rows[0];
  if (!row || !row.plan) return null;
  return {
    id: row.subscription.id,
    status: row.subscription.status,
    billingCycle: row.subscription.billingCycle,
    trialEndsAt: row.subscription.trialEndsAt,
    currentPeriodStart: row.subscription.currentPeriodStart,
    currentPeriodEnd: row.subscription.currentPeriodEnd,
    plan: {
      id: row.plan.id,
      code: row.plan.code,
      name: row.plan.name,
      tagline: row.plan.tagline,
      monthlyPriceCents: row.plan.monthlyPriceCents,
      yearlyPriceCents: row.plan.yearlyPriceCents,
      currency: row.plan.currency,
      maxUsers: row.plan.maxUsers,
      maxInvoicesMonthly: row.plan.maxInvoicesMonthly,
      maxBranches: row.plan.maxBranches,
      maxWarehouses: row.plan.maxWarehouses,
      features: Array.isArray(row.plan.features)
        ? (row.plan.features as string[])
        : [],
    },
  };
}
