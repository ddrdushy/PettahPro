import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Database } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";

// Defaults applied when the stored JSON doesn't have a key.
// Keep this as the single source of truth — the API always merges defaults
// over the stored value, so we never need to backfill new settings.
// Note: literal unions don't survive `typeof DEFAULTS`, so we declare the
// shape explicitly and only use DEFAULTS for runtime values.
export type StockRelieveOn = "invoice" | "delivery_note";
export interface TenantSettings {
  salaryDaysPerMonth: number;
  // When stock is relieved from inventory (COGS journal + stock_ledger write).
  //   "invoice"       — default; relief at invoice post.
  //   "delivery_note" — relief at DN deliver; invoice post skips stock moves.
  // In DN mode, posting an invoice without first delivering a DN results in
  // no COGS recorded — this is intentional (businesses that choose this mode
  // use DNs as the stock-flow source of truth).
  stockRelieveOn: StockRelieveOn;
  // Threshold (cents) above which a manual journal entry goes to a drafts
  // queue requiring second-pair-of-eyes approval before posting. 0 = no
  // approval required (current default — backward compatible).
  journalApprovalThresholdCents: number;
  // Master toggle for the purchase-requisitions module (roadmap #30). Off
  // by default; enabling exposes the sidebar entry, API routes (which
  // otherwise 403 FEATURE_DISABLED), and the settings-form toggle.
  purchaseRequisitionsEnabled: boolean;
  // Tenant logo (M9 / gaps M9). Bytes live in MinIO under
  // `<tenant>/_branding/logo`; we only persist the metadata here so the
  // PDF renderer + web header can decide whether to fetch it. Mutated
  // exclusively via /settings/logo (POST upload, DELETE clear) — the
  // PATCH on /settings ignores these keys.
  logoObjectKey: string | null;
  logoContentType: string | null;
  logoUpdatedAt: string | null;
}

export const SETTINGS_DEFAULTS: TenantSettings = {
  salaryDaysPerMonth: 30,
  stockRelieveOn: "invoice",
  journalApprovalThresholdCents: 0,
  purchaseRequisitionsEnabled: false,
  logoObjectKey: null,
  logoContentType: null,
  logoUpdatedAt: null,
};

const PatchSchema = z.object({
  salaryDaysPerMonth: z.number().int().min(20).max(31).optional(),
  stockRelieveOn: z.enum(["invoice", "delivery_note"]).optional(),
  journalApprovalThresholdCents: z.number().int().min(0).optional(),
  purchaseRequisitionsEnabled: z.boolean().optional(),
});

// Used server-side by modules that need a single setting (e.g. payroll).
export async function loadTenantSettings(tx: Database): Promise<TenantSettings> {
  const rows = (await tx.execute(sql`
    SELECT settings FROM tenant_settings WHERE tenant_id = current_tenant_id()
  `)) as unknown as Array<{ settings: Record<string, unknown> | null }>;
  const stored = rows[0]?.settings ?? {};
  return { ...SETTINGS_DEFAULTS, ...stored } as TenantSettings;
}

export const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const settings = await withTenant(ctx.tenantId, (tx) => loadTenantSettings(tx));
    return reply.send({ settings, defaults: SETTINGS_DEFAULTS });
  });

  fastify.patch("/", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;

    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const updates = parsed.data;
    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ error: { code: "NO_FIELDS", message: "No fields to update." } });
    }

    const settings = await withTenant(ctx.tenantId, async (tx) => {
      // Upsert: merge patch into existing JSON; create a row if none exists.
      await tx.execute(sql`
        INSERT INTO tenant_settings (tenant_id, settings, updated_by_user_id)
        VALUES (current_tenant_id(), ${JSON.stringify(updates)}::jsonb, ${ctx.userId}::uuid)
        ON CONFLICT (tenant_id) DO UPDATE
          SET settings = tenant_settings.settings || EXCLUDED.settings,
              updated_at = now(),
              updated_by_user_id = EXCLUDED.updated_by_user_id
      `);
      return loadTenantSettings(tx);
    });

    return reply.send({ settings, defaults: SETTINGS_DEFAULTS });
  });
};
