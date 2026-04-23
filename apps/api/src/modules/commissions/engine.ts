// Commission engine — computes + persists commission earnings in response to
// sales events (invoice post, customer payment, credit note post).
//
// Deliberately framework-free: every function takes a tx (PostgresJsDatabase)
// and runs inside an existing withTenant transaction. The caller owns the tx;
// we just append rows to commission_earnings.
//
// v1 scope notes:
//   · Formulas: flat_pct, tiered_volume (marginal by salesperson monthly volume).
//     Per-item/per-customer scoping is handled via item_ids/customer_ids filters
//     on the rule itself, not as separate formulas.
//   · On-collection variant = trigger_event='payment_received', applied per
//     payment allocation against a posted invoice.
//   · Claw-back on credit note post = proportional reversal of the original
//     invoice's earnings (positive + negative rows both visible in the ledger).
//   · Multi-rule aggregation: every matching rule fires; sum of their earnings
//     is what the salesperson is owed.

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { and, eq, gte, lte, isNull, or, sql } from "drizzle-orm";
import { schema } from "@pettahpro/db";

type Tx = PostgresJsDatabase<typeof schema>;

// --- rule shapes ------------------------------------------------------------

type FlatPctConfig = { bps: number };
type TieredConfig = { tiers: Array<{ upToCents?: number | null; bps: number }> };

interface RuleRow {
  id: string;
  tenantId: string;
  name: string;
  triggerEvent: "invoice_posted" | "payment_received";
  formula: "flat_pct" | "tiered_volume";
  config: Record<string, unknown>;
  salespersonUserIds: string[] | null;
  itemIds: string[] | null;
  customerIds: string[] | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  priority: number;
}

function coerceRule(r: typeof schema.commissionRules.$inferSelect): RuleRow {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    triggerEvent: r.triggerEvent as RuleRow["triggerEvent"],
    formula: r.formula as RuleRow["formula"],
    config: (r.config as Record<string, unknown>) ?? {},
    salespersonUserIds: Array.isArray(r.salespersonUserIds)
      ? (r.salespersonUserIds as string[])
      : null,
    itemIds: Array.isArray(r.itemIds) ? (r.itemIds as string[]) : null,
    customerIds: Array.isArray(r.customerIds) ? (r.customerIds as string[]) : null,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    priority: r.priority,
  };
}

// --- public api -------------------------------------------------------------

/**
 * Fired from invoice-posting.ts after a draft invoice is posted. Accrues
 * commission earnings for every active 'invoice_posted' rule that matches.
 *
 * No-ops silently when:
 *   · invoice has no salesperson_user_id (unattributed sale)
 *   · zero rules match
 *   · per-rule base comes out ≤ 0 (e.g. item filter excludes every line)
 *
 * Caller must hold a withTenant tx. Uses unique index on (rule_id, source)
 * so a replayed invoice post won't duplicate earnings.
 */
export async function accrueOnInvoicePost(
  tx: Tx,
  input: {
    tenantId: string;
    invoiceId: string;
    invoiceNumber: string;
    issueDate: string;
    customerId: string;
    salespersonUserId: string | null;
    // Lines contributing to the commission base. Base per rule is determined
    // by filtering these by item_ids scope then summing (subtotal - discount).
    lines: Array<{
      itemId: string | null;
      netCents: number; // line_subtotal - line_discount (pre-tax)
    }>;
    invoiceNetCents: number; // whole-invoice base (pre-tax, post-discount)
  },
): Promise<void> {
  if (!input.salespersonUserId) return;
  if (input.invoiceNetCents <= 0) return;

  const rules = await fetchActiveRules(tx, {
    tenantId: input.tenantId,
    triggerEvent: "invoice_posted",
    entryDate: input.issueDate,
    salespersonUserId: input.salespersonUserId,
    customerId: input.customerId,
  });

  for (const rule of rules) {
    const base = computeRuleBase(rule, input.lines, input.invoiceNetCents);
    if (base <= 0) continue;

    const { amountCents, rateBps } = await computeAmount(tx, {
      rule,
      base,
      salespersonUserId: input.salespersonUserId,
      earnedAt: input.issueDate,
    });
    if (amountCents <= 0) continue;

    await insertEarning(tx, {
      tenantId: input.tenantId,
      ruleId: rule.id,
      salespersonUserId: input.salespersonUserId,
      sourceType: "invoice",
      sourceId: input.invoiceId,
      sourceNumber: input.invoiceNumber,
      customerId: input.customerId,
      baseCents: base,
      rateBps,
      amountCents,
      earnedAt: input.issueDate,
      memo: `${rule.name} · ${input.invoiceNumber}`,
    });
  }
}

