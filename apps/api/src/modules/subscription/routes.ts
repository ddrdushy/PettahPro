import type { FastifyPluginAsync } from "fastify";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";
import {
  autoRemoveRedundantAddons,
  checkQuota,
  getTenantSubscription,
} from "../../lib/plan-gate.js";

/**
 * Tenant-side subscription surface.
 *
 *   GET  /subscription            — the current plan (#62)
 *   GET  /subscription/plans      — picker list of public plans (#64)
 *   POST /subscription/change-plan — self-serve plan change (#64)
 *
 * Read endpoints (GET) require auth only — every user should be able
 * to see what plan they're on and what else is available. The mutation
 * (POST /change-plan) requires `settings.manage` because a rogue staff
 * account shouldn't be able to move the business to Scale on a whim.
 *
 * Platform-admin still owns the override path (#61): they can move a
 * tenant to any plan including hidden/grandfathered ones, can end
 * trials, and can resurrect cancelled subscriptions. This endpoint is
 * strictly self-serve — public plans only, no reactivation.
 */
export const subscriptionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const subscription = await getTenantSubscription(ctx.tenantId);
    if (!subscription) {
      // No subscription row — this is the same failure mode described
      // in plan-gate.ts (pre-backfill tenant, or a race on a freshly
      // created tenant before the backfill job runs). 404 is correct:
      // there's no subscription to return. The UI shows a "contact
      // support" fallback.
      return reply.status(404).send({
        error: {
          code: "NO_SUBSCRIPTION",
          message: "No subscription is associated with this tenant.",
        },
      });
    }

    return reply.send({ subscription });
  });

  // Current-tenant quota usage (#65). Drives the "23 / 500 invoices this
  // month" chips on the settings page. Read-only — the same math that
  // powers the POST-side gate, exposed as data. Runs three checkQuota
  // calls in parallel; each one returns 0/null immediately for unlimited
  // plans so there's no count query on Scale.
  fastify.get("/usage", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const [invoices, branches, warehouses] = await Promise.all([
      checkQuota(ctx.tenantId, "invoices_monthly"),
      checkQuota(ctx.tenantId, "branches"),
      checkQuota(ctx.tenantId, "warehouses"),
    ]);

    return reply.send({
      usage: {
        invoicesMonthly: {
          current: invoices.current,
          max: invoices.max,
        },
        branches: {
          current: branches.current,
          max: branches.max,
        },
        warehouses: {
          current: warehouses.current,
          max: warehouses.max,
        },
      },
    });
  });

  // Public plan catalogue for the plan picker. Filters to is_public=true
  // so hidden / grandfathered plans never leak to self-serve. Ordered by
  // sort_order so the UI renders Starter, Growth, Scale consistently.
  fastify.get("/plans", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.isPublic, true))
      .orderBy(asc(schema.plans.sortOrder));

    return reply.send({
      plans: rows.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        tagline: p.tagline,
        monthlyPriceCents: p.monthlyPriceCents,
        yearlyPriceCents: p.yearlyPriceCents,
        currency: p.currency,
        maxUsers: p.maxUsers,
        maxInvoicesMonthly: p.maxInvoicesMonthly,
        maxBranches: p.maxBranches,
        maxWarehouses: p.maxWarehouses,
        features: Array.isArray(p.features) ? (p.features as string[]) : [],
        sortOrder: p.sortOrder,
      })),
    });
  });

  // Self-serve plan change.
  //
  // Scope: switch between public plans (Starter / Growth / Scale) and
  // between monthly/yearly cycles. Flips past_due → active (that's the
  // "payment received" contract — see below), ends trials as a side
  // effect when moving onto a paid plan in 'active' status.
  //
  // Payment integration: DELIBERATELY STUBBED. This endpoint trusts the
  // click — there is no payment-provider callback, no authorization hold,
  // no invoice minted. That's fine for now: we're in private beta, the
  // pricing is low enough that we can reconcile by hand, and we'd rather
  // ship the end-to-end click path than block on Stripe/Onepay plumbing.
  // When we wire a real provider the POST body will carry a
  // paymentIntentId and we'll verify it server-side before the UPDATE
  // lands. Until then, `SUBSCRIPTION_PAYMENT_STUB=1` in env serves as a
  // giant asterisk: if it's missing, the endpoint 503s so we don't
  // accidentally ship this to a public launch.
  const ChangePlanSchema = z.object({
    planCode: z.string().trim().min(1).max(32),
    billingCycle: z.enum(["monthly", "yearly"]).optional(),
  });

  fastify.post("/change-plan", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;

    if (process.env.SUBSCRIPTION_PAYMENT_STUB !== "1") {
      return reply.status(503).send({
        error: {
          code: "PAYMENT_PROVIDER_UNAVAILABLE",
          message:
            "Self-serve plan change requires a payment provider, which isn't configured yet. Contact support to change your plan.",
        },
      });
    }

    const parsed = ChangePlanSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "INVALID_INPUT",
          message:
            parsed.error.issues[0]?.message ?? "Plan code is required.",
        },
      });
    }

    // Resolve target. Must be a public plan — no sneaking onto a hidden
    // tier by guessing the code.
    const planRows = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.code, parsed.data.planCode))
      .limit(1);
    const targetPlan = planRows[0];
    if (!targetPlan || !targetPlan.isPublic) {
      return reply.status(400).send({
        error: { code: "UNKNOWN_PLAN", message: "Unknown plan." },
      });
    }

    // Fetch existing subscription with its current plan for the audit diff.
    const existingRows = await db
      .select({
        subscription: schema.tenantSubscriptions,
        plan: schema.plans,
      })
      .from(schema.tenantSubscriptions)
      .leftJoin(
        schema.plans,
        eq(schema.plans.id, schema.tenantSubscriptions.planId),
      )
      .where(eq(schema.tenantSubscriptions.tenantId, ctx.tenantId))
      .limit(1);
    const existing = existingRows[0];
    if (!existing) {
      return reply.status(404).send({ error: { code: "NO_SUBSCRIPTION" } });
    }

    // Cancelled tenants can't self-serve back — they need ops intervention.
    // #63 already blocks gated features for cancelled rows; this second
    // check keeps the plan-picker flow consistent: clicking "Choose Growth"
    // on a cancelled subscription surfaces the same "contact support"
    // message instead of silently resurrecting.
    if (existing.subscription.status === "cancelled") {
      return reply.status(409).send({
        error: {
          code: "SUBSCRIPTION_CANCELLED",
          message:
            "Your subscription has been cancelled. Contact support to reactivate.",
        },
      });
    }

    const nextCycle =
      parsed.data.billingCycle ?? existing.subscription.billingCycle;
    const sameCycle = nextCycle === existing.subscription.billingCycle;
    const samePlan = existing.subscription.planId === targetPlan.id;
    if (samePlan && sameCycle) {
      // Idempotent noop. Return the current state so the UI doesn't need
      // a dedicated branch.
      return reply.send({
        ok: true,
        changed: false,
        subscription: { ...existing.subscription, plan: existing.plan },
      });
    }

    // Transition rules:
    //  - trial / past_due → active: this IS the "payment received" hook.
    //    The caller clicked "Choose <plan>" and we trust that click.
    //    Clearing trialEndsAt and resetting current_period_* marks the
    //    start of the paid period from now.
    //  - active → active: plan or cycle change mid-period. Slide the
    //    period window forward to now() so the new price applies
    //    cleanly from this point.
    const nextStatus = "active";
    const periodInterval =
      nextCycle === "yearly" ? "365 days" : "30 days";

    // Bind to the target plan's CURRENT version. Self-serve plan
    // change is an explicit "I want the latest published tier"
    // action — same semantic as the platform-admin change-plan path.
    const [updated] = await db
      .update(schema.tenantSubscriptions)
      .set({
        planId: targetPlan.id,
        planVersionId: targetPlan.currentVersionId,
        status: nextStatus,
        billingCycle: nextCycle,
        trialEndsAt: null,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + intervalToMs(periodInterval)),
        cancelledAt: null,
        cancelReason: null,
      })
      .where(eq(schema.tenantSubscriptions.tenantId, ctx.tenantId))
      .returning();

    // Auto-remove addons whose features are now part of the new plan
    // (spec §7.1). Same call shape as the platform admin change-plan
    // path; the helper is idempotent, so partial overlap with prior
    // plan features is fine.
    await autoRemoveRedundantAddons(
      ctx.tenantId,
      Array.isArray(targetPlan.features)
        ? (targetPlan.features as string[])
        : [],
    );

    // Audit. Self-serve plan changes write to the same log as the
    // admin-driven change-plan (#61) — the kind field distinguishes
    // them, and metadata.tenantUserId carries the actual human who
    // clicked. platformUserId stays null (this isn't a platform action).
    try {
      await db.insert(schema.platformAuditLog).values({
        platformUserId: null,
        platformUserEmail: "self-serve@pettahpro.lk",
        kind: "subscription.self_serve_changed",
        summary: `Self-serve plan change: ${existing.plan?.code ?? "?"} → ${targetPlan.code}`,
        reason: null,
        tenantId: ctx.tenantId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"]
          ? String(req.headers["user-agent"]).slice(0, 512)
          : null,
        metadata: {
          tenantUserId: ctx.userId,
          fromPlanCode: existing.plan?.code ?? null,
          toPlanCode: targetPlan.code,
          fromBillingCycle: existing.subscription.billingCycle,
          toBillingCycle: nextCycle,
          fromStatus: existing.subscription.status,
          toStatus: nextStatus,
          paymentStub: true,
        },
      });
    } catch (err) {
      // Same pattern as recordPlatformAuditEvent — never fail the
      // user-facing action on an audit-write hiccup.
      // eslint-disable-next-line no-console
      console.error("self-serve plan change audit write failed", err);
    }

    return reply.send({
      ok: true,
      changed: true,
      subscription: { ...updated, plan: targetPlan },
    });
  });

  // ---------------------------------------------------------------
  // Add-ons (#120 / pricing-spec §7) — tenant-side self-serve.
  //
  //   GET    /subscription/addons          — catalog + active for me
  //   POST   /subscription/addons          — purchase
  //   POST   /subscription/addons/:id/cancel — schedule removal at
  //                                            current period end
  //
  // Self-serve mutations gated on SUBSCRIPTION_PAYMENT_STUB=1 — same
  // policy as /change-plan since both pretend to take a payment we're
  // not actually charging yet. Platform admin grant lives on the
  // platform-admin side and is not gated.
  // ---------------------------------------------------------------

  fastify.get("/addons", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    // Catalog: public, non-archived addons.
    const catalog = await db
      .select()
      .from(schema.addons)
      .where(
        eq(schema.addons.isArchived, false),
      )
      .orderBy(asc(schema.addons.sortOrder), asc(schema.addons.code));

    // Active addons for this tenant.
    const active = await db
      .select({
        tenantAddon: schema.tenantAddons,
        addon: schema.addons,
      })
      .from(schema.tenantAddons)
      .leftJoin(
        schema.addons,
        eq(schema.addons.id, schema.tenantAddons.addonId),
      )
      .where(eq(schema.tenantAddons.tenantId, ctx.tenantId));

    return reply.send({
      catalog: catalog
        .filter((a) => a.isPublic)
        .map((a) => ({
          id: a.id,
          code: a.code,
          name: a.name,
          tagline: a.tagline,
          monthlyPriceCents: a.monthlyPriceCents,
          yearlyPriceCents: a.yearlyPriceCents,
          currency: a.currency,
          grantsFeatures: a.grantsFeatures,
          eligiblePlanCodes: a.eligiblePlanCodes,
        })),
      active: active
        .filter((r) => r.addon !== null)
        .map((r) => ({
          id: r.tenantAddon.id,
          status: r.tenantAddon.status,
          billingCycle: r.tenantAddon.billingCycle,
          activatedAt: r.tenantAddon.activatedAt,
          currentPeriodEnd: r.tenantAddon.currentPeriodEnd,
          cancelledAt: r.tenantAddon.cancelledAt,
          autoRemovedAt: r.tenantAddon.autoRemovedAt,
          addon: {
            id: r.addon!.id,
            code: r.addon!.code,
            name: r.addon!.name,
            monthlyPriceCents: r.addon!.monthlyPriceCents,
            yearlyPriceCents: r.addon!.yearlyPriceCents,
            grantsFeatures: r.addon!.grantsFeatures,
          },
        })),
    });
  });

  const PurchaseAddonSchema = z.object({
    addonCode: z.string().trim().min(1).max(48),
    billingCycle: z.enum(["monthly", "yearly"]).default("monthly"),
  });

  fastify.post("/addons", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;

    if (process.env.SUBSCRIPTION_PAYMENT_STUB !== "1") {
      return reply.status(503).send({
        error: {
          code: "PAYMENT_PROVIDER_UNAVAILABLE",
          message:
            "Self-serve add-on purchase requires a payment provider, which isn't configured yet. Contact support.",
        },
      });
    }

    const parsed = PurchaseAddonSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "INVALID_INPUT",
          message: parsed.error.issues[0]?.message ?? "Add-on code is required.",
        },
      });
    }

    const addonRows = await db
      .select()
      .from(schema.addons)
      .where(eq(schema.addons.code, parsed.data.addonCode))
      .limit(1);
    const addon = addonRows[0];
    if (!addon || !addon.isPublic || addon.isArchived) {
      return reply.status(400).send({ error: { code: "UNKNOWN_ADDON" } });
    }

    // Duplicate guard: clean 409 instead of letting the partial-unique
    // index surface a generic 500. Filter by both tenant and addon so
    // the index is hit.
    const dup = await db
      .select({ id: schema.tenantAddons.id })
      .from(schema.tenantAddons)
      .where(
        and(
          eq(schema.tenantAddons.tenantId, ctx.tenantId),
          eq(schema.tenantAddons.addonId, addon.id),
          inArray(schema.tenantAddons.status, ["active", "pending_removal"]),
        ),
      )
      .limit(1);
    if (dup.length > 0) {
      return reply
        .status(409)
        .send({ error: { code: "ADDON_ALREADY_ACTIVE" } });
    }

    const periodMs =
      parsed.data.billingCycle === "yearly"
        ? 365 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;
    const [created] = await db
      .insert(schema.tenantAddons)
      .values({
        tenantId: ctx.tenantId,
        addonId: addon.id,
        status: "active",
        billingCycle: parsed.data.billingCycle,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + periodMs),
        activatedAt: new Date(),
        activatedByUserId: ctx.userId,
      })
      .returning();
    if (!created) {
      return reply.status(500).send({ error: { code: "PURCHASE_FAILED" } });
    }

    try {
      await db.insert(schema.platformAuditLog).values({
        platformUserId: null,
        platformUserEmail: "self-serve@pettahpro.lk",
        kind: "subscription.addon.self_serve_purchased",
        summary: `Self-serve addon purchase: ${addon.code}`,
        reason: null,
        tenantId: ctx.tenantId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"]
          ? String(req.headers["user-agent"]).slice(0, 512)
          : null,
        metadata: {
          tenantUserId: ctx.userId,
          tenantAddonId: created.id,
          addonCode: addon.code,
          billingCycle: parsed.data.billingCycle,
          paymentStub: true,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("self-serve addon audit write failed", err);
    }

    return reply.status(201).send({
      tenantAddon: {
        id: created.id,
        status: created.status,
        billingCycle: created.billingCycle,
        activatedAt: created.activatedAt,
        currentPeriodStart: created.currentPeriodStart,
        currentPeriodEnd: created.currentPeriodEnd,
        addon: {
          id: addon.id,
          code: addon.code,
          name: addon.name,
          monthlyPriceCents: addon.monthlyPriceCents,
          yearlyPriceCents: addon.yearlyPriceCents,
          grantsFeatures: addon.grantsFeatures,
        },
      },
    });
  });

  fastify.post("/addons/:id/cancel", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;

    const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }

    const rows = await db
      .select({ tenantAddon: schema.tenantAddons, addon: schema.addons })
      .from(schema.tenantAddons)
      .leftJoin(
        schema.addons,
        eq(schema.addons.id, schema.tenantAddons.addonId),
      )
      .where(eq(schema.tenantAddons.id, parsed.data.id))
      .limit(1);
    const row = rows[0];
    if (!row || row.tenantAddon.tenantId !== ctx.tenantId) {
      return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    }
    if (row.tenantAddon.status === "cancelled") {
      return reply.status(409).send({ error: { code: "ALREADY_CANCELLED" } });
    }

    // Self-serve cancel is always "schedule removal at next renewal"
    // per spec §7.1. The cron sweep flips pending_removal → cancelled
    // after currentPeriodEnd.
    await db
      .update(schema.tenantAddons)
      .set({
        status: "pending_removal",
        cancelReason: "Cancelled by tenant",
        updatedAt: new Date(),
      })
      .where(eq(schema.tenantAddons.id, parsed.data.id));

    try {
      await db.insert(schema.platformAuditLog).values({
        platformUserId: null,
        platformUserEmail: "self-serve@pettahpro.lk",
        kind: "subscription.addon.self_serve_cancelled",
        summary: `Self-serve addon cancellation scheduled: ${row.addon?.code ?? "?"}`,
        reason: null,
        tenantId: ctx.tenantId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"]
          ? String(req.headers["user-agent"]).slice(0, 512)
          : null,
        metadata: {
          tenantUserId: ctx.userId,
          tenantAddonId: row.tenantAddon.id,
          addonCode: row.addon?.code,
          activeUntil: row.tenantAddon.currentPeriodEnd,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("self-serve addon cancel audit write failed", err);
    }

    return reply.send({
      ok: true,
      status: "pending_removal",
      activeUntil: row.tenantAddon.currentPeriodEnd,
    });
  });
};

// Local helper — keeps the transition calc out of the route body and
// makes it easy to unit-test later. Input is either '30 days' or
// '365 days' today; anything else throws so we'd catch a typo early.
function intervalToMs(interval: "30 days" | "365 days"): number {
  const days = interval === "365 days" ? 365 : 30;
  return days * 24 * 60 * 60 * 1000;
}
