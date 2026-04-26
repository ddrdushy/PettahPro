import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { withTenant } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";

/**
 * Onboarding checklist (#I2 / gaps I2).
 *
 *   GET  /onboarding         — checklist + dismissed flag.
 *   POST /onboarding/dismiss — hide the checklist on the dashboard.
 *   POST /onboarding/restore — show it again.
 *
 * Step completion is **derived** — we don't track "user clicked done"
 * because there's no way to keep that honest if the user undoes the
 * action. Instead we run one parametric SQL count over the things we
 * care about (customers, items, invoices, demo data, CoA edits). If
 * a row exists, the step is done; if every row is gone, the step
 * resets. That makes the checklist self-healing — it will never tell
 * a tenant "create your first customer" once they actually have one.
 *
 * Dismissal is a single boolean on tenant_settings — once a tenant
 * clicks "I'm good, hide this" we stop showing the panel even if
 * steps remain incomplete. They can restore it from settings later.
 */

export const onboardingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      // Single SQL round-trip — five existence checks via EXISTS so
      // we don't pay for full counts (we only need bool per metric).
      // All tables have RLS so current_tenant_id() filters them.
      const rows = (await tx.execute(sql`
        SELECT
          (SELECT settings FROM tenant_settings WHERE tenant_id = current_tenant_id()) AS settings,
          EXISTS(SELECT 1 FROM customers WHERE deleted_at IS NULL) AS has_customer,
          EXISTS(SELECT 1 FROM items WHERE deleted_at IS NULL) AS has_item,
          EXISTS(SELECT 1 FROM invoices WHERE deleted_at IS NULL) AS has_invoice,
          EXISTS(SELECT 1 FROM journal_entries) AS has_journal,
          EXISTS(SELECT 1 FROM demo_data_seeds) AS has_demo_data,
          EXISTS(
            SELECT 1 FROM audit_events
             WHERE kind IN ('coa.account_created','coa.account_updated','coa.account_deleted')
          ) AS has_coa_edit
      `)) as unknown as Array<{
        settings: Record<string, unknown> | null;
        has_customer: boolean;
        has_item: boolean;
        has_invoice: boolean;
        has_journal: boolean;
        has_demo_data: boolean;
        has_coa_edit: boolean;
      }>;
      const r = rows[0];
      const settings = (r?.settings ?? {}) as Record<string, unknown>;
      return {
        dismissed: settings.onboardingDismissed === true,
        hasCustomer: !!r?.has_customer,
        hasItem: !!r?.has_item,
        hasInvoice: !!r?.has_invoice,
        hasJournal: !!r?.has_journal,
        hasDemoData: !!r?.has_demo_data,
        hasCoaEdit: !!r?.has_coa_edit,
      };
    });

    // Step list — keep keys stable across releases so the web side
    // can switch on them. Order matters: it's the rendering order.
    const steps = [
      {
        key: "explore_demo",
        label: "Try the system with sample data (optional)",
        description:
          "Load a small set of demo customers, items, invoices and bills so you can see how PettahPro looks with data in it. One click to clear when you're done.",
        deepLinkPath: "/app/settings/demo-data",
        complete: data.hasDemoData,
        // Demo data is optional — count it as "skipped" for progress
        // math if the tenant has any real activity instead.
        optional: true,
      },
      {
        key: "review_coa",
        label: "Review your chart of accounts",
        description:
          "We seeded a Sri-Lanka-typical chart of accounts. Rename anything that doesn't match how you talk about it; deactivate accounts you won't use.",
        deepLinkPath: "/app/coa",
        complete: data.hasCoaEdit,
      },
      {
        key: "first_customer",
        label: "Add your first customer",
        description:
          "The customer record holds the contact info, payment terms, and credit limit you'll use on every invoice you send them.",
        deepLinkPath: "/app/customers",
        complete: data.hasCustomer,
      },
      {
        key: "first_item",
        label: "Add your first item or service",
        description:
          "Products you sell, services you bill for. Items carry default pricing, the tax code that applies, and (for products) inventory tracking.",
        deepLinkPath: "/app/items",
        complete: data.hasItem,
      },
      {
        key: "first_invoice",
        label: "Send your first invoice",
        description:
          "Bring it together — pick a customer, add line items, post. Posting books the AR + revenue + tax journal automatically.",
        deepLinkPath: "/app/invoices/new",
        complete: data.hasInvoice,
      },
    ];

    const required = steps.filter((s) => !s.optional);
    const completedRequired = required.filter((s) => s.complete).length;
    const allDone = required.every((s) => s.complete);

    return reply.send({
      dismissed: data.dismissed,
      allDone,
      completedRequired,
      totalRequired: required.length,
      steps,
    });
  });

  fastify.post("/dismiss", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;

    await withTenant(ctx.tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO tenant_settings (tenant_id, settings, updated_by_user_id)
        VALUES (current_tenant_id(), '{"onboardingDismissed": true}'::jsonb, ${ctx.userId}::uuid)
        ON CONFLICT (tenant_id) DO UPDATE
          SET settings = tenant_settings.settings || '{"onboardingDismissed": true}'::jsonb,
              updated_at = now(),
              updated_by_user_id = ${ctx.userId}::uuid
      `);
    });
    return reply.send({ ok: true });
  });

  fastify.post("/restore", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;

    await withTenant(ctx.tenantId, async (tx) => {
      await tx.execute(sql`
        UPDATE tenant_settings
           SET settings = settings - 'onboardingDismissed',
               updated_at = now(),
               updated_by_user_id = ${ctx.userId}::uuid
         WHERE tenant_id = current_tenant_id()
      `);
    });
    return reply.send({ ok: true });
  });
};