/**
 * Fired from payment recording after a customer_payment is allocated against
 * invoices. Accrues commissions for every active 'payment_received' rule.
 *
 * Commission base per allocation = allocated_cents (the portion of the payment
 * that hit THIS invoice). We look up the invoice's salesperson so cash-in on
 * a sale done by Alice credits Alice, even if Bob keyed the payment.
 *
 * Uses (rule_id, source=payment, source_id=paymentId) uniqueness so replaying
 * the payment won't duplicate. One earning per (rule × payment × salesperson).
 */
export async function accrueOnPayment(
  tx: Tx,
  input: {
    tenantId: string;
    paymentId: string;
    paymentNumber: string | null;
    paymentDate: string;
    customerId: string;
    allocations: Array<{
      invoiceId: string;
      allocatedCents: number;
    }>;
  },
): Promise<void> {
  if (input.allocations.length === 0) return;

  // Load the invoices to find their salesperson tags.
  const invIds = input.allocations.map((a) => a.invoiceId);
  const invs = await tx.execute(sql`
    SELECT id, salesperson_user_id, invoice_number, total_cents
    FROM invoices
    WHERE id = ANY(${invIds}::uuid[])
      AND tenant_id = current_tenant_id()
  `);
  type Row = { id: string; salesperson_user_id: string | null; invoice_number: string | null; total_cents: number | string };
  const invRows = invs as unknown as Row[];
  const invById = new Map(invRows.map((r) => [r.id, r]));

  // Group allocations by salesperson so tiered-volume math uses the daily/
  // monthly aggregate correctly.
  for (const alloc of input.allocations) {
    const inv = invById.get(alloc.invoiceId);
    if (!inv || !inv.salesperson_user_id) continue;
    const salespersonUserId = inv.salesperson_user_id;

    const rules = await fetchActiveRules(tx, {
      tenantId: input.tenantId,
      triggerEvent: "payment_received",
      entryDate: input.paymentDate,
      salespersonUserId,
      customerId: input.customerId,
    });
    if (rules.length === 0) continue;

    for (const rule of rules) {
      // For payment_received rules, item_ids scope is a soft filter: we can't
      // tell which lines the allocation "pays for" without a full per-line
      // allocation. v1: if the rule has item_ids, we skip it on payment events
      // (an operator who wants item-level commissions should use invoice_posted).
      if (rule.itemIds && rule.itemIds.length > 0) continue;

      const base = alloc.allocatedCents;
      if (base <= 0) continue;

      const { amountCents, rateBps } = await computeAmount(tx, {
        rule,
        base,
        salespersonUserId,
        earnedAt: input.paymentDate,
      });
      if (amountCents <= 0) continue;

      await insertEarning(tx, {
        tenantId: input.tenantId,
        ruleId: rule.id,
        salespersonUserId,
        sourceType: "payment",
        sourceId: input.paymentId,
        sourceNumber: input.paymentNumber,
        customerId: input.customerId,
        baseCents: base,
        rateBps,
        amountCents,
        earnedAt: input.paymentDate,
        memo: `${rule.name} · payment ${input.paymentNumber ?? ""} → ${inv.invoice_number ?? ""}`.trim(),
      });
    }
  }
}

/**
 * Fired from credit-note post. Inserts proportional claw-back rows against
 * every existing earning tied to the original invoice (if the CN links to one).
 *
 * Proportion = cnAmountCents / originalInvoiceTotalCents, clamped to [0, 1].
 * Claw-back earning rows carry the same rule, negative amount, status='accrued'
 * so they offset the original on the next payroll run.
 *
 * Unlinked CNs (reason=goodwill without invoice) create no claw-backs — the
 * commission engine has no way to attribute them.
 */
