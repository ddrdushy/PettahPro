import { schema } from "@pettahpro/db";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

/**
 * Creates a cheque record linked to a customer or supplier payment.
 * Called right after posting a payment with method='cheque'. The caller
 * has already written the journal entry to Bank-in-Clearing (received)
 * or Bank-in-Transit (issued) — we just record the cheque metadata.
 */
export async function createChequeFromPayment(
  tx: PostgresJsDatabase<typeof schema>,
  input: {
    tenantId: string;
    direction: "received" | "issued";
    chequeNumber: string;
    chequeDate: string; // YYYY-MM-DD
    amountCents: number;
    currency?: string;
    customerId?: string | null;
    supplierId?: string | null;
    payeeName?: string | null;
    bankAccountId: string; // the tenant's bank account that will eventually settle the cheque
    draweeBankName?: string | null;
    draweeBranchName?: string | null;
    sourcePaymentId?: string; // supplier_payment.id if direction='issued'
    sourceReceiptId?: string; // customer_payment.id if direction='received'
    journalEntryId: string;
    createdByUserId?: string;
    memo?: string | null;
  },
): Promise<{ id: string }> {
  const initialStatus = input.direction === "received" ? "deposited" : "issued";
  const now = new Date();

  // SL convention: cheques go stale 6 months after cheque date
  const staleDate = new Date(input.chequeDate + "T00:00:00Z");
  staleDate.setMonth(staleDate.getMonth() + 6);
  const staleAt = staleDate.toISOString().slice(0, 10);

  const [row] = await tx
    .insert(schema.cheques)
    .values({
      tenantId: input.tenantId,
      direction: input.direction,
      status: initialStatus,
      chequeNumber: input.chequeNumber,
      chequeDate: input.chequeDate,
      amountCents: input.amountCents,
      currency: input.currency ?? "LKR",
      customerId: input.customerId ?? null,
      supplierId: input.supplierId ?? null,
      payeeName: input.payeeName ?? null,
      bankAccountId: input.bankAccountId,
      draweeBankName: input.draweeBankName ?? null,
      draweeBranchName: input.draweeBranchName ?? null,
      sourcePaymentId: input.sourcePaymentId ?? null,
      sourceReceiptId: input.sourceReceiptId ?? null,
      issuedAt: input.direction === "issued" ? now : null,
      handedOverAt: input.direction === "issued" ? now : null,
      depositedAt: input.direction === "received" ? now : null,
      staleAt,
      journalEntryIdCreate: input.journalEntryId,
      createdByUserId: input.createdByUserId ?? null,
      memo: input.memo ?? null,
    })
    .returning({ id: schema.cheques.id });
  if (!row) throw new Error("Cheque insert failed");
  return row;
}
