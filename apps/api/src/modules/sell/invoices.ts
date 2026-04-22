import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, sql, asc } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema, nextDocumentNumber } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { postJournal } from "../accounting/journal-posting.js";
import { emitNotification } from "../notifications/emit.js";
import {
  postReversingJournal,
  rewindStockForSource,
} from "../accounting/reversing-journal.js";
import {
  applyStockIssue,
  peekStockIssue,
  resolveDefaultWarehouse,
  resolveStockGLAccounts,
} from "../inventory/stock-posting.js";
import { loadTenantSettings } from "../settings/routes.js";

const LineSchema = z.object({
  itemId: z.string().uuid().optional(),
  description: z.string().min(1).max(500),
  quantity: z.number().positive().max(1_000_000),
  unitPriceCents: z.number().int().min(0),
  discountPctBps: z.number().int().min(0).max(10000).default(0),
  taxCodeId: z.string().uuid().optional(),
});

const CreateSchema = z.object({
  customerId: z.string().uuid(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reference: z.string().max(64).optional().or(z.literal("")),
  poNumber: z.string().max(64).optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  terms: z.string().optional().or(z.literal("")),
  lines: z.array(LineSchema).min(1),
});

interface ComputedLine {
  lineNo: number;
  itemId: string | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  lineSubtotalCents: number;
  discountPctBps: number;
  discountCents: number;
  taxCodeId: string | null;
  taxRateBps: number;
  taxCents: number;
  lineTotalCents: number;
  incomeAccountId: string | null;
  taxPayableAccountId: string | null;
}

interface LineInput {
  itemId?: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountPctBps?: number;
  taxCodeId?: string;
}

/**
 * Computes line and header totals from raw line inputs, applying the tax
 * code rate and resolving the income account for each line (item default
 * → tenant default sales account).
 */
export async function computeInvoice(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
  lineInputs: LineInput[],
): Promise<{
  lines: ComputedLine[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}> {
  // Preload tax codes and items we need
  const taxCodeIds = Array.from(
    new Set(lineInputs.map((l) => l.taxCodeId).filter((v): v is string => !!v)),
  );
  const itemIds = Array.from(
    new Set(lineInputs.map((l) => l.itemId).filter((v): v is string => !!v)),
  );

  const taxRows = taxCodeIds.length
    ? await tx
        .select()
        .from(schema.taxCodes)
        .where(and(eq(schema.taxCodes.tenantId, tenantId), isNull(schema.taxCodes.deletedAt)))
    : [];
  const taxById = new Map(taxRows.map((t) => [t.id, t]));

  const itemRows = itemIds.length
    ? await tx
        .select()
        .from(schema.items)
        .where(and(eq(schema.items.tenantId, tenantId), isNull(schema.items.deletedAt)))
    : [];
  const itemById = new Map(itemRows.map((i) => [i.id, i]));

  // Default sales account (subtype = 'sales')
  const defaultSalesRows = await tx
    .select()
    .from(schema.chartOfAccounts)
    .where(
      and(
        eq(schema.chartOfAccounts.tenantId, tenantId),
        eq(schema.chartOfAccounts.accountSubtype, "sales"),
        isNull(schema.chartOfAccounts.deletedAt),
      ),
    )
    .orderBy(asc(schema.chartOfAccounts.code))
    .limit(1);
  const defaultSalesAccountId = defaultSalesRows[0]?.id ?? null;

  const lines: ComputedLine[] = lineInputs.map((l, idx) => {
    const qty = l.quantity;
    const unit = l.unitPriceCents;
    const subtotal = Math.round(qty * unit);
    const discountPctBps = l.discountPctBps ?? 0;
    const discount = Math.round((subtotal * discountPctBps) / 10_000);
    const taxable = subtotal - discount;
    const tax = taxById.get(l.taxCodeId ?? "");
    const taxRateBps = tax?.rateBps ?? 0;
    const taxCents = Math.round((taxable * taxRateBps) / 10_000);
    const lineTotal = taxable + taxCents;
    const item = itemById.get(l.itemId ?? "");
    const incomeAccountId = item?.incomeAccountId ?? defaultSalesAccountId;

    return {
      lineNo: idx + 1,
      itemId: l.itemId ?? null,
      description: l.description,
      quantity: qty,
      unitPriceCents: unit,
      lineSubtotalCents: subtotal,
      discountPctBps,
      discountCents: discount,
      taxCodeId: l.taxCodeId ?? null,
      taxRateBps,
      taxCents,
      lineTotalCents: lineTotal,
      incomeAccountId,
      taxPayableAccountId: tax?.payableAccountId ?? null,
    };
  });

  const subtotalCents = lines.reduce((s, l) => s + l.lineSubtotalCents, 0);
  const discountCents = lines.reduce((s, l) => s + l.discountCents, 0);
  const taxCents = lines.reduce((s, l) => s + l.taxCents, 0);
  const totalCents = subtotalCents - discountCents + taxCents;

  return { lines, subtotalCents, discountCents, taxCents, totalCents };
}

export const invoicesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /invoices — list
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select({
          id: schema.invoices.id,
          invoiceNumber: schema.invoices.invoiceNumber,
          status: schema.invoices.status,
          issueDate: schema.invoices.issueDate,
          dueDate: schema.invoices.dueDate,
          customerId: schema.invoices.customerId,
          customerName: schema.customers.name,
          currency: schema.invoices.currency,
          subtotalCents: schema.invoices.subtotalCents,
          taxCents: schema.invoices.taxCents,
          totalCents: schema.invoices.totalCents,
          balanceDueCents: schema.invoices.balanceDueCents,
          createdAt: schema.invoices.createdAt,
        })
        .from(schema.invoices)
        .innerJoin(schema.customers, eq(schema.customers.id, schema.invoices.customerId))
        .where(
          and(
            eq(schema.invoices.tenantId, ctx.tenantId),
            isNull(schema.invoices.deletedAt),
          ),
        )
        .orderBy(desc(schema.invoices.createdAt))
        .limit(200),
    );

    return reply.send({ invoices: rows });
  });

  // GET /invoices/:id — detail with lines
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const invRows = await tx
        .select()
        .from(schema.invoices)
        .where(
          and(
            eq(schema.invoices.tenantId, ctx.tenantId),
            eq(schema.invoices.id, req.params.id),
            isNull(schema.invoices.deletedAt),
          ),
        )
        .limit(1);
      const invoice = invRows[0];
      if (!invoice) return null;

      const lines = await tx
        .select()
        .from(schema.invoiceLines)
        .where(eq(schema.invoiceLines.invoiceId, invoice.id))
        .orderBy(asc(schema.invoiceLines.lineNo));

      const customerRows = await tx
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, invoice.customerId))
        .limit(1);

      return { invoice, lines, customer: customerRows[0] ?? null };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  // POST /invoices — create draft
  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;
    const issueDate = input.issueDate ?? new Date().toISOString().slice(0, 10);

    const invoice = await withTenant(ctx.tenantId, async (tx) => {
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
      if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

      // Default due date from customer payment terms
      const dueDate =
        input.dueDate ??
        new Date(new Date(issueDate).getTime() + customer.paymentTermsDays * 86_400_000)
          .toISOString()
          .slice(0, 10);

      const { lines, subtotalCents, discountCents, taxCents, totalCents } =
        await computeInvoice(tx, ctx.tenantId, input.lines);

      const [inv] = await tx
        .insert(schema.invoices)
        .values({
          tenantId: ctx.tenantId,
          customerId: customer.id,
          status: "draft",
          issueDate,
          dueDate,
          currency: customer.currency ?? "LKR",
          subtotalCents,
          discountCents,
          taxCents,
          totalCents,
          balanceDueCents: totalCents,
          reference: input.reference || null,
          poNumber: input.poNumber || null,
          notes: input.notes || null,
          terms: input.terms || null,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!inv) throw new Error("Invoice insert failed");

      await tx.insert(schema.invoiceLines).values(
        lines.map((l) => ({
          tenantId: ctx.tenantId,
          invoiceId: inv.id,
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

      return inv;
    }).catch((err: Error) => {
      if (err.message === "CUSTOMER_NOT_FOUND") {
        reply.status(400).send({ error: { code: "CUSTOMER_NOT_FOUND" } });
        return null;
      }
      throw err;
    });

    if (!invoice) return;
    return reply.status(201).send({ invoice });
  });

  // POST /invoices/:id/duplicate — recurring-invoice helper. Copies
  // header fields + lines into a fresh draft dated today (due date
  // recomputed from customer payment terms). No GL impact until the
  // caller posts the new draft. Works against any source status except
  // void (can't meaningfully duplicate a voided invoice).
  fastify.post<{ Params: { id: string } }>("/:id/duplicate", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [src] = await tx
        .select()
        .from(schema.invoices)
        .where(
          and(
            eq(schema.invoices.tenantId, ctx.tenantId),
            eq(schema.invoices.id, req.params.id),
            isNull(schema.invoices.deletedAt),
          ),
        )
        .limit(1);
      if (!src) return { error: "NOT_FOUND" as const };
      if (src.status === "void") return { error: "SOURCE_VOID" as const };

      const srcLines = await tx
        .select()
        .from(schema.invoiceLines)
        .where(eq(schema.invoiceLines.invoiceId, src.id))
        .orderBy(asc(schema.invoiceLines.lineNo));
      if (srcLines.length === 0) return { error: "SOURCE_EMPTY" as const };

      // Pull customer to recompute due date from payment terms.
      const [customer] = await tx
        .select()
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.tenantId, ctx.tenantId),
            eq(schema.customers.id, src.customerId),
          ),
        )
        .limit(1);
      if (!customer) return { error: "CUSTOMER_NOT_FOUND" as const };

      const today = new Date().toISOString().slice(0, 10);
      const dueDate = new Date(
        new Date(today).getTime() + customer.paymentTermsDays * 86_400_000,
      )
        .toISOString()
        .slice(0, 10);

      const [inv] = await tx
        .insert(schema.invoices)
        .values({
          tenantId: ctx.tenantId,
          customerId: src.customerId,
          branchId: src.branchId,
          status: "draft",
          issueDate: today,
          dueDate,
          currency: src.currency,
          subtotalCents: src.subtotalCents,
          discountCents: src.discountCents,
          taxCents: src.taxCents,
          totalCents: src.totalCents,
          balanceDueCents: src.totalCents,
          reference: src.reference,
          poNumber: null, // PO numbers are specific to the source engagement
          notes: src.notes,
          terms: src.terms,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!inv) return { error: "INSERT_FAILED" as const };

      await tx.insert(schema.invoiceLines).values(
        srcLines.map((l) => ({
          tenantId: ctx.tenantId,
          invoiceId: inv.id,
          lineNo: l.lineNo,
          itemId: l.itemId,
          description: l.description,
          quantity: l.quantity,
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

      return { invoice: inv };
    });

    if ("error" in result) {
      const msgs: Record<string, string> = {
        NOT_FOUND: "Source invoice not found.",
        SOURCE_VOID: "Can't duplicate a voided invoice.",
        SOURCE_EMPTY: "Source invoice has no lines.",
        CUSTOMER_NOT_FOUND: "Source customer was deleted.",
        INSERT_FAILED: "Couldn't create the duplicate.",
      };
      const code = result.error as string;
      const status = code === "NOT_FOUND" || code === "CUSTOMER_NOT_FOUND" ? 404 : 400;
      return reply.status(status).send({ error: { code, message: msgs[code] ?? code } });
    }
    return reply.status(201).send({ invoice: result.invoice });
  });

  // POST /invoices/:id/post — finalize and post to GL
  fastify.post<{ Params: { id: string } }>("/:id/post", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const invRows = await tx
        .select()
        .from(schema.invoices)
        .where(
          and(
            eq(schema.invoices.tenantId, ctx.tenantId),
            eq(schema.invoices.id, req.params.id),
            isNull(schema.invoices.deletedAt),
          ),
        )
        .limit(1);
      const invoice = invRows[0];
      if (!invoice) return { error: "NOT_FOUND" as const };
      if (invoice.status !== "draft") return { error: "NOT_DRAFT" as const };

      // Credit checks: hard block on credit_hold, soft block on exposure
      // exceeding credit_limit. Skipped when credit_limit is 0 (treated as
      // "no limit enforced" to avoid breaking tenants that haven't set one).
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
        return {
          error: "CREDIT_HOLD" as const,
          reason: creditInfo.creditHoldReason ?? null,
        };
      }
      if (creditInfo && creditInfo.creditLimitCents > 0) {
        const openArRows = (await tx.execute(sql`
          SELECT customer_open_ar_cents(${invoice.customerId}::uuid)::bigint AS open_cents
        `)) as unknown as Array<{ open_cents: number | string }>;
        const openCents = Number(openArRows[0]?.open_cents ?? 0);
        const newExposure = openCents + invoice.totalCents;
        if (newExposure > creditInfo.creditLimitCents) {
          return {
            error: "CREDIT_LIMIT_EXCEEDED" as const,
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

      if (lines.length === 0) return { error: "NO_LINES" as const };

      // Assign invoice number via sequence
      const invoiceNumber = await nextDocumentNumber(tx, "invoice");

      // Build journal: DR AR · CR income-by-account · CR VAT/SSCL payable
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
      const arAccount = arRows[0];
      if (!arAccount) return { error: "NO_AR_ACCOUNT" as const };

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
        if (!l.incomeAccountId) {
          return { error: "MISSING_INCOME_ACCOUNT" as const };
        }
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
          .where(eq(schema.taxCodes.tenantId, ctx.tenantId));
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

      // Inventory relief + COGS for tracked items (WAVG, single default warehouse v1).
      // Only runs when the tenant's stockRelieveOn setting = 'invoice' (default).
      // In 'delivery_note' mode, stock is relieved at DN deliver instead, and
      // this invoice post skips all stock/COGS writes.
      const settings = await loadTenantSettings(tx);
      const trackedLines: Array<{
        line: (typeof lines)[number];
        item: typeof schema.items.$inferSelect;
        cogsCents: number;
      }> = [];
      let totalCogsCents = 0;

      const defaultWarehouse = await resolveDefaultWarehouse(tx, ctx.tenantId);
      const { inventoryAccountId, cogsAccountId } = await resolveStockGLAccounts(
        tx,
        ctx.tenantId,
      );

      if (settings.stockRelieveOn === "invoice") {
        const linkedItems = await tx
          .select()
          .from(schema.items)
          .where(
            and(
              eq(schema.items.tenantId, ctx.tenantId),
              isNull(schema.items.deletedAt),
            ),
          );
        const itemById = new Map(linkedItems.map((i) => [i.id, i]));

        for (const l of lines) {
          if (!l.itemId) continue;
          const item = itemById.get(l.itemId);
          if (!item || !item.trackInventory) continue;
          if (!defaultWarehouse) return { error: "NO_DEFAULT_WAREHOUSE" as const };
          if (!inventoryAccountId || !cogsAccountId) return { error: "NO_STOCK_ACCOUNTS" as const };

          const qty = Number(l.quantity);
          if (qty <= 0) continue;

          try {
            const { cogsCents } = await peekStockIssue(tx, {
              tenantId: ctx.tenantId,
              itemId: item.id,
              warehouseId: defaultWarehouse.id,
              quantity: qty,
            });
            trackedLines.push({ line: l, item, cogsCents });
            totalCogsCents += cogsCents;
          } catch (err) {
            const e = err as Error & { code?: string };
            if (e.code === "NEGATIVE_STOCK") return { error: "NEGATIVE_STOCK" as const, item };
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
        tenantId: ctx.tenantId,
        entryDate: invoice.issueDate,
        memo: `Invoice ${invoiceNumber}`,
        sourceType: "invoice",
        sourceId: invoice.id,
        postedByUserId: ctx.userId,
        lines: journalLines,
      });

      // Commit the stock movements with the journal entry id now that it exists
      for (const t of trackedLines) {
        await applyStockIssue(tx, {
          tenantId: ctx.tenantId,
          itemId: t.item.id,
          warehouseId: defaultWarehouse!.id,
          quantity: Number(t.line.quantity),
          sourceDocumentType: "invoice",
          sourceDocumentId: invoice.id,
          sourceLineId: t.line.id,
          journalEntryId: entryId,
          postedByUserId: ctx.userId,
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
          postedByUserId: ctx.userId,
          updatedAt: new Date(),
        })
        .where(eq(schema.invoices.id, invoice.id));

      // Customer name for a friendlier title — cheap single-row join on id.
      const [cust] = await tx
        .select({ name: schema.customers.name })
        .from(schema.customers)
        .where(eq(schema.customers.id, invoice.customerId))
        .limit(1);

      // v1 sends notifications to every user in the tenant — small tenants
      // today, multi-user fan-out is fine inline. A receipts table can
      // replace this when it stops scaling.
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
          tenantId: ctx.tenantId,
          userId: u.id,
          kind: "invoice_posted",
          title: `Invoice ${invoiceNumber} posted`,
          body: `${cust?.name ?? "Customer"} · ${formattedTotal}`,
          refType: "invoice",
          refId: invoice.id,
        });
      }

      return { ok: true as const, invoiceNumber, entryNumber };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
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
      const body: { error: { code: string; message?: string; itemName?: string; reason?: string; openCents?: number; limitCents?: number; newInvoiceCents?: number } } = {
        error: { code: result.error },
      };
      if (result.error === "NEGATIVE_STOCK" && "item" in result && result.item) {
        body.error.message = `Not enough stock on hand for ${result.item.name}. Receive stock via a bill before invoicing.`;
        body.error.itemName = result.item.name;
      }
      if (result.error === "CREDIT_HOLD" && "reason" in result) {
        body.error.message = result.reason
          ? `Customer is on credit hold — ${result.reason}. Clear the hold before posting.`
          : "Customer is on credit hold. Clear the hold before posting.";
        body.error.reason = result.reason ?? undefined;
      }
      if (result.error === "CREDIT_LIMIT_EXCEEDED" && "limitCents" in result) {
        const { openCents, limitCents, newInvoiceCents } = result;
        body.error.message = `Posting would push this customer past their credit limit. Open ${(openCents / 100).toFixed(2)} + this invoice ${(newInvoiceCents / 100).toFixed(2)} = ${((openCents + newInvoiceCents) / 100).toFixed(2)}, limit ${(limitCents / 100).toFixed(2)}. Collect from them or raise the limit first.`;
        body.error.openCents = openCents;
        body.error.limitCents = limitCents;
        body.error.newInvoiceCents = newInvoiceCents;
      }
      return reply.status(map[result.error] ?? 500).send(body);
    }
    return reply.send(result);
  });

  // POST /invoices/:id/void — reverse a posted invoice
  fastify.post<{ Params: { id: string }; Body: { reason?: string } }>(
    "/:id/void",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const invRows = await tx
          .select()
          .from(schema.invoices)
          .where(
            and(
              eq(schema.invoices.tenantId, ctx.tenantId),
              eq(schema.invoices.id, req.params.id),
              isNull(schema.invoices.deletedAt),
            ),
          )
          .limit(1);
        const invoice = invRows[0];
        if (!invoice) return { error: "NOT_FOUND" as const };
        if (invoice.status === "void") return { error: "ALREADY_VOID" as const };
        if (!["posted", "partially_paid"].includes(invoice.status)) {
          return { error: "NOT_VOIDABLE" as const };
        }
        if (invoice.amountPaidCents > 0) {
          return { error: "HAS_PAYMENTS" as const };
        }
        if (!invoice.journalEntryId) return { error: "NO_SOURCE_ENTRY" as const };

        const today = new Date().toISOString().slice(0, 10);
        const { entryId, entryNumber } = await postReversingJournal(tx, {
          tenantId: ctx.tenantId,
          sourceEntryId: invoice.journalEntryId,
          reversalDate: today,
          memo: `Void invoice ${invoice.invoiceNumber ?? invoice.id.slice(0, 8)}${reason ? " · " + reason : ""}`,
          sourceType: "invoice_void",
          sourceId: invoice.id,
          postedByUserId: ctx.userId,
        });

        // Rewind any stock movements from the original posting
        await rewindStockForSource(tx, {
          tenantId: ctx.tenantId,
          sourceDocumentType: "invoice",
          sourceDocumentId: invoice.id,
          journalEntryId: entryId,
          postedByUserId: ctx.userId,
          memo: `Void invoice ${invoice.invoiceNumber ?? invoice.id.slice(0, 8)}`,
        });

        await tx
          .update(schema.invoices)
          .set({
            status: "void",
            balanceDueCents: 0,
            updatedAt: new Date(),
            notes:
              reason && invoice.notes
                ? `${invoice.notes}\n\n[Voided] ${reason}`
                : reason
                  ? `[Voided] ${reason}`
                  : invoice.notes,
          })
          .where(eq(schema.invoices.id, invoice.id));

        return { ok: true as const, reversalEntryNumber: entryNumber };
      }).catch((err: Error & { message: string }) => {
        if (err.message === "ALREADY_REVERSED") {
          return { error: "ALREADY_REVERSED" as const };
        }
        throw err;
      });

      if ("error" in result) {
        const map: Record<string, number> = {
          NOT_FOUND: 404,
          NOT_VOIDABLE: 409,
          ALREADY_VOID: 409,
          ALREADY_REVERSED: 409,
          HAS_PAYMENTS: 409,
          NO_SOURCE_ENTRY: 500,
        };
        const messages: Record<string, string> = {
          HAS_PAYMENTS:
            "This invoice has payments allocated to it. Reverse the payments first, then void the invoice.",
          NOT_VOIDABLE: "Only posted invoices with no payments can be voided.",
          ALREADY_VOID: "This invoice is already void.",
          ALREADY_REVERSED: "The original journal entry is already reversed.",
        };
        return reply
          .status(map[result.error] ?? 500)
          .send({ error: { code: result.error, message: messages[result.error] } });
      }
      return reply.send(result);
    },
  );

  // POST /invoices/:id/write-off — give up on collection, clear the AR,
  // optionally claim VAT bad-debt relief. Eligible when invoice is
  // posted/partially_paid with a positive balance.
  //
  // VAT relief proration: we prorate invoice.taxCents by
  // balance_due / total. For pure VAT invoices this is exact; for
  // mixed VAT+SSCL this slightly over-states VAT relief (since SSCL
  // is not reclaimable). v2 will derive VAT-only from line tax codes.
  fastify.post<{
    Params: { id: string };
    Body: { reason: string; claimVatRelief?: boolean };
  }>("/:id/write-off", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const reason = (req.body?.reason ?? "").trim();
    if (!reason) {
      return reply
        .status(400)
        .send({ error: { code: "REASON_REQUIRED", message: "Reason is required." } });
    }
    const claimVatRelief = req.body?.claimVatRelief === true;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [inv] = await tx
        .select()
        .from(schema.invoices)
        .where(
          and(
            eq(schema.invoices.tenantId, ctx.tenantId),
            eq(schema.invoices.id, req.params.id),
            isNull(schema.invoices.deletedAt),
          ),
        )
        .limit(1);
      if (!inv) return { error: "NOT_FOUND" as const };
      if (inv.status !== "posted" && inv.status !== "partially_paid") {
        return { error: "NOT_ELIGIBLE" as const };
      }
      if (inv.balanceDueCents <= 0) {
        return { error: "NO_BALANCE" as const };
      }

      // Resolve accounts: AR (existing invoice.journalEntryId uses one; we
      // just look it up again here for cleanliness), bad debt expense 6500,
      // VAT payable 2100.
      const coaRows = await tx
        .select()
        .from(schema.chartOfAccounts)
        .where(
          and(
            eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
            isNull(schema.chartOfAccounts.deletedAt),
          ),
        );
      const byCode = new Map(coaRows.map((a) => [a.code, a]));
      const arAccount = coaRows.find((a) => a.accountSubtype === "ar");
      const badDebtAccount = byCode.get("6500");
      const vatPayable = byCode.get("2100");
      if (!arAccount) return { error: "NO_AR_ACCOUNT" as const };
      if (!badDebtAccount) return { error: "NO_BAD_DEBT_ACCOUNT" as const };

      // Prorate VAT relief against the balance being written off. Only
      // attempted when user opts in AND the invoice carries tax.
      let vatRelief = 0;
      if (claimVatRelief && inv.taxCents > 0 && inv.totalCents > 0) {
        if (!vatPayable) return { error: "NO_VAT_ACCOUNT" as const };
        vatRelief = Math.min(
          inv.taxCents,
          Math.round((inv.taxCents * inv.balanceDueCents) / inv.totalCents),
        );
      }
      const principalCents = inv.balanceDueCents - vatRelief;

      const lines: Parameters<typeof postJournal>[1]["lines"] = [
        {
          accountId: badDebtAccount.id,
          drCents: principalCents,
          description: `Bad debt · ${inv.invoiceNumber ?? inv.id.slice(0, 8)}`,
          customerId: inv.customerId,
        },
      ];
      if (vatRelief > 0 && vatPayable) {
        lines.push({
          accountId: vatPayable.id,
          drCents: vatRelief,
          description: `VAT bad-debt relief · ${inv.invoiceNumber ?? ""}`.trim(),
          customerId: inv.customerId,
        });
      }
      lines.push({
        accountId: arAccount.id,
        crCents: inv.balanceDueCents,
        description: `Write-off · ${inv.invoiceNumber ?? ""}`.trim(),
        customerId: inv.customerId,
      });

      const today = new Date().toISOString().slice(0, 10);
      const { entryId, entryNumber } = await postJournal(tx, {
        tenantId: ctx.tenantId,
        entryDate: today,
        memo: `Write-off · ${inv.invoiceNumber ?? inv.id.slice(0, 8)} · ${reason}`,
        sourceType: "bad_debt_writeoff",
        sourceId: inv.id,
        postedByUserId: ctx.userId,
        lines,
      });

      await tx
        .update(schema.invoices)
        .set({
          status: "written_off",
          balanceDueCents: 0,
          writtenOffAt: new Date(),
          writeoffReason: reason,
          writeoffJournalEntryId: entryId,
          writeoffVatReliefCents: vatRelief,
          writeoffPrincipalCents: principalCents,
          updatedAt: new Date(),
        })
        .where(eq(schema.invoices.id, inv.id));

      return {
        ok: true as const,
        entryId,
        entryNumber,
        principalCents,
        vatReliefCents: vatRelief,
      };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        NOT_FOUND: 404,
        NOT_ELIGIBLE: 409,
        NO_BALANCE: 409,
        NO_AR_ACCOUNT: 500,
        NO_BAD_DEBT_ACCOUNT: 500,
        NO_VAT_ACCOUNT: 500,
      };
      const msgs: Record<string, string> = {
        NOT_ELIGIBLE: "Only posted or partially paid invoices can be written off.",
        NO_BALANCE: "This invoice has no outstanding balance to write off.",
        NO_AR_ACCOUNT: "No Accounts Receivable account configured.",
        NO_BAD_DEBT_ACCOUNT: "No bad debt expense account (code 6500) configured.",
        NO_VAT_ACCOUNT: "Can't claim VAT relief without a VAT Payable account.",
      };
      const code = result.error as string;
      return reply.status(map[code] ?? 500).send({ error: { code, message: msgs[code] ?? code } });
    }
    return reply.send(result);
  });

  // POST /invoices/:id/reverse-write-off — customer paid after all. Flip
  // the write-off journal, reopen the invoice, restore balance_due.
  fastify.post<{ Params: { id: string }; Body: { reason?: string } }>(
    "/:id/reverse-write-off",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;
      const reason = (req.body?.reason ?? "").trim();

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [inv] = await tx
          .select()
          .from(schema.invoices)
          .where(
            and(
              eq(schema.invoices.tenantId, ctx.tenantId),
              eq(schema.invoices.id, req.params.id),
              isNull(schema.invoices.deletedAt),
            ),
          )
          .limit(1);
        if (!inv) return { error: "NOT_FOUND" as const };
        if (inv.status !== "written_off") return { error: "NOT_WRITTEN_OFF" as const };
        if (!inv.writeoffJournalEntryId) return { error: "NO_SOURCE_ENTRY" as const };

        const today = new Date().toISOString().slice(0, 10);
        const { entryId, entryNumber } = await postReversingJournal(tx, {
          tenantId: ctx.tenantId,
          sourceEntryId: inv.writeoffJournalEntryId,
          reversalDate: today,
          memo: reason
            ? `Reverse write-off · ${inv.invoiceNumber ?? ""} · ${reason}`.trim()
            : `Reverse write-off · ${inv.invoiceNumber ?? ""}`.trim(),
          sourceType: "bad_debt_writeoff_reversal",
          sourceId: inv.id,
          postedByUserId: ctx.userId,
        });

        // Restore invoice state. If there were payments before write-off
        // (partially_paid), go back to partially_paid; otherwise posted.
        const restoredBalance = inv.writeoffPrincipalCents + inv.writeoffVatReliefCents;
        const newStatus = inv.amountPaidCents > 0 ? "partially_paid" : "posted";

        await tx
          .update(schema.invoices)
          .set({
            status: newStatus,
            balanceDueCents: restoredBalance,
            writtenOffAt: null,
            writeoffReason: null,
            writeoffJournalEntryId: null,
            writeoffVatReliefCents: 0,
            writeoffPrincipalCents: 0,
            updatedAt: new Date(),
          })
          .where(eq(schema.invoices.id, inv.id));

        return { ok: true as const, entryId, entryNumber };
      });

      if ("error" in result) {
        const map: Record<string, number> = {
          NOT_FOUND: 404,
          NOT_WRITTEN_OFF: 409,
          NO_SOURCE_ENTRY: 500,
        };
        const code = result.error as string;
        return reply.status(map[code] ?? 500).send({ error: { code } });
      }
      return reply.send(result);
    },
  );
};
