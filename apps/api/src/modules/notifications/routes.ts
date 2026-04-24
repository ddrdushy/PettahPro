import type { FastifyPluginAsync } from "fastify";
import { sql, and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

// Canonical list of event kinds the emit() callers pass today. UI renders
// one toggle per kind; anything emitted outside this list is still deliverable
// but won't appear as a configurable switch (degrades gracefully — the
// row is just "never toggled", i.e. enabled).
//
// Keep this aligned with actual emitNotification() call sites. The source
// of truth is the emitter, not this list — new kinds added to the app
// become enabled-by-default until someone adds them to the UI dictionary.
//
// Naming convention: snake_case (underscore) to match the emit sites.
// Prior to PR #69 the catalog used dotted form (invoice.posted) while
// emits used snake_case (invoice_posted) — so every user preference toggle
// silently failed. Kept as a single canonical style here to prevent
// regressions; grep `kind: "<name>"` when adding a new notification.
const NOTIFICATION_KIND_CATALOG: ReadonlyArray<{
  kind: string;
  label: string;
  description: string;
}> = [
  // Sell
  { kind: "invoice_posted",        label: "Invoice posted",         description: "An invoice was posted to the ledger." },
  { kind: "payment_received",      label: "Payment received",       description: "A customer payment was recorded." },
  { kind: "pos_sale_posted",       label: "POS sale posted",        description: "A sale was rung through the POS terminal." },
  { kind: "pos_shift_variance",    label: "POS shift variance",     description: "A POS shift closed with a cash over/short." },
  // Buy
  { kind: "bill_posted",           label: "Bill posted",            description: "A supplier bill was posted." },
  // Accounting
  { kind: "je_approval_pending",   label: "Journal pending review", description: "A journal entry needs your approval." },
  { kind: "je_approved",           label: "Journal approved",       description: "A journal entry you submitted was approved." },
  { kind: "je_rejected",           label: "Journal rejected",       description: "A journal entry you submitted was rejected." },
  { kind: "period_closed",         label: "Period closed",          description: "An accounting period was soft-closed." },
  { kind: "period_reopened",       label: "Period reopened",        description: "A closed accounting period was reopened." },
  { kind: "year_closed",           label: "Year closed",            description: "A fiscal year was closed and the closing entry posted." },
  // Inventory
  { kind: "low_stock",             label: "Low stock",              description: "An item dropped below its reorder level." },
  // Cheques
  { kind: "cheque_stale",          label: "Stale cheque",           description: "A cheque has been unused for 6 months and was auto-flagged." },
];

/**
 * Notifications are scoped per (tenant, user). A row with user_id = NULL is
 * a broadcast visible to every user in the tenant — we union it in at read
 * time. Mark-read on a broadcast creates a per-user receipt by cloning the
 * row with the current user_id set (simplest model without a separate
 * receipts table; ~10× read cost for broadcasts is fine at current volume).
 *
 * For v1 we keep it even simpler: mark-read only works on rows that already
 * have the caller's user_id. Broadcasts stay "unread" until a per-user copy
 * is explicitly created. If broadcasts turn out to matter (platform
 * announcements), we'll add the receipts table then.
 */

export const notificationsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /notifications?limit=20 — recent items for the bell dropdown
  fastify.get<{ Querystring: { limit?: string } }>(
    "/",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const limit = Math.min(Math.max(Number(req.query.limit ?? 20), 1), 100);

      const rows = await withTenant(ctx.tenantId, async (tx) => {
        return (await tx.execute(sql`
          SELECT id, kind, title, body, ref_type, ref_id,
                 read_at, created_at,
                 (user_id IS NULL) AS is_broadcast
          FROM notifications
          WHERE tenant_id = current_tenant_id()
            AND (user_id = ${ctx.userId}::uuid OR user_id IS NULL)
          ORDER BY (read_at IS NULL) DESC, created_at DESC
          LIMIT ${limit}
        `)) as unknown as Array<{
          id: string;
          kind: string;
          title: string;
          body: string | null;
          ref_type: string | null;
          ref_id: string | null;
          read_at: string | null;
          created_at: string;
          is_broadcast: boolean;
        }>;
      });

      return reply.send({
        notifications: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          title: r.title,
          body: r.body,
          refType: r.ref_type,
          refId: r.ref_id,
          readAt: r.read_at,
          createdAt: r.created_at,
          isBroadcast: r.is_broadcast,
        })),
      });
    },
  );

  // GET /notifications/unread-count — tiny endpoint polled by the bell
  fastify.get("/unread-count", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const [row] = await withTenant(ctx.tenantId, async (tx) => {
      return (await tx.execute(sql`
        SELECT COUNT(*)::int AS n
        FROM notifications
        WHERE tenant_id = current_tenant_id()
          AND read_at IS NULL
          AND (user_id = ${ctx.userId}::uuid OR user_id IS NULL)
      `)) as unknown as Array<{ n: number }>;
    });

    return reply.send({ count: Number(row?.n ?? 0) });
  });

  // POST /notifications/:id/read — mark one notification read
  fastify.post<{ Params: { id: string } }>("/:id/read", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    await withTenant(ctx.tenantId, async (tx) => {
      await tx.execute(sql`
        UPDATE notifications
        SET read_at = now()
        WHERE tenant_id = current_tenant_id()
          AND id = ${req.params.id}::uuid
          AND user_id = ${ctx.userId}::uuid
          AND read_at IS NULL
      `);
    });

    return reply.send({ ok: true });
  });

  // POST /notifications/read-all — mark every unread notification read for this user
  fastify.post("/read-all", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rowCount = await withTenant(ctx.tenantId, async (tx) => {
      const result = await tx.execute(sql`
        UPDATE notifications
        SET read_at = now()
        WHERE tenant_id = current_tenant_id()
          AND user_id = ${ctx.userId}::uuid
          AND read_at IS NULL
      `);
      // drizzle returns { rowsAffected } on postgres-js via the underlying
      // result. Fall through to 0 if not present.
      return (result as unknown as { rowsAffected?: number }).rowsAffected ?? 0;
    });

    return reply.send({ ok: true, markedRead: rowCount });
  });

  // GET /notifications/preferences — the catalog plus the caller's overrides.
  //
  // Shape: { preferences: [{ kind, label, description, enabled }] }. If no
  // row exists for a kind, we return enabled=true (default-on). Kinds emitted
  // in the wild but not in the catalog still get a row if the user has
  // explicitly toggled them — the UI renders those under an "Other" section.
  fastify.get("/preferences", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const overrides = await withTenant(ctx.tenantId, async (tx) => {
      return tx
        .select({
          kind: schema.notificationPreferences.kind,
          enabled: schema.notificationPreferences.enabled,
          cadence: schema.notificationPreferences.cadence,
          emailEnabled: schema.notificationPreferences.emailEnabled,
        })
        .from(schema.notificationPreferences)
        .where(
          and(
            eq(schema.notificationPreferences.tenantId, ctx.tenantId),
            eq(schema.notificationPreferences.userId, ctx.userId),
          ),
        );
    });
    const byKind = new Map(
      overrides.map((o) => [
        o.kind,
        { enabled: o.enabled, cadence: o.cadence, emailEnabled: o.emailEnabled },
      ]),
    );

    // Roadmap #45: cadence is returned alongside enabled. UI treats
    // `cadence='off'` as equivalent to `enabled=false`; server honours
    // both so pre-#45 rows (no cadence override → default 'immediate')
    // keep working without backfill.
    const resolveCadence = (
      row?: { enabled: boolean; cadence: string },
    ): "off" | "immediate" | "daily" | "weekly" => {
      if (!row) return "immediate";
      if (!row.enabled) return "off";
      return (row.cadence as "immediate" | "daily" | "weekly") ?? "immediate";
    };

    // Roadmap #53 / gap D1: emailEnabled is only meaningful when
    // cadence='immediate' (daily/weekly already email via the digest
    // cron, 'off' means no delivery at all). We still return the raw
    // stored flag so the UI can preserve the user's choice across
    // cadence flips, and the server layer enforces the semantic
    // constraint on PATCH.
    const preferences = [
      ...NOTIFICATION_KIND_CATALOG.map((c) => {
        const row = byKind.get(c.kind);
        return {
          kind: c.kind,
          label: c.label,
          description: c.description,
          enabled: row?.enabled ?? true,
          cadence: resolveCadence(row),
          emailEnabled: row?.emailEnabled ?? false,
          known: true as const,
        };
      }),
      ...overrides
        .filter((o) => !NOTIFICATION_KIND_CATALOG.some((c) => c.kind === o.kind))
        .map((o) => ({
          kind: o.kind,
          label: o.kind,
          description: "",
          enabled: o.enabled,
          cadence: resolveCadence({ enabled: o.enabled, cadence: o.cadence }),
          emailEnabled: o.emailEnabled,
          known: false as const,
        })),
    ];

    return reply.send({ preferences });
  });

  // PATCH /notifications/preferences/:kind — update cadence (and derive
  // enabled) + the immediate-email flag. Body accepts:
  //   • { enabled: boolean }                              — legacy on/off
  //   • { cadence: "off"|"immediate"|"daily"|"weekly" }   — roadmap #45
  //   • { emailEnabled: boolean }                         — roadmap #53
  // Any subset can be sent; at least one must be present. When both
  // `cadence` and `enabled` are sent, cadence wins and enabled is derived
  // (enabled = cadence !== 'off'); when only `enabled` is sent we flip
  // it and leave cadence as-is, falling back to 'immediate' on new rows.
  // `emailEnabled` is independent and gets read-modify-written against
  // the current row unless explicitly set in this request.
  fastify.patch<{
    Params: { kind: string };
    Body: {
      enabled?: boolean;
      cadence?: "off" | "immediate" | "daily" | "weekly";
      emailEnabled?: boolean;
    };
  }>("/preferences/:kind", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = z
      .object({
        enabled: z.boolean().optional(),
        cadence: z.enum(["off", "immediate", "daily", "weekly"]).optional(),
        emailEnabled: z.boolean().optional(),
      })
      .refine(
        (v) =>
          v.enabled !== undefined ||
          v.cadence !== undefined ||
          v.emailEnabled !== undefined,
        { message: "enabled, cadence, or emailEnabled is required" },
      )
      .safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const kind = req.params.kind.trim();
    if (!kind || kind.length > 64) {
      return reply.status(400).send({ error: { code: "INVALID_KIND" } });
    }

    // Derive the authoritative pair. If cadence is explicit we honour it;
    // otherwise we fall back to the legacy boolean toggle and default cadence.
    let cadence: "off" | "immediate" | "daily" | "weekly";
    let enabled: boolean;
    if (parsed.data.cadence) {
      cadence = parsed.data.cadence;
      enabled = cadence !== "off";
    } else if (parsed.data.enabled !== undefined) {
      enabled = parsed.data.enabled;
      cadence = enabled ? "immediate" : "off";
    } else {
      // Only emailEnabled was sent. Keep cadence/enabled as they were by
      // reading the existing row; default to immediate+enabled so a
      // first-time email opt-in works without forcing the UI to send
      // a cadence too.
      cadence = "immediate";
      enabled = true;
    }

    // Enforce the semantic constraint: when cadence='off' there's no
    // delivery channel to email on. Force the flag off so a stale UI
    // state can't leave ghost emails armed for later.
    const emailEnabled =
      cadence === "off" ? false : (parsed.data.emailEnabled ?? undefined);

    const result = await withTenant(ctx.tenantId, async (tx) => {
      // Read current emailEnabled when the caller didn't send one, so
      // the INSERT ... ON CONFLICT path doesn't blow it away on a
      // cadence-only flip.
      let effectiveEmailEnabled = emailEnabled;
      if (effectiveEmailEnabled === undefined) {
        const existing = (await tx.execute(sql`
          SELECT email_enabled FROM notification_preferences
          WHERE tenant_id = current_tenant_id()
            AND user_id = ${ctx.userId}::uuid
            AND kind = ${kind}
          LIMIT 1
        `)) as unknown as Array<{ email_enabled: boolean }>;
        effectiveEmailEnabled = existing[0]?.email_enabled ?? false;
      }
      if (cadence === "off") effectiveEmailEnabled = false;

      // Upsert on (tenant_id, user_id, kind) — unique index enforces.
      await tx.execute(sql`
        INSERT INTO notification_preferences (tenant_id, user_id, kind, enabled, cadence, email_enabled)
        VALUES (${ctx.tenantId}::uuid, ${ctx.userId}::uuid, ${kind}, ${enabled}, ${cadence}, ${effectiveEmailEnabled})
        ON CONFLICT (tenant_id, user_id, kind)
        DO UPDATE SET enabled = EXCLUDED.enabled,
                      cadence = EXCLUDED.cadence,
                      email_enabled = EXCLUDED.email_enabled,
                      updated_at = now()
      `);

      // When a user flips from digest → immediate/off, stale pending
      // queue rows would otherwise sit forever (cadence='daily' rows
      // with no one about to fire their digest). Clear them — the bell
      // notifications already captured the info for future events.
      if (cadence === "immediate" || cadence === "off") {
        await tx.execute(sql`
          DELETE FROM notification_digest_queue
          WHERE tenant_id = current_tenant_id()
            AND user_id = ${ctx.userId}::uuid
            AND kind = ${kind}
            AND delivered_at IS NULL
        `);
      }

      return { effectiveEmailEnabled };
    });

    return reply.send({
      ok: true,
      kind,
      enabled,
      cadence,
      emailEnabled: result.effectiveEmailEnabled,
    });
  });
};
