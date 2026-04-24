import type { FastifyRequest, FastifyReply } from "fastify";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema, withTenant } from "@pettahpro/db";
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
 *   - `cancelled` status denies outright with SUBSCRIPTION_CANCELLED
 *     (#63). The trial-expiry job flips past_due → cancelled after the
 *     7-day grace window; platform-admin can also cancel manually. Once
 *     cancelled, no gated feature works. `past_due` still passes —
 *     that's the grace window doing its job. If the user is on a free
 *     base tier without any gated features none of this matters, but
 *     Growth/Scale features go dark the instant cancellation lands.
 *
 *   - Unknown feature codes deny by default. Typo-safety: if someone
 *     writes `requireFeature("payrol")` the gate 403s, we see it in
 *     prod immediately, fix the typo. Better than silently passing.
 */

interface PlanContext {
  subscriptionStatus: string | null;
  planCode: string | null;
  features: string[];
  // Effective numeric caps (#65, #71). Already coalesced against any
  // per-tenant override on the subscription row — callers don't branch
  // on "is there an override?"; they just read the cap. NULL still
  // means unlimited regardless of origin (plan default or custom
  // override set to NULL). The gate short-circuits on NULL without a
  // count query.
  maxInvoicesMonthly: number | null;
  maxBranches: number | null;
  maxWarehouses: number | null;
  maxUsers: number | null;
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
      planMaxInvoicesMonthly: schema.plans.maxInvoicesMonthly,
      planMaxBranches: schema.plans.maxBranches,
      planMaxWarehouses: schema.plans.maxWarehouses,
      planMaxUsers: schema.plans.maxUsers,
      // Per-tenant overrides (#71). These take precedence when non-null;
      // the COALESCE happens below in TS so the gate logic is explicit
      // and auditable, not hidden in a SQL expression.
      customMaxInvoicesMonthly: schema.tenantSubscriptions.customMaxInvoicesMonthly,
      customMaxBranches: schema.tenantSubscriptions.customMaxBranches,
      customMaxWarehouses: schema.tenantSubscriptions.customMaxWarehouses,
      customMaxUsers: schema.tenantSubscriptions.customMaxUsers,
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
    return {
      subscriptionStatus: null,
      planCode: null,
      features: [],
      maxInvoicesMonthly: null,
      maxBranches: null,
      maxWarehouses: null,
      maxUsers: null,
    };
  }
  return {
    subscriptionStatus: row.status,
    planCode: row.planCode,
    // features is jsonb string[]; defensively coerce in case Drizzle
    // hands us `unknown`.
    features: Array.isArray(row.features) ? (row.features as string[]) : [],
    // Effective caps: per-tenant override wins when set, otherwise fall
    // through to the plan row. `?? null` preserves "unlimited" when
    // both are null — we never want "0" (the falsy-but-legitimate
    // "freeze this resource" value) to collapse to the plan default,
    // so explicit null-coalescing rather than `||`.
    maxInvoicesMonthly:
      row.customMaxInvoicesMonthly ?? row.planMaxInvoicesMonthly ?? null,
    maxBranches: row.customMaxBranches ?? row.planMaxBranches ?? null,
    maxWarehouses: row.customMaxWarehouses ?? row.planMaxWarehouses ?? null,
    maxUsers: row.customMaxUsers ?? row.planMaxUsers ?? null,
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

  // Cancelled blocks everything gated (#63). Separate error code from
  // PLAN_REQUIRED so the UI can render a "subscription ended — contact
  // support" dialog instead of a plan picker: picking a plan from a
  // cancelled state isn't self-serve yet, and showing the upgrade
  // sheet would be misleading.
  if (planCtx.subscriptionStatus === "cancelled") {
    reply.status(403).send({
      error: {
        code: "SUBSCRIPTION_CANCELLED",
        feature,
        currentPlanCode: planCtx.planCode,
        message:
          "Your subscription has been cancelled. Contact support to reactivate.",
      },
    });
    return null;
  }

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
 * Per-resource quota enforcement (#65).
 *
 * Three countable resources today — invoices per month, branches,
 * warehouses. NULL in the plan row means "unlimited" — we short-circuit
 * before the count query, so unlimited resources cost zero work. Each
 * resource has a local `count*` function that runs under RLS via
 * withTenant; the helper picks the right one by `resource`.
 *
 * The 403 body mirrors requireFeature's shape so the UI's error handler
 * can branch on `code`:
 *
 *   {
 *     error: {
 *       code: "QUOTA_EXCEEDED",
 *       resource: "invoices_monthly",
 *       current: 500,
 *       max: 500,
 *       currentPlanCode: "starter",
 *       upgradeToPlanCodes: ["growth", "scale"],  // plans with higher/null cap
 *       message: "You've hit your monthly invoice limit on the Starter plan."
 *     }
 *   }
 *
 * `upgradeToPlanCodes` only lists plans whose cap for the SAME resource
 * is strictly higher (or unlimited). So a Starter tenant hitting the
 * invoice cap sees Growth + Scale (both unlimited); a Growth tenant
 * hitting the branch cap (3) sees only Scale (unlimited).
 */
export type QuotaResource = "invoices_monthly" | "branches" | "warehouses";

interface QuotaCheck {
  ok: boolean;
  current: number;
  max: number | null;
  planCode: string | null;
  upgradeToPlanCodes: string[];
}

/**
 * Public read-only variant: returns the check result without sending a
 * response. Used by the tenant-side /subscription/usage endpoint so the
 * settings card can render "23 / 500 invoices this month" — same math
 * as the gate, exposed as data rather than a 403.
 */
export async function checkQuota(
  tenantId: string,
  resource: QuotaResource,
): Promise<QuotaCheck> {
  const planCtx = await loadPlanContext(tenantId);
  const max = quotaMaxFor(planCtx, resource);
  if (max === null) {
    return {
      ok: true,
      current: 0,
      max: null,
      planCode: planCtx.planCode,
      upgradeToPlanCodes: [],
    };
  }
  const current = await countResource(tenantId, resource);
  const upgradeToPlanCodes = await plansWithHigherQuota(resource, max);
  return {
    ok: current < max,
    current,
    max,
    planCode: planCtx.planCode,
    upgradeToPlanCodes,
  };
}

export async function requireQuota(
  req: FastifyRequest,
  reply: FastifyReply,
  resource: QuotaResource,
): Promise<{ tenantId: string; userId: string } | null> {
  const ctx = requireAuth(req, reply);
  if (!ctx) return null;

  const planCtx =
    req._planContext ?? (await loadPlanContext(ctx.tenantId));
  req._planContext = planCtx;

  // Cancelled short-circuit — same rationale as requireFeature. A
  // cancelled tenant shouldn't be able to create new documents regardless
  // of their last plan's quotas.
  if (planCtx.subscriptionStatus === "cancelled") {
    reply.status(403).send({
      error: {
        code: "SUBSCRIPTION_CANCELLED",
        resource,
        currentPlanCode: planCtx.planCode,
        message:
          "Your subscription has been cancelled. Contact support to reactivate.",
      },
    });
    return null;
  }

  const max = quotaMaxFor(planCtx, resource);
  if (max === null) return ctx; // unlimited — skip the count query

  const current = await countResource(ctx.tenantId, resource);
  if (current < max) return ctx;

  // Over the line. Build the same "upgrade-to" payload that requireFeature
  // emits so the UI has one dialog shape to handle.
  const upgradeToPlanCodes = await plansWithHigherQuota(resource, max);

  reply.status(403).send({
    error: {
      code: "QUOTA_EXCEEDED",
      resource,
      current,
      max,
      currentPlanCode: planCtx.planCode,
      upgradeToPlanCodes,
      message: quotaMessage(resource, planCtx.planCode, upgradeToPlanCodes),
    },
  });
  return null;
}

function quotaMaxFor(
  planCtx: PlanContext,
  resource: QuotaResource,
): number | null {
  switch (resource) {
    case "invoices_monthly":
      return planCtx.maxInvoicesMonthly;
    case "branches":
      return planCtx.maxBranches;
    case "warehouses":
      return planCtx.maxWarehouses;
  }
}

/**
 * Count the resource for this tenant. Runs under RLS via withTenant —
 * the alternative (outside RLS with an explicit tenant_id filter) would
 * let a subscription-row misread silently count the whole universe, and
 * this is a hot-path gate where we want the DB to refuse to see other
 * tenants' rows on principle.
 *
 * invoices_monthly counts rows with issue_date in the current calendar
 * month, NOT created_at. Same logic as the plan-page marketing copy
 * ("500 invoices / month") — a tenant reading yesterday's invoice back
 * in a new month shouldn't burn a quota slot.
 */
async function countResource(
  tenantId: string,
  resource: QuotaResource,
): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    if (resource === "invoices_monthly") {
      const rows = (await tx.execute(sql`
        SELECT COUNT(*)::int AS count
          FROM invoices
         WHERE tenant_id = current_tenant_id()
           AND deleted_at IS NULL
           AND issue_date >= date_trunc('month', CURRENT_DATE)
           AND issue_date <  date_trunc('month', CURRENT_DATE) + interval '1 month'
      `)) as unknown as Array<{ count: number }>;
      return rows[0]?.count ?? 0;
    }
    if (resource === "branches") {
      const rows = await tx
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(schema.branches)
        .where(
          and(
            eq(schema.branches.tenantId, tenantId),
            isNull(schema.branches.deletedAt),
          ),
        );
      return rows[0]?.count ?? 0;
    }
    if (resource === "warehouses") {
      const rows = await tx
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(schema.warehouses)
        .where(
          and(
            eq(schema.warehouses.tenantId, tenantId),
            isNull(schema.warehouses.deletedAt),
          ),
        );
      return rows[0]?.count ?? 0;
    }
    // Exhaustiveness — if a new QuotaResource is added without a count
    // branch, TS will flag it on the switch in quotaMaxFor but the
    // runtime here would return 0. Throw to make that fast-fail.
    throw new Error(`countResource: unknown resource ${resource as string}`);
  });
}

