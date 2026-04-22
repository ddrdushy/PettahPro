// POS shift routes: open → sell (via /pos/sales) → close with denomination
// count → variance JE to Cash Over/Short.
//
// A shift is the cash-control wrapper around a cashier's retail session. Every
// POS invoice + payment posted during the shift points at it via posShiftId,
// so the Z-report can show "opening float + cash in − cash out = expected"
// against the physical count.

import type { FastifyPluginAsync } from "fastify";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { schema, withTenant } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { postJournal } from "../accounting/journal-posting.js";
import { emitNotification } from "../notifications/emit.js";

const OpenShiftSchema = z.object({
  branchId: z.string().uuid().optional(),
  openingFloatCents: z.number().int().min(0).default(0),
  openingNotes: z.string().max(500).optional().or(z.literal("")),
  // Defaults to the tenant's till/petty-cash account (resolved server-side
  // if omitted). The UI only needs to show a picker for the rare case of
  // multi-till branches.
  cashAccountId: z.string().uuid().optional(),
});

const DenominationsSchema = z.record(z.string(), z.number().int().min(0));

const VARIANCE_REASON_CODES = [
  "change_error",
  "miscount",
  "theft_suspicion",
  "other",
] as const;

const CloseShiftSchema = z.object({
  closingCashCents: z.number().int().min(0),
  closingDenominations: DenominationsSchema.optional(),
  varianceReasonCode: z.enum(VARIANCE_REASON_CODES).optional(),
  varianceReasonNotes: z.string().max(1000).optional().or(z.literal("")),
  supervisorSignature: z.string().max(120).optional().or(z.literal("")),
});

/**
 * Pick the default cash account for a shift when the cashier didn't choose
 * one. Preference order:
 *   1. account_subtype='cash' (till / petty cash) — what most tenants want
 *   2. account_subtype='bank' as a fallback so the shift can still open
 */
async function pickDefaultCashAccount(
  tx: Parameters<typeof postJournal>[0],
  tenantId: string,
) {
  const rows = await tx
    .select()
    .from(schema.chartOfAccounts)
    .where(
      and(
        eq(schema.chartOfAccounts.tenantId, tenantId),
        eq(schema.chartOfAccounts.accountType, "asset"),
        inArray(schema.chartOfAccounts.accountSubtype, ["cash", "bank"]),
        isNull(schema.chartOfAccounts.deletedAt),
      ),
    );
  return (
    rows.find((r) => r.accountSubtype === "cash") ?? rows[0] ?? null
  );
}

