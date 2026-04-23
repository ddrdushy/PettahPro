// Shared invoice post primitive.
//
// Extracted from the POST /:id/post route handler so POS sale composites
// can post a draft invoice without duplicating the 250-line sequence of
// credit checks → journal build → stock relief → JE post → notification.
//
// Same tagged-union contract as the route handler; each caller (legacy
// REST, POS composite) decides how to map error codes onto HTTP status.

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { nextDocumentNumber, schema } from "@pettahpro/db";

import { postJournal } from "../accounting/journal-posting.js";
import { emitNotification } from "../notifications/emit.js";
import { accrueOnInvoicePost } from "../commissions/engine.js";
import {
  applyStockIssue,
  peekStockIssue,
  resolveDefaultWarehouse,
  resolveStockGLAccounts,
} from "../inventory/stock-posting.js";
import { loadTenantSettings } from "../settings/routes.js";

type Tx = PostgresJsDatabase<typeof schema>;

export type InvoicePostError =
  | { error: "NOT_FOUND" }
  | { error: "NOT_DRAFT" }
  | { error: "NO_LINES" }
  | { error: "NO_AR_ACCOUNT" }
  | { error: "MISSING_INCOME_ACCOUNT" }
  | { error: "NO_DEFAULT_WAREHOUSE" }
  | { error: "NO_STOCK_ACCOUNTS" }
  | { error: "NEGATIVE_STOCK"; item: typeof schema.items.$inferSelect }
  | { error: "CREDIT_HOLD"; reason: string | null }
  | {
      error: "CREDIT_LIMIT_EXCEEDED";
      openCents: number;
      limitCents: number;
      newInvoiceCents: number;
    };

export type InvoicePostResult =
  | { ok: true; invoiceNumber: string; entryId: string; entryNumber: string }
  | InvoicePostError;

export interface PostDraftInvoiceInput {
  tenantId: string;
  invoiceId: string;
  userId: string;
}

/**
 * Post a draft invoice: credit checks, build balanced JE, relieve stock if
 * tracked and stockRelieveOn='invoice', flip invoice to posted, emit
 * invoice_posted notifications.
 *
 * MUST run inside a `withTenant(tenantId, async tx => ...)` transaction so
 * RLS scopes every query. Callers are responsible for the outer tx.
 */
