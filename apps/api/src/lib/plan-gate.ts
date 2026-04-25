import type { FastifyRequest, FastifyReply } from "fastify";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
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
  // Two joins: plan_versions for the *bound* version's value-bearing
  // fields (features, caps), plans for the catalog identity (code).
  // The COALESCE pattern keeps back-compat with rows that somehow
  // didn't get backfilled — fall through to plans.* if the version
  // row is missing. After 91-plan-versions.sql every row should have
  // plan_version_id set, but defensive coding here is cheap.
  const rows = await db
    .select({
      status: schema.tenantSubscriptions.status,
      planCode: schema.plans.code,
      // Versioned fields — read from plan_versions when bound, else
      // fall back to plans (the denormalised "current" snapshot).
      versionFeatures: schema.planVersions.features,
      versionMaxInvoicesMonthly: schema.planVersions.maxInvoicesMonthly,
      versionMaxBranches: schema.planVersions.maxBranches,
      versionMaxWarehouses: schema.planVersions.maxWarehouses,
      versionMaxUsers: schema.planVersions.maxUsers,
      planFeatures: schema.plans.features,
      planMaxInvoicesMonthly: schema.plans.maxInvoicesMonthly,
      planMaxBranches: schema.plans.maxBranches,
      planMaxWarehouses: schema.plans.maxWarehouses,
      planMaxUsers: schema.plans.maxUsers,
      // Per-tenant overrides (#71). Beat both version and plan caps.
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
    .leftJoin(
      schema.planVersions,
      eq(schema.planVersions.id, schema.tenantSubscriptions.planVersionId),
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
  // Effective values: bound version wins; fall back to current plan
  // row when the sub somehow has no plan_version_id (shouldn't happen
  // after the migration, but defensive coding is cheap on a hot path).
  // Version field present? use it. Otherwise plan field.
  const effectiveFeatures = Array.isArray(row.versionFeatures)
    ? (row.versionFeatures as string[])
    : Array.isArray(row.planFeatures)
      ? (row.planFeatures as string[])
      : [];
  const effectiveCap = (
    versionVal: number | null,
    planVal: number | null,
  ): number | null => versionVal ?? planVal ?? null;

  // Add-on features (#120). Active and pending_removal addons grant
  // their features through the period end — pending_removal is "I'm
  // paying through this cycle, then dropping" and the spec is explicit
  // about not yanking access mid-period. Cancelled rows do not grant.
  const addonRows = await db
    .select({
      grantsFeatures: schema.addons.grantsFeatures,
    })
    .from(schema.tenantAddons)
    .leftJoin(schema.addons, eq(schema.addons.id, schema.tenantAddons.addonId))
    .where(
      and(
        eq(schema.tenantAddons.tenantId, tenantId),
        inArray(schema.tenantAddons.status, ["active", "pending_removal"]),
      ),
    );
  const addonFeatures = new Set<string>();
  for (const r of addonRows) {
    if (Array.isArray(r.grantsFeatures)) {
      for (const f of r.grantsFeatures as string[]) addonFeatures.add(f);
    }
  }
  const unionedFeatures = Array.from(
    new Set([...effectiveFeatures, ...addonFeatures]),
  );

  return {
    subscriptionStatus: row.status,
    planCode: row.planCode,
    features: unionedFeatures,
    // Per-tenant override wins; otherwise version cap; otherwise plan cap.
    // `?? null` preserves "unlimited" when all are null — never let "0"
    // (the falsy-but-legitimate "freeze this resource" value) collapse to
    // a fallback. (Cap-delta addons are deferred — see 92-addons.sql.)
    maxInvoicesMonthly:
      row.customMaxInvoicesMonthly ??
      effectiveCap(row.versionMaxInvoicesMonthly, row.planMaxInvoicesMonthly),
    maxBranches:
      row.customMaxBranches ??
      effectiveCap(row.versionMaxBranches, row.planMaxBranches),
    maxWarehouses:
      row.customMaxWarehouses ??
      effectiveCap(row.versionMaxWarehouses, row.planMaxWarehouses),
    maxUsers:
      row.customMaxUsers ??
      effectiveCap(row.versionMaxUsers, row.planMaxUsers),
  };
}

/**
 * Which plan codes (if any) grant the given feature? Used in the 403
 * body so the UI can say "Upgrade to Growth or Scale" instead of a
 * bare "upgrade" — much kinder to the human on the other end.
 *
 * Reads the live catalogue (plans.features = current published version)
 * because the upgrade suggestion is "what would you get if you switch
 * NOW" — not "what would your current grandfathered version offer."
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
 * the tenant-side so the settings page can render "Your plan".
 *
 * Returns three views of the plan:
 *   * `plan` — the catalog identity (code, name) plus the BOUND
 *     version's effective values (the prices/caps/features the
 *     tenant actually pays for and gets). Reads from
 *     plan_versions.* via plan_version_id when bound; falls back to
 *     plans.* (current snapshot) for back-compat.
 *   * `boundVersion` — the version_number + raw plan_versions row,
 *     null if not bound (rare, back-compat case).
 *   * `currentVersion` — the plan's current published version. When
 *     boundVersion.versionNumber < currentVersion.versionNumber the
 *     UI knows to render "version 2 published — migrate?".
 */
export async function getTenantSubscription(tenantId: string): Promise<{
  id: string;
  status: string;
  billingCycle: string;
  trialEndsAt: Date | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  // Per-tenant quota overrides (#71).
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
  // The version this subscription is bound to. Null only for legacy
  // subscriptions that escaped the backfill in 91-plan-versions.sql.
  boundVersion: {
    id: string;
    versionNumber: number;
  } | null;
  // The plan's current published version_number. May exceed
  // boundVersion.versionNumber when the catalogue has been edited
  // since this tenant signed up — the UI uses the gap to surface
  // a "newer pricing available" prompt.
  currentVersionNumber: number | null;
  // Active + pending_removal add-ons (#120). Cancelled addons are
  // hidden from this list — they're audit-only.
  addons: {
    id: string;
    addonId: string;
    code: string;
    name: string;
    monthlyPriceCents: number;
    yearlyPriceCents: number;
    grantsFeatures: string[];
    status: string;
    billingCycle: string;
    currentPeriodEnd: Date;
    cancelledAt: Date | null;
  }[];
} | null> {
  const rows = await db
    .select({
      subscription: schema.tenantSubscriptions,
      plan: schema.plans,
      boundVersion: schema.planVersions,
    })
    .from(schema.tenantSubscriptions)
    .leftJoin(
      schema.plans,
      eq(schema.plans.id, schema.tenantSubscriptions.planId),
    )
    .leftJoin(
      schema.planVersions,
      eq(schema.planVersions.id, schema.tenantSubscriptions.planVersionId),
    )
    .where(eq(schema.tenantSubscriptions.tenantId, tenantId))
    .limit(1);
  const row = rows[0];
  if (!row || !row.plan) return null;

  // Resolve the plan's current version_number — same plan_id, plan's
  // current_version_id pointer.
  let currentVersionNumber: number | null = null;
  if (row.plan.currentVersionId) {
    const cur = await db
      .select({ versionNumber: schema.planVersions.versionNumber })
      .from(schema.planVersions)
      .where(eq(schema.planVersions.id, row.plan.currentVersionId))
      .limit(1);
    currentVersionNumber = cur[0]?.versionNumber ?? null;
  }

  // Effective values from boundVersion when present, plan otherwise.
  const eff = row.boundVersion ?? row.plan;
  const features = Array.isArray(eff.features)
    ? (eff.features as string[])
    : [];

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
      // name/tagline/currency/prices/caps/features come from the
      // BOUND version (or plan as fallback). A grandfathered tenant
      // sees the price they bought, not the latest.
      name: eff.name,
      tagline: eff.tagline,
      monthlyPriceCents: eff.monthlyPriceCents,
      yearlyPriceCents: eff.yearlyPriceCents,
      currency: eff.currency,
      maxUsers: eff.maxUsers,
      maxInvoicesMonthly: eff.maxInvoicesMonthly,
      maxBranches: eff.maxBranches,
      maxWarehouses: eff.maxWarehouses,
      features,
    },
    boundVersion: row.boundVersion
      ? {
          id: row.boundVersion.id,
          versionNumber: row.boundVersion.versionNumber,
        }
      : null,
    currentVersionNumber,
    addons: await listActiveTenantAddons(tenantId),
  };
}