export async function clawbackOnCreditNotePost(
  tx: Tx,
  input: {
    tenantId: string;
    creditNoteId: string;
    creditNoteNumber: string;
    issueDate: string;
    customerId: string;
    originalInvoiceId: string | null;
    cnTotalCents: number;
    originalInvoiceTotalCents: number | null;
  },
): Promise<void> {
  if (!input.originalInvoiceId || !input.originalInvoiceTotalCents) return;
  if (input.originalInvoiceTotalCents <= 0 || input.cnTotalCents <= 0) return;

  // Load every earning attached to the original invoice (including payment
  // rows that reference it via source_number is brittle — we scope to
  // source_type='invoice' + source_id=invoiceId; payment-triggered earnings
  // are clawed back when the payment itself is reversed, not on CN).
  const originalEarnings = await tx
    .select()
    .from(schema.commissionEarnings)
    .where(
      and(
        eq(schema.commissionEarnings.tenantId, input.tenantId),
        eq(schema.commissionEarnings.sourceType, "invoice"),
        eq(schema.commissionEarnings.sourceId, input.originalInvoiceId),
      ),
    );

  if (originalEarnings.length === 0) return;

  const proportion =
    Math.min(1, input.cnTotalCents / input.originalInvoiceTotalCents);

  for (const orig of originalEarnings) {
    // Claw-back amount is proportional to the CN share of the original
    // invoice total. Rounded to the nearest cent; use Math.round for
    // symmetric rounding so big CNs don't underrecover.
    const clawAmount = Math.round(orig.amountCents * proportion);
    if (clawAmount <= 0) continue;

    await insertEarning(tx, {
      tenantId: input.tenantId,
      ruleId: orig.ruleId,
      salespersonUserId: orig.salespersonUserId,
      sourceType: "credit_note",
      sourceId: input.creditNoteId,
      sourceNumber: input.creditNoteNumber,
      customerId: input.customerId,
      baseCents: -Math.round(orig.baseCents * proportion),
      rateBps: orig.rateBps,
      amountCents: -clawAmount,
      earnedAt: input.issueDate,
      memo: `Claw-back · ${input.creditNoteNumber} vs ${orig.sourceNumber ?? ""}`.trim(),
      clawbackOfEarningId: orig.id,
    });
  }
}

// --- internals --------------------------------------------------------------

