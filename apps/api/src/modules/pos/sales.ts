// POS sale composite endpoint.
//
// One round-trip from the cashier's UI: create + post an invoice (channel=pos),
// record one or more customer_payments tagged with pos_shift_id, return the
// change due if cash tendered > balance.
//
// Why a composite: the retail cashier shouldn't wait on 3 separate API calls
// (draft → post → pay) when the whole transaction is atomic from their POV.
// If any leg fails, the tx rolls back — the cashier sees a single error.

import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { nextDocumentNumber, schema, withTenant } from "@pettahpro/db";
import { requirePermission } from "../../lib/permissions.js";
import { postJournal } from "../accounting/journal-posting.js";
import { emitNotification } from "../notifications/emit.js";
import { computeInvoice } from "../sell/invoices.js";
import {
  buildInvoicePostErrorBody,
  INVOICE_POST_ERROR_STATUS,
  postDraftInvoice,
} from "../sell/invoice-posting.js";

const POS_METHOD_VALUES = [
  "cash",
  "card",
  "lankaqr",
  "payhere",
  "frimi",
  "genie",
  "ipay",
  "bank_transfer",
  "other",
] as const;

const PosLineSchema = z.object({
  itemId: z.string().uuid().optional(),
  description: z.string().min(1).max(500),
  quantity: z.number().positive().max(1_000_000),
  unitPriceCents: z.number().int().min(0),
  discountPctBps: z.number().int().min(0).max(10000).default(0),
  taxCodeId: z.string().uuid().optional(),
});

const TenderSchema = z.object({
  method: z.enum(POS_METHOD_VALUES),
  // For cash tender this is the amount handed over (can exceed balance →
  // change due). For card/QR/etc. this is the exact approved amount.
  amountCents: z.number().int().positive(),
  bankAccountId: z.string().uuid().optional(),
  reference: z.string().max(64).optional().or(z.literal("")),
});

const CreatePosSaleSchema = z.object({
  shiftId: z.string().uuid(),
  // Optional: cashier can attach a known customer (loyalty, credit sale),
  // otherwise we fall back to the tenant's WALKIN customer.
  customerId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lines: z.array(PosLineSchema).min(1),
  tenders: z.array(TenderSchema).min(1),
});