/**
 * Auto-cancel any active addons whose granted features are now
 * redundantly supplied by the tenant's plan (#120 / pricing-spec §7.1
 * "auto-removal on tier upgrade"). Called by every change-plan path
 * (platform admin + tenant self-serve) AFTER the subscription row has
 * been updated to the new plan.
 *
 * Idempotent — re-calling on a tenant whose addons are already
 * non-redundant is a no-op. Returns the list of addons that were
 * auto-removed so the caller can audit them or surface a confirmation
 * message.
 */
export async function autoRemoveRedundantAddons(
  tenantId: string,
  newPlanFeatures: string[],
): Promise<{ tenantAddonId: string; addonCode: string }[]> {
  if (newPlanFeatures.length === 0) return [];

  const rows = await db
    .select({
      tenantAddonId: schema.tenantAddons.id,
      addonId: schema.addons.id,
      addonCode: schema.addons.code,
      addonName: schema.addons.name,
      grantsFeatures: schema.addons.grantsFeatures,
    })
    .from(schema.tenantAddons)
    .leftJoin(schema.addons, eq(schema.addons.id, schema.tenantAddons.addonId))
    .where(
      and(
        eq(schema.tenantAddons.tenantId, tenantId),
        inArray(schema.tenantAddons.status, ["active", "pending_removal"]),
      ),
    );

  const planFeatureSet = new Set(newPlanFeatures);
  const redundant = rows.filter((r) => {
    const grants = Array.isArray(r.grantsFeatures)
      ? (r.grantsFeatures as string[])
      : [];
    if (grants.length === 0) return false;
    // Redundant when EVERY granted feature is already in the plan.
    // A partial overlap (addon grants A+B; plan only has A) means the
    // user is still getting value from the addon — leave it active.
    return grants.every((f) => planFeatureSet.has(f));
  });

  if (redundant.length === 0) return [];

  await db
    .update(schema.tenantAddons)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      autoRemovedAt: new Date(),
      cancelReason: "Auto-removed: included in new plan",
      updatedAt: new Date(),
    })
    .where(
      inArray(
        schema.tenantAddons.id,
        redundant.map((r) => r.tenantAddonId),
      ),
    );

  return redundant.map((r) => ({
    tenantAddonId: r.tenantAddonId,
    addonCode: r.addonCode ?? "?",
  }));
}

