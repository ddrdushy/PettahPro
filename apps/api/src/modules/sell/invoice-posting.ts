// Shared invoice post primitive.
//
// Extracted from the POST /:id/post route handler so POS sale composites
// can post a draft invoice without duplicating the 250-line sequence of
// credit checks → journal build → stock relief → JE post → notification.
//
// Same tagged-union contract as the route handler; each caller (legacy
// REST, POS composite) decides how to map error codes onto HTTP status.

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
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
  | { error: "BUNDLE_COMPONENT_MISSING"; bundleId: string }
  | { error: "CREDIT_HOLD"; reason: string | null }
  | {
      error: "CREDIT_LIMIT_EXCEEDED";
      openCents: number;
      limitCents: number;
      newInvoiceCents: number;
    }
  // Batch / serial tracking failures (roadmap #34). Surfaced at post
  // time because serial selection is captured on the line's
  // tracking_input JSONB at draft time.
  | {
      error: "SERIAL_COUNT_MISMATCH";
      item: typeof schema.items.$inferSelect;
      expected: number;
      actual: number;
    }
  | {
      error: "SERIAL_NOT_FOUND";
      item: typeof schema.items.$inferSelect;
      serial: string;
    }
  | {
      error: "SERIAL_NOT_AVAILABLE";
      item: typeof schema.items.$inferSelect;
      serial: string;
      status: string;
    }
  | {
      error: "SERIAL_DUPLICATE_IN_PAYLOAD";
      item: typeof schema.items.$inferSelect;
    }
  | {
      error: "BATCH_PICKS_SUM_MISMATCH";
      item: typeof schema.items.$inferSelect;
      expected: number;
      actual: number;
    }
  | {
      error: "BATCH_NOT_FOUND";
      item: typeof schema.items.$inferSelect;
      batchId: string;
    }
  | {
      error: "BATCH_INSUFFICIENT";
      item: typeof schema.items.$inferSelect;
      batchId: string;
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

  // Stock relief + COGS (WAVG, single default warehouse v1).
  //
  // Bundle explosion (roadmap #35): a line whose item is a bundle
  // doesn't issue stock for the bundle itself — the bundle is virtual
  // and has no balance. Instead, each component is issued for
  // (lineQty × componentQty) and its WAVG cost rolls into the
  // invoice's totalCogsCents. The invoice line stays as-is — we don't
  // disaggregate on the document, per spec §9. Each component
  // movement gets its own stock_ledger row + lines-up against the
  // same JE entryId, so the audit trail shows exactly which items
  // left which warehouse.
  const settings = await loadTenantSettings(tx);
  const trackedLines: Array<{
    line: (typeof lines)[number];
    item: typeof schema.items.$inferSelect;
    // Quantity to issue — for non-bundle lines this is the line qty,
    // for an exploded bundle line this is bundleLineQty × componentQty.
    issueQuantity: number;
    cogsCents: number;
    memoSuffix?: string;
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

    // Preload every bundle's component list in one query keyed by
    // bundle id. Avoids N+1 across lines that reference different
    // bundles (e.g. a POS ring-up with three different kits).
    const bundleLineItemIds = Array.from(
      new Set(
        lines
          .map((l) => l.itemId)
          .filter((id): id is string => !!id)
          .filter((id) => itemById.get(id)?.itemType === "bundle"),
      ),
    );
    const componentsByBundle = new Map<
      string,
      Array<{
        componentItemId: string;
        quantity: number;
      }>
    >();
    if (bundleLineItemIds.length > 0) {
      const bundleRows = await tx
        .select({
          bundleItemId: schema.itemBundleComponents.bundleItemId,
          componentItemId: schema.itemBundleComponents.componentItemId,
          quantity: schema.itemBundleComponents.quantity,
        })
        .from(schema.itemBundleComponents)
        .where(
          and(
            eq(schema.itemBundleComponents.tenantId, tenantId),
            inArray(schema.itemBundleComponents.bundleItemId, bundleLineItemIds),
          ),
        );
      for (const r of bundleRows) {
        const arr = componentsByBundle.get(r.bundleItemId) ?? [];
        arr.push({
          componentItemId: r.componentItemId,
          quantity: Number(r.quantity),
        });
        componentsByBundle.set(r.bundleItemId, arr);
      }
    }

    for (const l of lines) {
      if (!l.itemId) continue;
      const item = itemById.get(l.itemId);
      if (!item) continue;

      const qty = Number(l.quantity);
      if (qty <= 0) continue;

      // Non-bundle, non-tracked items: skip (services, virtual items)
      // using the same guard as before.
      if (item.itemType !== "bundle" && !item.trackInventory) continue;

      if (!defaultWarehouse) return { error: "NO_DEFAULT_WAREHOUSE" };
      if (!inventoryAccountId || !cogsAccountId)
        return { error: "NO_STOCK_ACCOUNTS" };

      if (item.itemType === "bundle") {
        // Empty-component bundle = revenue-only, zero COGS. Legal &
        // intentional (service-like placeholder; see spec §9). Silent
        // no-op at the stock level.
        const components = componentsByBundle.get(item.id) ?? [];
        for (const c of components) {
          const componentItem = itemById.get(c.componentItemId);
          if (!componentItem) {
            // Shouldn't happen given the FK + soft-delete filtering,
            // but defensive — better to abort posting than silently
            // relieve nothing.
            return { error: "BUNDLE_COMPONENT_MISSING", bundleId: item.id };
          }
          // Components can be non-stock (service rolled into a kit).
          // They contribute zero COGS but stay legal.
          if (!componentItem.trackInventory) continue;

          const issueQty = qty * c.quantity;
          try {
            const { cogsCents } = await peekStockIssue(tx, {
              tenantId,
              itemId: componentItem.id,
              warehouseId: defaultWarehouse.id,
              quantity: issueQty,
            });
            trackedLines.push({
              line: l,
              item: componentItem,
              issueQuantity: issueQty,
              cogsCents,
              memoSuffix: `bundle ${item.name} component ${componentItem.name}`,
            });
            totalCogsCents += cogsCents;
          } catch (err) {
            const e = err as Error & { code?: string };
            if (e.code === "NEGATIVE_STOCK") {
              // Surface the component item, not the bundle — user
              // needs to know which SKU to replenish.
              return { error: "NEGATIVE_STOCK", item: componentItem };
            }
            throw err;
          }
        }
        continue;
      }

      // Non-bundle tracked item — original path.
      try {
        const { cogsCents } = await peekStockIssue(tx, {
          tenantId,
          itemId: item.id,
          warehouseId: defaultWarehouse.id,
          quantity: qty,
        });
        trackedLines.push({
          line: l,
          item,
          issueQuantity: qty,
          cogsCents,
        });
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

  // Cost center dimension propagation (#129 / gaps B1). Stamp the
  // invoice's cost_center_id onto every journal line so the P&L
  // cost-center filter sees the dimension end-to-end. Single line
  // here keeps the change localised — no need to touch every
  // `journalLines.push({...})` spot above.
  if (invoice.costCenterId) {
    for (const line of journalLines) {
      line.costCenterId = invoice.costCenterId;
    }
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

  // Commit stock movements now that entryId exists. For exploded
  // bundle lines the `issueQuantity` is already scaled by the
  // component qty and the memo carries the bundle→component breadcrumb.
  for (const t of trackedLines) {
    try {
      await applyStockIssue(tx, {
        tenantId,
        itemId: t.item.id,
        warehouseId: defaultWarehouse!.id,
        quantity: t.issueQuantity,
        sourceDocumentType: "invoice",
        sourceDocumentId: invoice.id,
        sourceLineId: t.line.id,
        journalEntryId: entryId,
        postedByUserId: userId,
        customerId: invoice.customerId,
        memo: t.memoSuffix
          ? `Invoice ${invoiceNumber} — ${t.memoSuffix}`
          : `Invoice ${invoiceNumber}`,
        tracking: t.line.trackingInput ?? undefined,
      });
    } catch (err) {
      const e = err as Error & {
        code?: string;
        expected?: number;
        actual?: number;
        serial?: string;
        status?: string;
        batchId?: string;
      };
      // The tx is already rolling back — we just need to surface the
      // right tagged-union shape to the route handler.
      if (e.code === "SERIAL_COUNT_MISMATCH") {
        return {
          error: "SERIAL_COUNT_MISMATCH",
          item: t.item,
          expected: e.expected ?? 0,
          actual: e.actual ?? 0,
        };
      }
      if (e.code === "SERIAL_NOT_FOUND") {
        return { error: "SERIAL_NOT_FOUND", item: t.item, serial: e.serial ?? "" };
      }
      if (e.code === "SERIAL_NOT_AVAILABLE") {
        return {
          error: "SERIAL_NOT_AVAILABLE",
          item: t.item,
          serial: e.serial ?? "",
          status: e.status ?? "",
        };
      }
      if (e.code === "SERIAL_DUPLICATE_IN_PAYLOAD") {
        return { error: "SERIAL_DUPLICATE_IN_PAYLOAD", item: t.item };
      }
      if (e.code === "BATCH_PICKS_SUM_MISMATCH") {
        return {
          error: "BATCH_PICKS_SUM_MISMATCH",
          item: t.item,
          expected: e.expected ?? 0,
          actual: e.actual ?? 0,
        };
      }
      if (e.code === "BATCH_NOT_FOUND") {
        return { error: "BATCH_NOT_FOUND", item: t.item, batchId: e.batchId ?? "" };
      }
      if (e.code === "BATCH_INSUFFICIENT") {
        return {
          error: "BATCH_INSUFFICIENT",
          item: t.item,
          batchId: e.batchId ?? "",
        };
      }
      if (e.code === "NEGATIVE_STOCK") {
        return { error: "NEGATIVE_STOCK", item: t.item };
      }
      throw err;
    }
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
  BUNDLE_COMPONENT_MISSING: 500,
  CREDIT_HOLD: 409,
  CREDIT_LIMIT_EXCEEDED: 409,
  SERIAL_COUNT_MISMATCH: 400,
  SERIAL_NOT_FOUND: 400,
  SERIAL_NOT_AVAILABLE: 409,
  SERIAL_DUPLICATE_IN_PAYLOAD: 400,
  BATCH_PICKS_SUM_MISMATCH: 400,
  BATCH_NOT_FOUND: 404,
  BATCH_INSUFFICIENT: 409,
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
  serial?: string;
  batchId?: string;
} {
  const body: ReturnType<typeof buildInvoicePostErrorBody> = { code: result.error };
  if (result.error === "NEGATIVE_STOCK") {
    body.message = `Not enough stock on hand for ${result.item.name}. Receive stock via a bill before invoicing.`;
    body.itemName = result.item.name;
  } else if (result.error === "BUNDLE_COMPONENT_MISSING") {
    body.message =
      "A bundle on this invoice references a component that is missing or deleted. Edit the bundle's component list and try again.";
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
  } else if (result.error === "SERIAL_COUNT_MISMATCH") {
    body.message = `Serial tracking is on for ${result.item.name} — ${result.expected} serial number${result.expected === 1 ? "" : "s"} required, got ${result.actual}.`;
    body.itemName = result.item.name;
  } else if (result.error === "SERIAL_NOT_FOUND") {
    body.message = `Serial "${result.serial}" wasn't found for ${result.item.name}. It may never have been received, or may belong to a different warehouse.`;
    body.itemName = result.item.name;
    body.serial = result.serial;
  } else if (result.error === "SERIAL_NOT_AVAILABLE") {
    body.message = `Serial "${result.serial}" is ${result.status}, not available to sell. Pick a different unit.`;
    body.itemName = result.item.name;
    body.serial = result.serial;
  } else if (result.error === "SERIAL_DUPLICATE_IN_PAYLOAD") {
    body.message = `Duplicate serial number on the same ${result.item.name} line. Each serial must be unique.`;
    body.itemName = result.item.name;
  } else if (result.error === "BATCH_PICKS_SUM_MISMATCH") {
    body.message = `Selected batch quantities for ${result.item.name} sum to ${result.actual}, need ${result.expected}.`;
    body.itemName = result.item.name;
  } else if (result.error === "BATCH_NOT_FOUND") {
    body.message = `Picked batch for ${result.item.name} wasn't found (may have been deleted). Remove it and let FIFO pick.`;
    body.itemName = result.item.name;
    body.batchId = result.batchId;
  } else if (result.error === "BATCH_INSUFFICIENT") {
    body.message = `Picked batch for ${result.item.name} doesn't have enough quantity remaining. Use FIFO auto-pick or split across batches.`;
    body.itemName = result.item.name;
    body.batchId = result.batchId;
  }
  return body;
}