export async function postDraftInvoice(
  tx: Tx,
  input: PostDraftInvoiceInput,
): Promise<InvoicePostResult> {
  const { tenantId, invoiceId, userId } = input;

  const invRows = await tx
    .select()
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.tenantId, tenantId),
        eq(schema.invoices.id, invoiceId),
        isNull(schema.invoices.deletedAt),
      ),
    )
    .limit(1);
  const invoice = invRows[0];
  if (!invoice) return { error: "NOT_FOUND" };
  if (invoice.status !== "draft") return { error: "NOT_DRAFT" };

  // Credit checks: hard block on credit_hold, soft block on exposure
  // exceeding credit_limit. Skipped when credit_limit is 0.
  const [creditInfo] = await tx
    .select({
      creditLimitCents: schema.customers.creditLimitCents,
      creditHold: schema.customers.creditHold,
      creditHoldReason: schema.customers.creditHoldReason,
    })
    .from(schema.customers)
    .where(eq(schema.customers.id, invoice.customerId))
    .limit(1);
  if (creditInfo?.creditHold) {
    return { error: "CREDIT_HOLD", reason: creditInfo.creditHoldReason ?? null };
  }
  if (creditInfo && creditInfo.creditLimitCents > 0) {
    const openArRows = (await tx.execute(sql`
      SELECT customer_open_ar_cents(${invoice.customerId}::uuid)::bigint AS open_cents
    `)) as unknown as Array<{ open_cents: number | string }>;
    const openCents = Number(openArRows[0]?.open_cents ?? 0);
    const newExposure = openCents + invoice.totalCents;
    if (newExposure > creditInfo.creditLimitCents) {
      return {
        error: "CREDIT_LIMIT_EXCEEDED",
        openCents,
        limitCents: creditInfo.creditLimitCents,
        newInvoiceCents: invoice.totalCents,
      };
    }
  }

  const lines = await tx
    .select()
    .from(schema.invoiceLines)
    .where(eq(schema.invoiceLines.invoiceId, invoice.id))
    .orderBy(asc(schema.invoiceLines.lineNo));
  if (lines.length === 0) return { error: "NO_LINES" };

  const invoiceNumber = await nextDocumentNumber(tx, "invoice");

  // AR leg
  const arRows = await tx
    .select()
    .from(schema.chartOfAccounts)
    .where(
      and(
        eq(schema.chartOfAccounts.tenantId, tenantId),
        eq(schema.chartOfAccounts.accountSubtype, "ar"),
        isNull(schema.chartOfAccounts.deletedAt),
      ),
    )
    .limit(1);
  const arAccount = arRows[0];
  if (!arAccount) return { error: "NO_AR_ACCOUNT" };

  const journalLines: Parameters<typeof postJournal>[1]["lines"] = [
    {
      accountId: arAccount.id,
      drCents: invoice.totalCents,
      description: `AR · ${invoiceNumber}`,
      customerId: invoice.customerId,
    },
  ];

  // Income lines, grouped by income account
  const incomeByAccount = new Map<string, number>();
  for (const l of lines) {
    if (!l.incomeAccountId) return { error: "MISSING_INCOME_ACCOUNT" };
    const net = l.lineSubtotalCents - l.discountCents;
    incomeByAccount.set(
      l.incomeAccountId,
      (incomeByAccount.get(l.incomeAccountId) ?? 0) + net,
    );
  }
  for (const [accountId, amount] of incomeByAccount) {
    if (amount <= 0) continue;
    journalLines.push({
      accountId,
      crCents: amount,
      description: `Sales · ${invoiceNumber}`,
      customerId: invoice.customerId,
    });
  }

  // Tax lines, grouped by payable account
  const taxByAccount = new Map<string, number>();
  const taxCodeIds = Array.from(
    new Set(lines.map((l) => l.taxCodeId).filter((v): v is string => !!v)),
  );
  if (taxCodeIds.length > 0) {
    const taxRows = await tx
      .select()
      .from(schema.taxCodes)
      .where(eq(schema.taxCodes.tenantId, tenantId));
    const payableByCode = new Map(taxRows.map((t) => [t.id, t.payableAccountId]));
    for (const l of lines) {
      if (l.taxCents === 0) continue;
      const payable = payableByCode.get(l.taxCodeId ?? "");
      if (!payable) continue;
      taxByAccount.set(payable, (taxByAccount.get(payable) ?? 0) + l.taxCents);
    }
  }
  for (const [accountId, amount] of taxByAccount) {
    if (amount <= 0) continue;
    journalLines.push({
      accountId,
      crCents: amount,
      description: `Tax payable · ${invoiceNumber}`,
    });
  }

  // Stock relief + COGS (WAVG, single default warehouse v1)
  const settings = await loadTenantSettings(tx);
  const trackedLines: Array<{
    line: (typeof lines)[number];
    item: typeof schema.items.$inferSelect;
    cogsCents: number;
  }> = [];
  let totalCogsCents = 0;

  const defaultWarehouse = await resolveDefaultWarehouse(tx, tenantId);
  const { inventoryAccountId, cogsAccountId } = await resolveStockGLAccounts(
    tx,
    tenantId,
  );

  if (settings.stockRelieveOn === "invoice") {
    const linkedItems = await tx
      .select()
      .from(schema.items)
      .where(
        and(eq(schema.items.tenantId, tenantId), isNull(schema.items.deletedAt)),
      );
    const itemById = new Map(linkedItems.map((i) => [i.id, i]));

    for (const l of lines) {
      if (!l.itemId) continue;
      const item = itemById.get(l.itemId);
      if (!item || !item.trackInventory) continue;
      if (!defaultWarehouse) return { error: "NO_DEFAULT_WAREHOUSE" };
      if (!inventoryAccountId || !cogsAccountId) return { error: "NO_STOCK_ACCOUNTS" };

      const qty = Number(l.quantity);
      if (qty <= 0) continue;

      try {
        const { cogsCents } = await peekStockIssue(tx, {
          tenantId,
          itemId: item.id,
          warehouseId: defaultWarehouse.id,
          quantity: qty,
        });
        trackedLines.push({ line: l, item, cogsCents });
        totalCogsCents += cogsCents;
      } catch (err) {
        const e = err as Error & { code?: string };
        if (e.code === "NEGATIVE_STOCK") return { error: "NEGATIVE_STOCK", item };
        throw err;
      }
    }
  }

  if (totalCogsCents > 0 && cogsAccountId && inventoryAccountId) {
    journalLines.push(
      {
        accountId: cogsAccountId,
        drCents: totalCogsCents,
        description: `COGS · ${invoiceNumber}`,
        customerId: invoice.customerId,
      },
      {
        accountId: inventoryAccountId,
        crCents: totalCogsCents,
        description: `Inventory relief · ${invoiceNumber}`,
        customerId: invoice.customerId,
      },
    );
  }

  const { entryId, entryNumber } = await postJournal(tx, {
    tenantId,
    entryDate: invoice.issueDate,
    memo: `Invoice ${invoiceNumber}`,
    sourceType: "invoice",
    sourceId: invoice.id,
    postedByUserId: userId,
    lines: journalLines,
  });

  // Commit stock movements now that entryId exists
  for (const t of trackedLines) {
    await applyStockIssue(tx, {
      tenantId,
      itemId: t.item.id,
      warehouseId: defaultWarehouse!.id,
      quantity: Number(t.line.quantity),
      sourceDocumentType: "invoice",
      sourceDocumentId: invoice.id,
      sourceLineId: t.line.id,
      journalEntryId: entryId,
      postedByUserId: userId,
      memo: `Invoice ${invoiceNumber}`,
    });
  }

  await tx
    .update(schema.invoices)
    .set({
      status: "posted",
      invoiceNumber,
      journalEntryId: entryId,
      postedAt: new Date(),
      postedByUserId: userId,
      updatedAt: new Date(),
    })
    .where(eq(schema.invoices.id, invoice.id));

  // Commission accrual (#29) — no-ops if invoice has no salesperson tag or
  // no active 'invoice_posted' rules match.
  const invoiceNetCents = lines.reduce(
    (s, l) => s + (l.lineSubtotalCents - l.discountCents),
    0,
  );
  await accrueOnInvoicePost(tx, {
    tenantId,
    invoiceId: invoice.id,
    invoiceNumber,
    issueDate: invoice.issueDate,
    customerId: invoice.customerId,
    salespersonUserId: invoice.salespersonUserId,
    lines: lines.map((l) => ({
      itemId: l.itemId,
      netCents: l.lineSubtotalCents - l.discountCents,
    })),
    invoiceNetCents,
  });

  // Notifications — fan-out to every tenant user.
  const [cust] = await tx
    .select({ name: schema.customers.name })
    .from(schema.customers)
    .where(eq(schema.customers.id, invoice.customerId))
    .limit(1);
  const tenantUsers = await tx.execute(sql`
    SELECT id FROM users WHERE tenant_id = current_tenant_id()
  `);
  const formattedTotal = (invoice.totalCents / 100).toLocaleString("en-LK", {
    style: "currency",
    currency: invoice.currency || "LKR",
    maximumFractionDigits: 2,
  });
  for (const u of tenantUsers as unknown as Array<{ id: string }>) {
    await emitNotification(tx, {
      tenantId,
      userId: u.id,
      kind: "invoice_posted",
      title: `Invoice ${invoiceNumber} posted`,
      body: `${cust?.name ?? "Customer"} · ${formattedTotal}`,
      refType: "invoice",
      refId: invoice.id,
    });
  }

  return { ok: true, invoiceNumber, entryId, entryNumber };
}