async function resolveCashOverShortAccount(
  tx: Parameters<typeof postJournal>[0],
  tenantId: string,
) {
  const rows = await tx
    .select()
    .from(schema.chartOfAccounts)
    .where(
      and(
        eq(schema.chartOfAccounts.tenantId, tenantId),
        eq(schema.chartOfAccounts.code, "5190"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Compute expected cash: opening float + all cash/cash-like payments
 * recorded on this shift. Non-cash tender (card, QR, bank transfer,
 * cheque) shouldn't sit in the till, so it's excluded from the expected.
 */
const EXPECTED_CASH_METHODS = ["cash"] as const;

export const posShiftsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /pos/shifts/current — the currently-open shift for the signed-in cashier
  fastify.get("/current", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const shift = await withTenant(ctx.tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.posShifts)
        .where(
          and(
            eq(schema.posShifts.tenantId, ctx.tenantId),
            eq(schema.posShifts.cashierUserId, ctx.userId),
            eq(schema.posShifts.status, "open"),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    });

    return reply.send({ shift });
  });

  // GET /pos/shifts — recent shifts for the tenant (all cashiers)
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.posShifts)
        .where(eq(schema.posShifts.tenantId, ctx.tenantId))
        .orderBy(desc(schema.posShifts.openedAt))
        .limit(50),
    );
    return reply.send({ shifts: rows });
  });

  // POST /pos/shifts — open a new shift
  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = OpenShiftSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      // Enforce "one open shift per cashier per branch" at the app layer too —
      // the partial unique index will also catch it, but a friendly 409 is nicer.
      const existing = await tx
        .select({ id: schema.posShifts.id })
        .from(schema.posShifts)
        .where(
          and(
            eq(schema.posShifts.tenantId, ctx.tenantId),
            eq(schema.posShifts.cashierUserId, ctx.userId),
            eq(schema.posShifts.status, "open"),
          ),
        )
        .limit(1);
      if (existing[0]) {
        return { error: "SHIFT_ALREADY_OPEN" as const, shiftId: existing[0].id };
      }

      let cashAccountId = input.cashAccountId ?? null;
      if (!cashAccountId) {
        const acc = await pickDefaultCashAccount(tx, ctx.tenantId);
        if (!acc) return { error: "NO_CASH_ACCOUNT" as const };
        cashAccountId = acc.id;
      }

      const [shift] = await tx
        .insert(schema.posShifts)
        .values({
          tenantId: ctx.tenantId,
          branchId: input.branchId ?? null,
          cashierUserId: ctx.userId,
          status: "open",
          openingFloatCents: input.openingFloatCents,
          openingNotes: input.openingNotes || null,
          cashAccountId,
        })
        .returning();
      if (!shift) throw new Error("Shift insert failed");
      return { ok: true as const, shift };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        SHIFT_ALREADY_OPEN: 409,
        NO_CASH_ACCOUNT: 500,
      };
      const messages: Record<string, string> = {
        SHIFT_ALREADY_OPEN:
          "You already have an open shift. Close it before opening a new one.",
        NO_CASH_ACCOUNT:
          "No cash or bank account found on the chart of accounts. Seed one before opening a POS shift.",
      };
      const code = String(result.error);
      return reply.status(map[code] ?? 500).send({
        error: {
          code,
          message: messages[code],
          ...(result.error === "SHIFT_ALREADY_OPEN" && "shiftId" in result
            ? { shiftId: result.shiftId }
            : {}),
        },
      });
    }
    return reply.status(201).send({ shift: result.shift });
  });

  // POST /pos/shifts/:id/close — close a shift with denomination count
  fastify.post<{ Params: { id: string } }>("/:id/close", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CloseShiftSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [shift] = await tx
        .select()
        .from(schema.posShifts)
        .where(
          and(
            eq(schema.posShifts.tenantId, ctx.tenantId),
            eq(schema.posShifts.id, req.params.id),
          ),
        )
        .limit(1);
      if (!shift) return { error: "NOT_FOUND" as const };
      if (shift.status !== "open") return { error: "NOT_OPEN" as const };

      // Aggregate cash tender on this shift. Only 'cash' method bumps the till;
      // card/QR/bank tender lands in the respective asset account instead.
      const cashRows = (await tx.execute(sql`
        SELECT COALESCE(SUM(amount_cents), 0)::bigint AS "cashInCents"
        FROM customer_payments
        WHERE tenant_id = current_tenant_id()
          AND pos_shift_id = ${shift.id}
          AND method IN (${sql.raw(EXPECTED_CASH_METHODS.map((m) => `'${m}'`).join(","))})
          AND deleted_at IS NULL
      `)) as unknown as Array<{ cashInCents: number | string }>;
      const cashInCents = Number(cashRows[0]?.cashInCents ?? 0);
      const expectedCashCents = shift.openingFloatCents + cashInCents;
      const varianceCents = input.closingCashCents - expectedCashCents;

      // Require a reason when there's non-trivial variance. 100 cents = LKR 1.00 —
      // round-to-rupee cash countries, so any sub-rupee variance is noise.
      const VARIANCE_THRESHOLD_CENTS = 100;
      if (
        Math.abs(varianceCents) >= VARIANCE_THRESHOLD_CENTS &&
        !input.varianceReasonCode
      ) {
        return {
          error: "VARIANCE_REASON_REQUIRED" as const,
          expectedCashCents,
          varianceCents,
        };
      }

      // Variance JE to 5190 Cash Over/Short.
      //   short (variance < 0): DR 5190 · CR cash account
      //   over  (variance > 0): DR cash account · CR 5190
      let varianceJournalEntryId: string | null = null;
      if (
        Math.abs(varianceCents) >= VARIANCE_THRESHOLD_CENTS &&
        shift.cashAccountId
      ) {
        const overShort = await resolveCashOverShortAccount(tx, ctx.tenantId);
        if (!overShort) return { error: "NO_OVER_SHORT_ACCOUNT" as const };

        const amount = Math.abs(varianceCents);
        const lines: Parameters<typeof postJournal>[1]["lines"] =
          varianceCents < 0
            ? [
                {
                  accountId: overShort.id,
                  drCents: amount,
                  description: `Cash short · shift ${shift.id.slice(0, 8)}`,
                },
                {
                  accountId: shift.cashAccountId,
                  crCents: amount,
                  description: `Till shortage`,
                },
              ]
            : [
                {
                  accountId: shift.cashAccountId,
                  drCents: amount,
                  description: `Till surplus`,
                },
                {
                  accountId: overShort.id,
                  crCents: amount,
                  description: `Cash over · shift ${shift.id.slice(0, 8)}`,
                },
              ];

        const { entryId } = await postJournal(tx, {
          tenantId: ctx.tenantId,
          entryDate: new Date().toISOString().slice(0, 10),
          memo: `POS shift ${shift.id.slice(0, 8)} ${
            varianceCents < 0 ? "shortage" : "overage"
          } · ${input.varianceReasonCode ?? "unspecified"}`,
          sourceType: "pos_shift",
          sourceId: shift.id,
          postedByUserId: ctx.userId,
          lines,
        });
        varianceJournalEntryId = entryId;
      }

      const [updated] = await tx
        .update(schema.posShifts)
        .set({
          status: "closed",
          closedAt: new Date(),
          closedByUserId: ctx.userId,
          closingCashCents: input.closingCashCents,
          closingDenominations: input.closingDenominations ?? null,
          expectedCashCents,
          varianceCents,
          varianceReasonCode: input.varianceReasonCode ?? null,
          varianceReasonNotes: input.varianceReasonNotes || null,
          varianceJournalEntryId,
          supervisorSignature: input.supervisorSignature || null,
          updatedAt: new Date(),
        })
        .where(eq(schema.posShifts.id, shift.id))
        .returning();
      if (!updated) throw new Error("Shift update failed");

      // Tell the tenant a shift closed — small fan-out, fine inline.
      if (Math.abs(varianceCents) >= VARIANCE_THRESHOLD_CENTS) {
        const tenantUsers = await tx.execute(sql`
          SELECT id FROM users WHERE tenant_id = current_tenant_id()
        `);
        const fmt = (cents: number) =>
          (cents / 100).toLocaleString("en-LK", {
            style: "currency",
            currency: "LKR",
            maximumFractionDigits: 2,
          });
        const label = varianceCents < 0 ? "short" : "over";
        for (const u of tenantUsers as unknown as Array<{ id: string }>) {
          await emitNotification(tx, {
            tenantId: ctx.tenantId,
            userId: u.id,
            kind: "pos_shift_variance",
            title: `POS shift closed · ${label} ${fmt(Math.abs(varianceCents))}`,
            body: `Expected ${fmt(expectedCashCents)}, counted ${fmt(input.closingCashCents)}${
              input.varianceReasonCode ? ` · ${input.varianceReasonCode}` : ""
            }`,
            refType: "pos_shift",
            refId: shift.id,
          });
        }
      }

      return {
        ok: true as const,
        shift: updated,
        expectedCashCents,
        varianceCents,
      };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        NOT_FOUND: 404,
        NOT_OPEN: 409,
        VARIANCE_REASON_REQUIRED: 400,
        NO_OVER_SHORT_ACCOUNT: 500,
      };
      const body: Record<string, unknown> = {
        code: result.error,
      };
      if (result.error === "VARIANCE_REASON_REQUIRED" && "varianceCents" in result) {
        body.message = `Variance of ${result.varianceCents} cents needs a reason code before closing.`;
        body.expectedCashCents = result.expectedCashCents;
        body.varianceCents = result.varianceCents;
      } else if (result.error === "NOT_OPEN") {
        body.message = "This shift is already closed.";
      } else if (result.error === "NO_OVER_SHORT_ACCOUNT") {
        body.message =
          "Missing the 5190 Cash Over/Short account. Re-run the POS migration or seed it manually.";
      }
      const code = String(result.error);
      return reply.status(map[code] ?? 500).send({ error: body });
    }
    return reply.send(result);
  });

  // GET /pos/shifts/:id/z-report — aggregated totals for end-of-day print-out
  fastify.get<{ Params: { id: string } }>("/:id/z-report", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const report = await withTenant(ctx.tenantId, async (tx) => {
      const [shift] = await tx
        .select()
        .from(schema.posShifts)
        .where(
          and(
            eq(schema.posShifts.tenantId, ctx.tenantId),
            eq(schema.posShifts.id, req.params.id),
          ),
        )
        .limit(1);
      if (!shift) return null;

      // Tender breakdown
      const tenderRows = (await tx.execute(sql`
        SELECT method, COUNT(*)::int AS count, COALESCE(SUM(amount_cents), 0)::bigint AS total_cents
        FROM customer_payments
        WHERE tenant_id = current_tenant_id()
          AND pos_shift_id = ${shift.id}
          AND deleted_at IS NULL
        GROUP BY method
        ORDER BY method
      `)) as unknown as Array<{ method: string; count: number; total_cents: string | number }>;

      // Invoice totals (posted invoices for this shift — we filter via channel='pos'
      // + shift-period for v1 since we don't yet link invoice→shift directly)
      const invoiceRows = (await tx.execute(sql`
        SELECT
          COUNT(DISTINCT i.id)::int AS invoice_count,
          COALESCE(SUM(i.subtotal_cents), 0)::bigint AS subtotal_cents,
          COALESCE(SUM(i.discount_cents), 0)::bigint AS discount_cents,
          COALESCE(SUM(i.tax_cents), 0)::bigint AS tax_cents,
          COALESCE(SUM(i.total_cents), 0)::bigint AS total_cents
        FROM invoices i
        JOIN payment_allocations pa ON pa.invoice_id = i.id
        JOIN customer_payments cp ON cp.id = pa.payment_id
        WHERE i.tenant_id = current_tenant_id()
          AND cp.pos_shift_id = ${shift.id}
          AND i.deleted_at IS NULL
      `)) as unknown as Array<{
        invoice_count: number;
        subtotal_cents: string | number;
        discount_cents: string | number;
        tax_cents: string | number;
        total_cents: string | number;
      }>;

      const cashier = await tx.execute(sql`
        SELECT id, full_name, email FROM users WHERE id = ${shift.cashierUserId}::uuid
      `);

      return {
        shift,
        cashier: (cashier as unknown as Array<{ id: string; full_name: string; email: string }>)[0] ?? null,
        tender: tenderRows.map((r) => ({
          method: r.method,
          count: r.count,
          totalCents: Number(r.total_cents),
        })),
        invoices: invoiceRows[0]
          ? {
              count: invoiceRows[0].invoice_count,
              subtotalCents: Number(invoiceRows[0].subtotal_cents),
              discountCents: Number(invoiceRows[0].discount_cents),
              taxCents: Number(invoiceRows[0].tax_cents),
              totalCents: Number(invoiceRows[0].total_cents),
            }
          : { count: 0, subtotalCents: 0, discountCents: 0, taxCents: 0, totalCents: 0 },
      };
    });

    if (!report) {
      return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    }
    return reply.send(report);
  });

  // Keep these imports referenced so tree-shake doesn't drop them.
  void asc;
  void isNull;
};
