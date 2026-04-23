import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, inArray, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema, nextDocumentNumber } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";
import { postJournal } from "../accounting/journal-posting.js";
import { emitNotification } from "../notifications/emit.js";
import { resolveChequeGLAccounts } from "../cheques/accounts.js";
import { createChequeFromPayment } from "../cheques/create.js";
import { accrueOnPayment } from "../commissions/engine.js";

const METHOD_VALUES = [
  "cash",
  "bank_transfer",
  "cheque",
  "card",
  "lankaqr",
  "payhere",
  "frimi",
  "genie",
  "ipay",
  "other",
] as const;

const AllocationSchema = z.object({
  invoiceId: z.string().uuid(),
  allocatedCents: z.number().int().positive(),
});

const CreateSchema = z.object({
  customerId: z.string().uuid(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  method: z.enum(METHOD_VALUES),
  bankAccountId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  reference: z.string().max(64).optional().or(z.literal("")),
  chequeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  memo: z.string().optional().or(z.literal("")),
  allocations: z.array(AllocationSchema).min(1),
});

export const paymentsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /payments — list with customer name and allocation total
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select({
          id: schema.customerPayments.id,
          paymentNumber: schema.customerPayments.paymentNumber,
          paymentDate: schema.customerPayments.paymentDate,
          method: schema.customerPayments.method,
          amountCents: schema.customerPayments.amountCents,
          currency: schema.customerPayments.currency,
          reference: schema.customerPayments.reference,
          status: schema.customerPayments.status,
          customerId: schema.customerPayments.customerId,
          customerName: schema.customers.name,
          bankAccountCode: schema.chartOfAccounts.code,
          bankAccountName: schema.chartOfAccounts.name,
          createdAt: schema.customerPayments.createdAt,
        })
        .from(schema.customerPayments)
        .innerJoin(
          schema.customers,
          eq(schema.customers.id, schema.customerPayments.customerId),
        )
        .innerJoin(
          schema.chartOfAccounts,
          eq(schema.chartOfAccounts.id, schema.customerPayments.bankAccountId),
        )
        .where(
          and(
            eq(schema.customerPayments.tenantId, ctx.tenantId),
            isNull(schema.customerPayments.deletedAt),
          ),
        )
        .orderBy(desc(schema.customerPayments.createdAt))
        .limit(200),
    );

    return reply.send({ payments: rows });
  });

  // POST /payments — create + post in one shot
  fastify.post("/", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "payments.manage");
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;

    const allocTotal = input.allocations.reduce((s, a) => s + a.allocatedCents, 0);
    if (allocTotal !== input.amountCents) {
      return reply.status(400).send({
        error: {
          code: "ALLOCATION_MISMATCH",
          message: `Allocated ${allocTotal} cents but received ${input.amountCents}.`,
        },
      });
    }

    const result = await withTenant(ctx.tenantId, async (tx) => {
      // Verify customer
      const custRows = await tx
        .select()
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.tenantId, ctx.tenantId),
            eq(schema.customers.id, input.customerId),
            isNull(schema.customers.deletedAt),
          ),
        )
        .limit(1);
      const customer = custRows[0];
      if (!customer) return { error: "CUSTOMER_NOT_FOUND" as const };

      // Verify bank/cash account
      const bankRows = await tx
        .select()
        .from(schema.chartOfAccounts)
        .where(
          and(
            eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
            eq(schema.chartOfAccounts.id, input.bankAccountId),
            isNull(schema.chartOfAccounts.deletedAt),
          ),
        )
        .limit(1);
      const bank = bankRows[0];
      if (!bank) return { error: "BANK_NOT_FOUND" as const };
      if (bank.accountType !== "asset" || !["cash", "bank"].includes(bank.accountSubtype ?? "")) {
        return { error: "INVALID_BANK_ACCOUNT" as const };
      }

      // Verify all invoices exist, belong to same customer, are posted/partial, and
      // each allocation ≤ balance_due
      const invIds = input.allocations.map((a) => a.invoiceId);
      const invRows = await tx
        .select()
        .from(schema.invoices)
        .where(
          and(
            eq(schema.invoices.tenantId, ctx.tenantId),
            inArray(schema.invoices.id, invIds),
            isNull(schema.invoices.deletedAt),
          ),
        );
      if (invRows.length !== invIds.length) return { error: "INVOICE_NOT_FOUND" as const };
      const invById = new Map(invRows.map((i) => [i.id, i]));
      for (const a of input.allocations) {
        const inv = invById.get(a.invoiceId);
        if (!inv) return { error: "INVOICE_NOT_FOUND" as const };
        if (inv.customerId !== customer.id) return { error: "INVOICE_WRONG_CUSTOMER" as const };
        if (!["posted", "partially_paid"].includes(inv.status)) {
          return { error: "INVOICE_NOT_POSTABLE" as const };
        }
        if (a.allocatedCents > inv.balanceDueCents) {
          return { error: "ALLOCATION_EXCEEDS_BALANCE" as const };
        }
      }

      // AR account
      const arRows = await tx
        .select()
        .from(schema.chartOfAccounts)
        .where(
          and(
            eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
            eq(schema.chartOfAccounts.accountSubtype, "ar"),
            isNull(schema.chartOfAccounts.deletedAt),
          ),
        )
        .limit(1);
      const ar = arRows[0];
      if (!ar) return { error: "NO_AR_ACCOUNT" as const };

      // For cheques, the immediate debit is Bank-in-Clearing, not the final
      // bank account — money doesn't move until the cheque clears.
      let debitAccountId = bank.id;
      let { bankClearingAccountId } = { bankClearingAccountId: null as string | null };
      if (input.method === "cheque") {
        const resolved = await resolveChequeGLAccounts(tx, ctx.tenantId);
        bankClearingAccountId = resolved.bankClearingAccountId;
        if (!bankClearingAccountId) return { error: "NO_BANK_CLEARING_ACCOUNT" as const };
        if (!input.reference) return { error: "CHEQUE_NUMBER_REQUIRED" as const };
        debitAccountId = bankClearingAccountId;
      }

      // Allocate payment number
      const paymentNumber = await nextDocumentNumber(tx, "payment");

      // Post journal: DR Bank (or Clearing for cheque), CR AR
      const { entryId, entryNumber } = await postJournal(tx, {
        tenantId: ctx.tenantId,
        entryDate: input.paymentDate ?? new Date().toISOString().slice(0, 10),
        memo:
          input.method === "cheque"
            ? `Payment ${paymentNumber} from ${customer.name} (cheque ${input.reference})`
            : `Payment ${paymentNumber} from ${customer.name}`,
        sourceType: "customer_payment",
        postedByUserId: ctx.userId,
        lines: [
          {
            accountId: debitAccountId,
            drCents: input.amountCents,
            description:
              input.method === "cheque"
                ? `Cheque in clearing · ${paymentNumber}`
                : `Payment received · ${paymentNumber}`,
            customerId: customer.id,
          },
          {
            accountId: ar.id,
            crCents: input.amountCents,
            description: `AR cleared · ${paymentNumber}`,
            customerId: customer.id,
          },
        ],
      });

      // Insert payment header
      const [payment] = await tx
        .insert(schema.customerPayments)
        .values({
          tenantId: ctx.tenantId,
          paymentNumber,
          customerId: customer.id,
          paymentDate: input.paymentDate ?? new Date().toISOString().slice(0, 10),
          method: input.method,
          amountCents: input.amountCents,
          currency: customer.currency ?? "LKR",
          bankAccountId: bank.id,
          reference: input.reference || null,
          chequeDate: input.chequeDate ?? null,
          memo: input.memo || null,
          status: "posted",
          journalEntryId: entryId,
          postedAt: new Date(),
          postedByUserId: ctx.userId,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!payment) throw new Error("Payment insert failed");

      // Set source_id on journal entry (couldn't know id until now)
      await tx.execute(sql`
        UPDATE journal_entries SET source_id = ${payment.id}::uuid WHERE id = ${entryId}::uuid
      `);

      // Insert allocations
      await tx.insert(schema.paymentAllocations).values(
        input.allocations.map((a) => ({
          tenantId: ctx.tenantId,
          paymentId: payment.id,
          invoiceId: a.invoiceId,
          allocatedCents: a.allocatedCents,
        })),
      );

      // Record the cheque artifact for lifecycle tracking
      if (input.method === "cheque") {
        await createChequeFromPayment(tx, {
          tenantId: ctx.tenantId,
          direction: "received",
          chequeNumber: input.reference!,
          chequeDate: input.chequeDate ?? input.paymentDate ?? new Date().toISOString().slice(0, 10),
          amountCents: input.amountCents,
          currency: customer.currency ?? "LKR",
          customerId: customer.id,
          bankAccountId: bank.id,
          sourceReceiptId: payment.id,
          journalEntryId: entryId,
          createdByUserId: ctx.userId,
          memo: input.memo ?? null,
        });
      }

      // Update each invoice's amount_paid + balance + status
      for (const a of input.allocations) {
        const inv = invById.get(a.invoiceId);
        if (!inv) continue;
        const newPaid = inv.amountPaidCents + a.allocatedCents;
        const newBalance = inv.balanceDueCents - a.allocatedCents;
        const newStatus =
          newBalance === 0 ? "paid" : newPaid > 0 ? "partially_paid" : inv.status;
        await tx
          .update(schema.invoices)
          .set({
            amountPaidCents: newPaid,
            balanceDueCents: newBalance,
            status: newStatus,
            updatedAt: new Date(),
          })
          .where(eq(schema.invoices.id, inv.id));
      }

      // Commission accrual on collection (#29) — fires on payment_received
      // rules, attributes to each allocated invoice's salesperson_user_id.
      await accrueOnPayment(tx, {
        tenantId: ctx.tenantId,
        paymentId: payment.id,
        paymentNumber,
        paymentDate: input.paymentDate ?? new Date().toISOString().slice(0, 10),
        customerId: customer.id,
        allocations: input.allocations.map((a) => ({
          invoiceId: a.invoiceId,
          allocatedCents: a.allocatedCents,
        })),
      });

      const tenantUsers = await tx.execute(sql`
        SELECT id FROM users WHERE tenant_id = current_tenant_id()
      `);
      const formattedAmount = (input.amountCents / 100).toLocaleString("en-LK", {
        style: "currency",
        currency: customer.currency || "LKR",
        maximumFractionDigits: 2,
      });
      for (const u of tenantUsers as unknown as Array<{ id: string }>) {
        await emitNotification(tx, {
          tenantId: ctx.tenantId,
          userId: u.id,
          kind: "payment_received",
          title: `Payment ${paymentNumber} received`,
          body: `${customer.name} · ${formattedAmount}${input.method === "cheque" ? ` (cheque)` : ""}`,
          refType: "customer_payment",
          refId: payment.id,
        });
      }

      return { ok: true as const, payment, paymentNumber, entryNumber };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        CUSTOMER_NOT_FOUND: 400,
        BANK_NOT_FOUND: 400,
        INVALID_BANK_ACCOUNT: 400,
        INVOICE_NOT_FOUND: 400,
        INVOICE_WRONG_CUSTOMER: 400,
        INVOICE_NOT_POSTABLE: 409,
        ALLOCATION_EXCEEDS_BALANCE: 400,
        NO_AR_ACCOUNT: 500,
        NO_BANK_CLEARING_ACCOUNT: 500,
        CHEQUE_NUMBER_REQUIRED: 400,
      };
      const messages: Record<string, string> = {
        CUSTOMER_NOT_FOUND: "Customer not found.",
        BANK_NOT_FOUND: "Bank account not found.",
        INVALID_BANK_ACCOUNT: "That account isn't a bank/cash account — pick a different one.",
        INVOICE_NOT_FOUND: "One of the allocated invoices wasn't found.",
        INVOICE_WRONG_CUSTOMER: "An allocated invoice belongs to a different customer.",
        INVOICE_NOT_POSTABLE: "One of the allocated invoices isn't open for payment (it's draft, void, or fully paid).",
        ALLOCATION_EXCEEDS_BALANCE: "Allocated amount exceeds the invoice's outstanding balance.",
        NO_AR_ACCOUNT: "No Accounts Receivable account configured.",
        NO_BANK_CLEARING_ACCOUNT: "No Bank-in-clearing account configured — needed for cheque payments.",
        CHEQUE_NUMBER_REQUIRED: "Cheque number is required. Enter it in the Reference field.",
      };
      const code = result.error as string;
      return reply
        .status(map[code] ?? 500)
        .send({ error: { code, message: messages[code] ?? code } });
    }
    return reply.status(201).send(result);
  });

  // GET /payments/:id — detail with allocations
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.customerPayments)
        .where(
          and(
            eq(schema.customerPayments.tenantId, ctx.tenantId),
            eq(schema.customerPayments.id, req.params.id),
            isNull(schema.customerPayments.deletedAt),
          ),
        )
        .limit(1);
      const payment = rows[0];
      if (!payment) return null;

      const allocs = await tx
        .select({
          id: schema.paymentAllocations.id,
          invoiceId: schema.paymentAllocations.invoiceId,
          allocatedCents: schema.paymentAllocations.allocatedCents,
          invoiceNumber: schema.invoices.invoiceNumber,
          totalCents: schema.invoices.totalCents,
          balanceDueCents: schema.invoices.balanceDueCents,
        })
        .from(schema.paymentAllocations)
        .innerJoin(schema.invoices, eq(schema.invoices.id, schema.paymentAllocations.invoiceId))
        .where(eq(schema.paymentAllocations.paymentId, payment.id))
        .orderBy(asc(schema.invoices.issueDate));

      return { payment, allocations: allocs };
    });
    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });
};