export const posSalesRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /pos/sales — create + post invoice + record tenders in one tx.
  // Gated on `pos.operate` — a sales-only user can ring transactions but
  // closing the shift (with variance JE) needs `pos.close`.
  fastify.post("/", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "pos.operate");
    if (!ctx) return;

    const parsed = CreatePosSaleSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      // Verify shift is open and belongs to this cashier.
      const [shift] = await tx
        .select()
        .from(schema.posShifts)
        .where(
          and(
            eq(schema.posShifts.tenantId, ctx.tenantId),
            eq(schema.posShifts.id, input.shiftId),
          ),
        )
        .limit(1);
      if (!shift) return { error: "SHIFT_NOT_FOUND" as const };
      if (shift.status !== "open") return { error: "SHIFT_NOT_OPEN" as const };
      if (shift.cashierUserId !== ctx.userId) {
        return { error: "NOT_SHIFT_OWNER" as const };
      }

      // Resolve the customer. WALKIN is the per-tenant fallback seeded by
      // migration 58 — we look it up instead of hard-coding because tenant
      // provisioning assigns the uuid at seed time.
      let customerId = input.customerId ?? null;
      if (!customerId) {
        const [walkin] = await tx
          .select({ id: schema.customers.id })
          .from(schema.customers)
          .where(
            and(
              eq(schema.customers.tenantId, ctx.tenantId),
              eq(schema.customers.code, "WALKIN"),
            ),
          )
          .limit(1);
        if (!walkin) return { error: "NO_WALKIN_CUSTOMER" as const };
        customerId = walkin.id;
      } else {
        const [c] = await tx
          .select({ id: schema.customers.id })
          .from(schema.customers)
          .where(
            and(
              eq(schema.customers.tenantId, ctx.tenantId),
              eq(schema.customers.id, customerId),
              isNull(schema.customers.deletedAt),
            ),
          )
          .limit(1);
        if (!c) return { error: "CUSTOMER_NOT_FOUND" as const };
      }

      // Compute invoice totals from lines (same logic as REST invoice create).
      const { lines, subtotalCents, discountCents, taxCents, totalCents } =
        await computeInvoice(tx, ctx.tenantId, input.lines);

      const issueDate = input.issueDate ?? new Date().toISOString().slice(0, 10);

      // Insert the draft invoice (channel='pos', due today — POS sales are
      // always cash-at-till, no net-30 credit terms).
      const [invoice] = await tx
        .insert(schema.invoices)
        .values({
          tenantId: ctx.tenantId,
          customerId,
          branchId: input.branchId ?? shift.branchId ?? null,
          status: "draft",
          issueDate,
          dueDate: issueDate,
          currency: "LKR",
          fxRate: "1.0",
          subtotalCents,
          discountCents,
          taxCents,
          totalCents,
          balanceDueCents: totalCents,
          channel: "pos",
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!invoice) throw new Error("Invoice insert failed");

      await tx.insert(schema.invoiceLines).values(
        lines.map((l) => ({
          tenantId: ctx.tenantId,
          invoiceId: invoice.id,
          lineNo: l.lineNo,
          itemId: l.itemId,
          description: l.description,
          quantity: l.quantity.toString(),
          unitPriceCents: l.unitPriceCents,
          lineSubtotalCents: l.lineSubtotalCents,
          discountPctBps: l.discountPctBps,
          discountCents: l.discountCents,
          taxCodeId: l.taxCodeId,
          taxRateBps: l.taxRateBps,
          taxCents: l.taxCents,
          lineTotalCents: l.lineTotalCents,
          incomeAccountId: l.incomeAccountId,
        })),
      );

      // Post the invoice via the shared helper — this is where credit checks,
      // stock relief, journal posting, and notifications happen.
      const postResult = await postDraftInvoice(tx, {
        tenantId: ctx.tenantId,
        invoiceId: invoice.id,
        userId: ctx.userId,
      });
      if ("error" in postResult) return postResult;

      // Validate tenders. Cash can over-tender (change due). Everything else
      // must match to the cent.
      const cashTotal = input.tenders
        .filter((t) => t.method === "cash")
        .reduce((s, t) => s + t.amountCents, 0);
      const nonCashTotal = input.tenders
        .filter((t) => t.method !== "cash")
        .reduce((s, t) => s + t.amountCents, 0);
      const appliedCash = Math.min(cashTotal, Math.max(0, totalCents - nonCashTotal));
      const applied = appliedCash + nonCashTotal;
      if (applied < totalCents) {
        return {
          error: "UNDER_TENDERED" as const,
          totalCents,
          tenderedCents: cashTotal + nonCashTotal,
          shortfallCents: totalCents - (cashTotal + nonCashTotal),
        };
      }
      const changeCents = cashTotal - appliedCash;

      // Resolve AR account (for the tender JE's credit leg).
      const [arAccount] = await tx
        .select({ id: schema.chartOfAccounts.id })
        .from(schema.chartOfAccounts)
        .where(
          and(
            eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
            eq(schema.chartOfAccounts.accountSubtype, "ar"),
            isNull(schema.chartOfAccounts.deletedAt),
          ),
        )
        .limit(1);
      if (!arAccount) return { error: "NO_AR_ACCOUNT" as const };

      // One customer_payment per tender. For card/QR tenders the bankAccountId
      // lands on the merchant-settlement account (each tenant sets this up).
      // For cash, it's the shift's cashAccountId.
      //
      // v1 simplification: at most one cash tender per sale (the UI enforces
      // this). For cash we post `appliedCash` (tendered minus change).
      // For non-cash we post the full tender amount — these are exact-match
      // transactions (card approved amount, QR receipt).
      const paymentIds: string[] = [];
      for (const tender of input.tenders) {
        const applyNow =
          tender.method === "cash" ? appliedCash : tender.amountCents;
        if (applyNow === 0) continue;

        const bankAccountId =
          tender.method === "cash"
            ? shift.cashAccountId
            : tender.bankAccountId ?? null;
        if (!bankAccountId) {
          return {
            error: "MISSING_BANK_ACCOUNT" as const,
            method: tender.method,
          };
        }

        const paymentNumber = await nextDocumentNumber(tx, "payment");

        // Post the receipt journal: DR cash/bank account, CR AR.
        // Amount posted = applyNow (the applied portion of this tender).
        const { entryId } = await postJournal(tx, {
          tenantId: ctx.tenantId,
          entryDate: issueDate,
          memo: `POS receipt ${paymentNumber} · inv ${invoice.id.slice(0, 8)}`,
          sourceType: "customer_payment",
          postedByUserId: ctx.userId,
          lines: [
            {
              accountId: bankAccountId,
              drCents: applyNow,
              description: `POS ${tender.method} · ${paymentNumber}`,
              customerId,
            },
            {
              accountId: arAccount.id,
              crCents: applyNow,
              description: `AR cleared · ${paymentNumber}`,
              customerId,
            },
          ],
        });

        const [payment] = await tx
          .insert(schema.customerPayments)
          .values({
            tenantId: ctx.tenantId,
            paymentNumber,
            customerId,
            paymentDate: issueDate,
            method: tender.method,
            amountCents: applyNow,
            currency: "LKR",
            bankAccountId,
            reference: tender.reference || null,
            status: "posted",
            journalEntryId: entryId,
            postedAt: new Date(),
            postedByUserId: ctx.userId,
            createdByUserId: ctx.userId,
            posShiftId: shift.id,
          })
          .returning();
        if (!payment) throw new Error("Payment insert failed");
        paymentIds.push(payment.id);

        await tx.execute(sql`
          UPDATE journal_entries SET source_id = ${payment.id}::uuid WHERE id = ${entryId}::uuid
        `);

        await tx.insert(schema.paymentAllocations).values({
          tenantId: ctx.tenantId,
          paymentId: payment.id,
          invoiceId: invoice.id,
          allocatedCents: applyNow,
        });
      }

      // Update invoice paid totals. Sum across all tender allocations is
      // exactly totalCents (guaranteed by the under-tendered check above).
      await tx
        .update(schema.invoices)
        .set({
          amountPaidCents: totalCents,
          balanceDueCents: 0,
          status: "paid",
          updatedAt: new Date(),
        })
        .where(eq(schema.invoices.id, invoice.id));

      // v1 notification — POS sales are frequent, so only notify on larger
      // tickets to keep the bell from becoming noise.
      const NOTIFY_THRESHOLD_CENTS = 50_000_00; // LKR 50,000
      if (totalCents >= NOTIFY_THRESHOLD_CENTS) {
        const tenantUsers = await tx.execute(sql`
          SELECT id FROM users WHERE tenant_id = current_tenant_id()
        `);
        const fmt = (c: number) =>
          (c / 100).toLocaleString("en-LK", {
            style: "currency",
            currency: "LKR",
            maximumFractionDigits: 2,
          });
        for (const u of tenantUsers as unknown as Array<{ id: string }>) {
          await emitNotification(tx, {
            tenantId: ctx.tenantId,
            userId: u.id,
            kind: "pos_sale_posted",
            title: `POS sale · ${fmt(totalCents)}`,
            body: `${postResult.invoiceNumber} · shift ${shift.id.slice(0, 8)}`,
            refType: "invoice",
            refId: invoice.id,
          });
        }
      }

      return {
        ok: true as const,
        invoiceId: invoice.id,
        invoiceNumber: postResult.invoiceNumber,
        totalCents,
        tenderedCents: cashTotal + nonCashTotal,
        changeCents,
        paymentIds,
      };
    });

    if ("error" in result) {
      // Invoice-post errors flow through the shared status map.
      const errCode = String(result.error);
      if (errCode in INVOICE_POST_ERROR_STATUS) {
        const status = INVOICE_POST_ERROR_STATUS[errCode] ?? 500;
        return reply.status(status).send({
          error: buildInvoicePostErrorBody(
            result as Parameters<typeof buildInvoicePostErrorBody>[0],
          ),
        });
      }
      const map: Record<string, number> = {
        SHIFT_NOT_FOUND: 404,
        SHIFT_NOT_OPEN: 409,
        NOT_SHIFT_OWNER: 403,
        NO_WALKIN_CUSTOMER: 500,
        CUSTOMER_NOT_FOUND: 400,
        UNDER_TENDERED: 400,
        MISSING_BANK_ACCOUNT: 400,
        NO_AR_ACCOUNT: 500,
      };
      const messages: Record<string, string> = {
        SHIFT_NOT_FOUND: "Shift not found.",
        SHIFT_NOT_OPEN: "Shift is already closed — open a new one before selling.",
        NOT_SHIFT_OWNER: "This shift belongs to another cashier.",
        NO_WALKIN_CUSTOMER:
          "Walk-in customer not seeded for this tenant. Re-run the POS migration.",
        CUSTOMER_NOT_FOUND: "Customer not found.",
        UNDER_TENDERED: "Tender total is less than the invoice total.",
        MISSING_BANK_ACCOUNT:
          "Pick a deposit account for this non-cash tender (card settlement, QR settlement, etc.).",
        NO_AR_ACCOUNT: "Tenant has no AR account configured.",
      };
      const code = String(result.error);
      const body: Record<string, unknown> = {
        code,
        message: messages[code],
      };
      if (code === "UNDER_TENDERED" && "shortfallCents" in result) {
        body.totalCents = result.totalCents;
        body.tenderedCents = result.tenderedCents;
        body.shortfallCents = result.shortfallCents;
      }
      if (code === "MISSING_BANK_ACCOUNT" && "method" in result) {
        body.method = result.method;
      }
      return reply.status(map[code] ?? 500).send({ error: body });
    }

    return reply.status(201).send(result);
  });
};