/**
 * Plans whose cap for `resource` is strictly higher than `currentMax`
 * (or NULL = unlimited). Ordered by sort_order so the UI sees the
 * cheapest qualifying plan first.
 */
async function plansWithHigherQuota(
  resource: QuotaResource,
  currentMax: number,
): Promise<string[]> {
  const rows = await db
    .select({
      code: schema.plans.code,
      maxInvoicesMonthly: schema.plans.maxInvoicesMonthly,
      maxBranches: schema.plans.maxBranches,
      maxWarehouses: schema.plans.maxWarehouses,
    })
    .from(schema.plans)
    .orderBy(schema.plans.sortOrder);
  return rows
    .filter((r) => {
      const cap =
        resource === "invoices_monthly"
          ? r.maxInvoicesMonthly
          : resource === "branches"
            ? r.maxBranches
            : r.maxWarehouses;
      return cap === null || cap > currentMax;
    })
    .map((r) => r.code);
}

function quotaMessage(
  resource: QuotaResource,
  currentPlanCode: string | null,
  upgradeToPlanCodes: string[],
): string {
  const planLabel = currentPlanCode
    ? `${currentPlanCode.charAt(0).toUpperCase()}${currentPlanCode.slice(1)}`
    : "your current";
  const resourceLabel =
    resource === "invoices_monthly"
      ? "monthly invoice"
      : resource === "branches"
        ? "branch"
        : "warehouse";
  const upgradeLabel = upgradeToPlanCodes.length
    ? ` Upgrade to ${upgradeToPlanCodes[0]!.charAt(0).toUpperCase()}${upgradeToPlanCodes[0]!.slice(1)} for more.`
    : "";
  return `You've hit your ${resourceLabel} limit on the ${planLabel} plan.${upgradeLabel}`;
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
  // Per-tenant quota overrides (#71). NULL on every field = "no override,
  // use the plan's caps." Any non-null integer replaces the plan cap for
  // that resource. Exposed on the tenant-side read so the settings UI (#72)
  // can render the effective caps and the "Custom contract" note instead
  // of the raw plan-catalogue values — those don't match the usage chips
  // driven by checkQuota when overrides are active.
  customLimits: {
    maxUsers: number | null;
    maxInvoicesMonthly: number | null;
    maxBranches: number | null;
    maxWarehouses: number | null;
    note: string | null;
  };
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
    customLimits: {
      maxUsers: row.subscription.customMaxUsers,
      maxInvoicesMonthly: row.subscription.customMaxInvoicesMonthly,
      maxBranches: row.subscription.customMaxBranches,
      maxWarehouses: row.subscription.customMaxWarehouses,
      note: row.subscription.customLimitsNote,
    },
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
