import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, inArray, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { postJournal } from "../accounting/journal-posting.js";
import { resolveChequeGLAccounts } from "../cheques/accounts.js";
import { createChequeFromPayment } from "../cheques/create.js";

const METHOD_VALUES = ["cash", "bank_transfer", "cheque", "slips", "other"] as const;

const AllocationSchema = z.object({
  billId: z.string().uuid(),
  allocatedCents: z.number().int().positive(),
});

const CreateSchema = z.object({
  supplierId: z.string().uuid(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  method: z.enum(METHOD_VALUES),
  bankAccountId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  reference: z.string().max(64).optional().or(z.literal("")),
  chequeNumber: z.string().max(32).optional().or(z.literal("")),
  chequeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  memo: z.string().optional().or(z.literal("")),
  allocations: z.array(AllocationSchema).min(1),
  // Withholding tax: when non-zero, the buyer withholds this portion of
  // amountCents (which still fully settles the bill) and books it to
  // WHT Payable for later remittance to IRD. The bank only sees the net.
  whtCents: z.number().int().min(0).default(0),
  whtTaxCodeId: z.string().uuid().optional(),
});

export const supplierPaymentsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select({
          id: schema.supplierPayments.id,
          paymentNumber: schema.supplierPayments.paymentNumber,
          paymentDate: schema.supplierPayments.paymentDate,
          method: schema.supplierPayments.method,
          amountCents: schema.supplierPayments.amountCents,
          currency: schema.supplierPayments.currency,
          reference: schema.supplierPayments.reference,
          chequeNumber: schema.supplierPayments.chequeNumber,
          status: schema.supplierPayments.status,
          supplierId: schema.supplierPayments.supplierId,
          supplierName: schema.suppliers.name,
          bankAccountCode: schema.chartOfAccounts.code,
          bankAccountName: schema.chartOfAccounts.name,
          createdAt: schema.supplierPayments.createdAt,
        })
        .from(schema.supplierPayments)
        .innerJoin(schema.suppliers, eq(schema.suppliers.id, schema.supplierPayments.supplierId))
        .innerJoin(
          schema.chartOfAccounts,
          eq(schema.chartOfAccounts.id, schema.supplierPayments.bankAccountId),
        )
        .where(
          and(
            eq(schema.supplierPayments.tenantId, ctx.tenantId),
            isNull(schema.supplierPayments.deletedAt),
          ),
        )
        .orderBy(desc(schema.supplierPayments.createdAt))
        .limit(200),
    );

    return reply.send({ payments: rows });
  });

  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
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
          message: `Allocated ${allocTotal} cents but sending ${input.amountCents}.`,
        },
      });
    }

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const supRows = await tx
        .select()
        .from(schema.suppliers)
        .where(
          and(
            eq(schema.suppliers.tenantId, ctx.tenantId),
            eq(schema.suppliers.id, input.supplierId),
            isNull(schema.suppliers.deletedAt),
          ),
        )
        .limit(1);
      const supplier = supRows[0];
      if (!supplier) return { error: "SUPPLIER_NOT_FOUND" as const };

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

      const billIds = input.allocations.map((a) => a.billId);
      const billRows = await tx
        .select()
        .from(schema.bills)
        .where(
          and(
            eq(schema.bills.tenantId, ctx.tenantId),
            inArray(schema.bills.id, billIds),
            isNull(schema.bills.deletedAt),
          ),
        );
      if (billRows.length !== billIds.length) return { error: "BILL_NOT_FOUND" as const };
      const billById = new Map(billRows.map((b) => [b.id, b]));
      for (const a of input.allocations) {
        const bill = billById.get(a.billId);
        if (!bill) return { error: "BILL_NOT_FOUND" as const };
        if (bill.supplierId !== supplier.id) return { error: "BILL_WRONG_SUPPLIER" as const };
        if (!["posted", "partially_paid"].includes(bill.status)) {
          return { error: "BILL_NOT_PAYABLE" as const };
        }
        if (a.allocatedCents > bill.balanceDueCents) {
          return { error: "ALLOCATION_EXCEEDS_BALANCE" as const };
        }
      }

      const apRows = await tx
        .select()
        .from(schema.chartOfAccounts)
        .where(
          and(
            eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
            eq(schema.chartOfAccounts.accountSubtype, "ap"),
            isNull(schema.chartOfAccounts.deletedAt),
          ),
        )
        .limit(1);
      const ap = apRows[0];
      if (!ap) return { error: "NO_AP_ACCOUNT" as const };

      // Cheques go to Bank-in-Transit first; money stays in Bank until cleared.
      let creditAccountId = bank.id;
      if (input.method === "cheque") {
        const { bankTransitAccountId } = await resolveChequeGLAccounts(tx, ctx.tenantId);
        if (!bankTransitAccountId) return { error: "NO_BANK_TRANSIT_ACCOUNT" as const };
        if (!input.chequeNumber) return { error: "CHEQUE_NUMBER_REQUIRED" as const };
        creditAccountId = bankTransitAccountId;
      }

      // Resolve WHT payable account if withholding is applied. The tax
      // code's payable_account_id wins; falls back to the tenant's 2110
      // "WHT payable" account (seeded per tenant).
      let whtAccountId: string | null = null;
      let whtTaxCodeId: string | null = null;
      if (input.whtCents > 0) {
        if (input.whtCents >= input.amountCents) {
          return { error: "WHT_EXCEEDS_PAYMENT" as const };
        }
        if (input.whtTaxCodeId) {
          const [tc] = await tx
            .select({ id: schema.taxCodes.id, payableAccountId: schema.taxCodes.payableAccountId })
            .from(schema.taxCodes)
            .where(
              and(
                eq(schema.taxCodes.tenantId, ctx.tenantId),
                eq(schema.taxCodes.id, input.whtTaxCodeId),
                isNull(schema.taxCodes.deletedAt),
              ),
            )
            .limit(1);
          if (!tc) return { error: "WHT_TAX_CODE_NOT_FOUND" as const };
          whtTaxCodeId = tc.id;
          whtAccountId = tc.payableAccountId;
        }
        if (!whtAccountId) {
          // Fall back to the seeded "WHT payable" account by code 2110.
          const [fallback] = await tx
            .select({ id: schema.chartOfAccounts.id })
            .from(schema.chartOfAccounts)
            .where(
              and(
                eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
                eq(schema.chartOfAccounts.code, "2110"),
                isNull(schema.chartOfAccounts.deletedAt),
              ),
            )
            .limit(1);
          if (!fallback) return { error: "NO_WHT_ACCOUNT" as const };
          whtAccountId = fallback.id;
        }
      }

      const [{ number: paymentNumber }] = (await tx.execute(
        sql`SELECT next_document_number('payment') AS number`,
      )) as unknown as Array<{ number: string }>;

      // Journal:
      //   DR AP                          (gross — fully settles the bill)
      //   CR Bank / Bank-in-Transit      (net = amount − wht)
      //   CR WHT Payable                 (wht portion; only if withholding)
      const netBankCents = input.amountCents - input.whtCents;
      const lines: Array<{
        accountId: string;
        drCents?: number;
        crCents?: number;
        description?: string;
        supplierId?: string | null;
      }> = [
        {
          accountId: ap.id,
          drCents: input.amountCents,
          description: `AP cleared · ${paymentNumber}`,
          supplierId: supplier.id,
        },
        {
          accountId: creditAccountId,
          crCents: netBankCents,
          description:
            input.method === "cheque"
              ? `Cheque in transit · ${paymentNumber}`
              : `Payment sent · ${paymentNumber}`,
          supplierId: supplier.id,
        },
      ];
      if (input.whtCents > 0 && whtAccountId) {
        lines.push({
          accountId: whtAccountId,
          crCents: input.whtCents,
          description: `WHT withheld · ${paymentNumber}`,
          supplierId: supplier.id,
        });
      }

      const { entryId, entryNumber } = await postJournal(tx, {
        tenantId: ctx.tenantId,
        entryDate: input.paymentDate ?? new Date().toISOString().slice(0, 10),
        memo:
          input.method === "cheque"
            ? `Payment ${paymentNumber} to ${supplier.name} (cheque ${input.chequeNumber})`
            : `Payment ${paymentNumber} to ${supplier.name}`,
        sourceType: "supplier_payment",
        postedByUserId: ctx.userId,
        lines,
      });

      const [payment] = await tx
        .insert(schema.supplierPayments)
        .values({
          tenantId: ctx.tenantId,
          paymentNumber,
          supplierId: supplier.id,
          paymentDate: input.paymentDate ?? new Date().toISOString().slice(0, 10),
          method: input.method,
          amountCents: input.amountCents,
          currency: supplier.currency ?? "LKR",
          bankAccountId: bank.id,
          reference: input.reference || null,
          chequeNumber: input.chequeNumber || null,
          chequeDate: input.chequeDate ?? null,
          whtCents: input.whtCents,
          whtTaxCodeId,
          whtAccountId,
          memo: input.memo || null,
          status: "posted",
          journalEntryId: entryId,
          postedAt: new Date(),
          postedByUserId: ctx.userId,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!payment) throw new Error("Payment insert failed");

      await tx.execute(sql`
        UPDATE journal_entries SET source_id = ${payment.id}::uuid WHERE id = ${entryId}::uuid
      `);

      await tx.insert(schema.billAllocations).values(
        input.allocations.map((a) => ({
          tenantId: ctx.tenantId,
          paymentId: payment.id,
          billId: a.billId,
          allocatedCents: a.allocatedCents,
        })),
      );

      if (input.method === "cheque") {
        await createChequeFromPayment(tx, {
          tenantId: ctx.tenantId,
          direction: "issued",
          chequeNumber: input.chequeNumber!,
          chequeDate: input.chequeDate ?? input.paymentDate ?? new Date().toISOString().slice(0, 10),
          amountCents: input.amountCents,
          currency: supplier.currency ?? "LKR",
          supplierId: supplier.id,
          payeeName: supplier.name,
          bankAccountId: bank.id,
          sourcePaymentId: payment.id,
          journalEntryId: entryId,
          createdByUserId: ctx.userId,
          memo: input.memo ?? null,
        });
      }

      for (const a of input.allocations) {
        const bill = billById.get(a.billId);
        if (!bill) continue;
        const newPaid = bill.amountPaidCents + a.allocatedCents;
        const newBalance = bill.balanceDueCents - a.allocatedCents;
        const newStatus =
          newBalance === 0 ? "paid" : newPaid > 0 ? "partially_paid" : bill.status;
        await tx
          .update(schema.bills)
          .set({
            amountPaidCents: newPaid,
            balanceDueCents: newBalance,
            status: newStatus,
            updatedAt: new Date(),
          })
          .where(eq(schema.bills.id, bill.id));
      }

      return { ok: true as const, payment, paymentNumber, entryNumber };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        SUPPLIER_NOT_FOUND: 400,
        BANK_NOT_FOUND: 400,
        INVALID_BANK_ACCOUNT: 400,
        BILL_NOT_FOUND: 400,
        BILL_WRONG_SUPPLIER: 400,
        BILL_NOT_PAYABLE: 409,
        ALLOCATION_EXCEEDS_BALANCE: 400,
        NO_AP_ACCOUNT: 500,
        NO_BANK_TRANSIT_ACCOUNT: 500,
        CHEQUE_NUMBER_REQUIRED: 400,
        WHT_EXCEEDS_PAYMENT: 400,
        WHT_TAX_CODE_NOT_FOUND: 400,
        NO_WHT_ACCOUNT: 500,
      };
      const messages: Record<string, string> = {
        SUPPLIER_NOT_FOUND: "Supplier not found.",
        BANK_NOT_FOUND: "Bank account not found.",
        INVALID_BANK_ACCOUNT: "That account isn't a bank/cash account — pick a different one.",
        BILL_NOT_FOUND: "One of the allocated bills wasn't found.",
        BILL_WRONG_SUPPLIER: "An allocated bill belongs to a different supplier.",
        BILL_NOT_PAYABLE: "One of the allocated bills isn't open for payment (it's draft, void, or fully paid).",
        ALLOCATION_EXCEEDS_BALANCE: "Allocated amount exceeds the bill's outstanding balance.",
        NO_AP_ACCOUNT: "No Accounts Payable account configured.",
        NO_BANK_TRANSIT_ACCOUNT: "No Bank-in-transit account configured — needed for cheque payments.",
        CHEQUE_NUMBER_REQUIRED: "Cheque number is required.",
        WHT_EXCEEDS_PAYMENT: "Withheld amount can't match or exceed the payment total.",
        WHT_TAX_CODE_NOT_FOUND: "Selected WHT tax code not found.",
        NO_WHT_ACCOUNT: "No WHT payable account configured.",
      };
      const code = result.error as string;
      return reply
        .status(map[code] ?? 500)
        .send({ error: { code, message: messages[code] ?? code } });
    }
    return reply.status(201).send(result);
  });
};