/** HTTP status mapping shared by REST + POS routes. */
export const INVOICE_POST_ERROR_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  NOT_DRAFT: 409,
  NO_LINES: 400,
  NO_AR_ACCOUNT: 500,
  MISSING_INCOME_ACCOUNT: 500,
  NO_DEFAULT_WAREHOUSE: 500,
  NO_STOCK_ACCOUNTS: 500,
  NEGATIVE_STOCK: 409,
  CREDIT_HOLD: 409,
  CREDIT_LIMIT_EXCEEDED: 409,
};

/** Build the error response body for an InvoicePostError. */
export function buildInvoicePostErrorBody(result: InvoicePostError): {
  code: string;
  message?: string;
  itemName?: string;
  reason?: string;
  openCents?: number;
  limitCents?: number;
  newInvoiceCents?: number;
} {
  const body: ReturnType<typeof buildInvoicePostErrorBody> = { code: result.error };
  if (result.error === "NEGATIVE_STOCK") {
    body.message = `Not enough stock on hand for ${result.item.name}. Receive stock via a bill before invoicing.`;
    body.itemName = result.item.name;
  } else if (result.error === "CREDIT_HOLD") {
    body.message = result.reason
      ? `Customer is on credit hold — ${result.reason}. Clear the hold before posting.`
      : "Customer is on credit hold. Clear the hold before posting.";
    body.reason = result.reason ?? undefined;
  } else if (result.error === "CREDIT_LIMIT_EXCEEDED") {
    const { openCents, limitCents, newInvoiceCents } = result;
    body.message = `Posting would push this customer past their credit limit. Open ${(openCents / 100).toFixed(2)} + this invoice ${(newInvoiceCents / 100).toFixed(2)} = ${((openCents + newInvoiceCents) / 100).toFixed(2)}, limit ${(limitCents / 100).toFixed(2)}. Collect from them or raise the limit first.`;
    body.openCents = openCents;
    body.limitCents = limitCents;
    body.newInvoiceCents = newInvoiceCents;
  }
  return body;
}