async function fetchActiveRules(
  tx: Tx,
  input: {
    tenantId: string;
    triggerEvent: "invoice_posted" | "payment_received";
    entryDate: string;
    salespersonUserId: string;
    customerId: string;
  },
): Promise<RuleRow[]> {
  const rows = await tx
    .select()
    .from(schema.commissionRules)
    .where(
      and(
        eq(schema.commissionRules.tenantId, input.tenantId),
        eq(schema.commissionRules.status, "active"),
        eq(schema.commissionRules.triggerEvent, input.triggerEvent),
        isNull(schema.commissionRules.deletedAt),
        lte(schema.commissionRules.effectiveFrom, input.entryDate),
        or(
          isNull(schema.commissionRules.effectiveTo),
          gte(schema.commissionRules.effectiveTo, input.entryDate),
        ),
      ),
    );

  // Post-filter by scope lists (salespeople, customers). Item-filter is
  // evaluated per-rule during base computation.
  return rows
    .map(coerceRule)
    .filter((r) => {
      if (r.salespersonUserIds && !r.salespersonUserIds.includes(input.salespersonUserId)) {
        return false;
      }
      if (r.customerIds && !r.customerIds.includes(input.customerId)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => a.priority - b.priority);
}

function computeRuleBase(
  rule: RuleRow,
  lines: Array<{ itemId: string | null; netCents: number }>,
  invoiceNetCents: number,
): number {
  if (!rule.itemIds || rule.itemIds.length === 0) {
    // No item filter — whole-invoice base.
    return invoiceNetCents;
  }
  // Item-filtered base: sum the matching lines only.
  const allow = new Set(rule.itemIds);
  let sum = 0;
  for (const l of lines) {
    if (l.itemId && allow.has(l.itemId)) sum += l.netCents;
  }
  return Math.max(0, sum);
}

async function computeAmount(
  tx: Tx,
  input: {
    rule: RuleRow;
    base: number;
    salespersonUserId: string;
    earnedAt: string;
  },
): Promise<{ amountCents: number; rateBps: number }> {
  const { rule, base, salespersonUserId, earnedAt } = input;

  if (rule.formula === "flat_pct") {
    const cfg = rule.config as unknown as FlatPctConfig;
    const bps = Number(cfg?.bps ?? 0);
    if (bps <= 0) return { amountCents: 0, rateBps: 0 };
    return {
      amountCents: Math.round((base * bps) / 10_000),
      rateBps: bps,
    };
  }

  if (rule.formula === "tiered_volume") {
    const cfg = rule.config as unknown as TieredConfig;
    const tiers = Array.isArray(cfg?.tiers) ? cfg.tiers : [];
    if (tiers.length === 0) return { amountCents: 0, rateBps: 0 };

    // Month-to-date volume for this salesperson on already-accrued earnings.
    // Dates use earned_at; status filter excludes voided rows but includes
    // clawed-back (so the running tier accounts for net volume).
    const monthStart = earnedAt.slice(0, 7) + "-01";
    const volRows = (await tx.execute(sql`
      SELECT COALESCE(SUM(base_cents), 0)::bigint AS volume
      FROM commission_earnings
      WHERE tenant_id = current_tenant_id()
        AND salesperson_user_id = ${salespersonUserId}::uuid
        AND earned_at >= ${monthStart}::date
        AND earned_at <= ${earnedAt}::date
        AND status IN ('accrued', 'paid')
    `)) as unknown as Array<{ volume: number | string }>;
    const volumeBefore = Number(volRows[0]?.volume ?? 0);

    // Marginal tier walk: split the base across tier boundaries.
    let remaining = base;
    let cursor = volumeBefore;
    let weightedAmount = 0;
    for (const tier of tiers) {
      if (remaining <= 0) break;
      const ceiling = tier.upToCents == null ? Infinity : tier.upToCents;
      if (cursor >= ceiling) continue;
      const slotRoom = ceiling - cursor;
      const take = Math.min(remaining, slotRoom);
      weightedAmount += Math.round((take * tier.bps) / 10_000);
      cursor += take;
      remaining -= take;
    }
    const amountCents = Math.max(0, weightedAmount);
    const rateBps = base > 0 ? Math.round((amountCents * 10_000) / base) : 0;
    return { amountCents, rateBps };
  }

  return { amountCents: 0, rateBps: 0 };
}

async function insertEarning(
  tx: Tx,
  input: {
    tenantId: string;
    ruleId: string;
    salespersonUserId: string;
    sourceType: "invoice" | "payment" | "credit_note";
    sourceId: string;
    sourceNumber: string | null;
    customerId: string | null;
    baseCents: number;
    rateBps: number;
    amountCents: number;
    earnedAt: string;
    memo?: string;
    clawbackOfEarningId?: string;
  },
): Promise<void> {
  // ON CONFLICT DO NOTHING on (rule_id, source_type, source_id) — the unique
  // index from the migration. Drizzle's insert().onConflictDoNothing() covers it.
  await tx
    .insert(schema.commissionEarnings)
    .values({
      tenantId: input.tenantId,
      ruleId: input.ruleId,
      salespersonUserId: input.salespersonUserId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceNumber: input.sourceNumber,
      customerId: input.customerId,
      baseCents: input.baseCents,
      rateBps: input.rateBps,
      amountCents: input.amountCents,
      earnedAt: input.earnedAt,
      memo: input.memo ?? null,
      clawbackOfEarningId: input.clawbackOfEarningId ?? null,
    })
    .onConflictDoNothing({
      target: [
        schema.commissionEarnings.ruleId,
        schema.commissionEarnings.sourceType,
        schema.commissionEarnings.sourceId,
      ],
    });
}