/**
 * Active + pending_removal addons for a tenant. Skips cancelled rows.
 * Used by getTenantSubscription so the settings page can render the
 * add-on shelf inline with the plan card.
 */
async function listActiveTenantAddons(tenantId: string): Promise<
  {
    id: string;
    addonId: string;
    code: string;
    name: string;
    monthlyPriceCents: number;
    yearlyPriceCents: number;
    grantsFeatures: string[];
    status: string;
    billingCycle: string;
    currentPeriodEnd: Date;
    cancelledAt: Date | null;
  }[]
> {
  const rows = await db
    .select({
      tenantAddon: schema.tenantAddons,
      addon: schema.addons,
    })
    .from(schema.tenantAddons)
    .leftJoin(schema.addons, eq(schema.addons.id, schema.tenantAddons.addonId))
    .where(
      and(
        eq(schema.tenantAddons.tenantId, tenantId),
        inArray(schema.tenantAddons.status, ["active", "pending_removal"]),
      ),
    );
  return rows
    .filter((r) => r.addon !== null)
    .map((r) => ({
      id: r.tenantAddon.id,
      addonId: r.tenantAddon.addonId,
      code: r.addon!.code,
      name: r.addon!.name,
      monthlyPriceCents: r.addon!.monthlyPriceCents,
      yearlyPriceCents: r.addon!.yearlyPriceCents,
      grantsFeatures: Array.isArray(r.addon!.grantsFeatures)
        ? (r.addon!.grantsFeatures as string[])
        : [],
      status: r.tenantAddon.status,
      billingCycle: r.tenantAddon.billingCycle,
      currentPeriodEnd: r.tenantAddon.currentPeriodEnd,
      cancelledAt: r.tenantAddon.cancelledAt,
    }));
}
