import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";
import { postJournal } from "./journal-posting.js";
import { postReversingJournal } from "./reversing-journal.js";

// FX revaluation at period close — roadmap #44.
//
// Re-measures open foreign-currency AR (invoices) and AP (bills) at the
// closing rate on `as_of_date` and books the delta to 4510 Unrealized FX
// gain / 5510 Unrealized FX loss vs the AR / AP control accounts.
//
// Incremental-delta semantics: each revaluation line records
//   cumulative_delta_cents      — LKR gap between issue rate and as-of rate
//                                  for the foreign_outstanding balance
//   previous_cumulative_delta   — the same document's cumulative as last
//                                  POSTED (non-voided) run
//   incremental_delta_cents     — the difference booked THIS run
//
// Because each new run only posts the incremental move, the prior run is
// naturally superseded — no separate month-start reversal needed. If a
// run is VOIDED, its lines no longer count as a "previous" baseline, so
// the next run recomputes against the last surviving posted run (or zero).
//
// v1 scope: posted, non-void invoices + bills in a non-LKR currency with
// outstanding balance > 0 on `as_of_date`. Credit / debit notes are out
// (they float as unapplied credits — see 56-fx-revaluation.sql header).
//
// Permission gating: accounting.manage on post + void. Compute (draft) is
// readable by anyone authenticated — it's a preview with no GL effect.

const CreateSchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(1000).optional(),
});

// ---------- Core compute ------------------------------------------------------

interface DraftLine {
  sourceType: "invoice" | "bill";
  sourceId: string;
  docNumber: string;
  currency: string;
  issueFxRate: string;
  foreignOutstandingCents: number;
  lkrOnLedgerCents: number;
  asOfRate: string;
  lkrAtAsOfCents: number;
  cumulativeDeltaCents: number;
  previousCumulativeDeltaCents: number;
  incrementalDeltaCents: number;
  direction: "ar" | "ap";
}

/**
 * Gathers open foreign-currency AR + AP as of the given date and computes
 * the incremental revaluation delta per document. Reads only — no writes.
 *
 * Returns one DraftLine per eligible document (may be empty). Sign of
 * `cumulativeDeltaCents` / `incrementalDeltaCents`:
 *   positive → LKR value of the foreign balance has RISEN vs original
 *              · AR: gain (asset worth more in LKR)
 *              · AP: loss (liability costs more LKR to settle)
 *   negative → LKR value has FALLEN
 *              · AR: loss · AP: gain
 */
async function computeDraftLines(
  tx: PostgresJsDatabase<typeof schema>,
  tenantId: string,
  asOfDate: string,
): Promise<DraftLine[]> {
  // Load the latest rate per non-LKR currency as of the closing date.
  // We index by fromCurrency (USD, EUR, ...) with toCurrency='LKR'; if a
  // tenant has only the reverse direction stored, we fall back to 1/rate.
  const rateRows = (await tx.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (from_currency, to_currency)
        from_currency, to_currency, rate, rate_date
      FROM fx_rates
      WHERE tenant_id = ${tenantId}::uuid
        AND rate_date <= ${asOfDate}::date
        AND (from_currency = 'LKR' OR to_currency = 'LKR')
      ORDER BY from_currency, to_currency, rate_date DESC
    )
    SELECT from_currency, to_currency, rate::text AS rate FROM latest
  `)) as unknown as Array<{ from_currency: string; to_currency: string; rate: string }>;

  const rateFor = (currency: string): string | null => {
    // Need "1 <currency> in LKR". Prefer direct from=currency,to=LKR.
    const direct = rateRows.find(
      (r) => r.from_currency === currency && r.to_currency === "LKR",
    );
    if (direct) return direct.rate;
    const inverse = rateRows.find(
      (r) => r.from_currency === "LKR" && r.to_currency === currency,
    );
    if (inverse) {
      const n = Number(inverse.rate);
      if (!n || !Number.isFinite(n)) return null;
      return (1 / n).toFixed(6);
    }
    return null;
  };

  // Pull each document's latest posted revaluation line (from a non-voided
  // run) to use as the `previousCumulativeDelta` baseline.
  const prevRows = (await tx.execute(sql`
    SELECT DISTINCT ON (l.source_type, l.source_id)
      l.source_type, l.source_id, l.cumulative_delta_cents
    FROM fx_revaluation_lines l
    JOIN fx_revaluations r ON r.id = l.revaluation_id
    WHERE l.tenant_id = ${tenantId}::uuid
      AND r.status = 'posted'
    ORDER BY l.source_type, l.source_id, r.as_of_date DESC, r.posted_at DESC
  `)) as unknown as Array<{
    source_type: string;
    source_id: string;
    cumulative_delta_cents: number;
  }>;
  const prevByKey = new Map<string, number>();
  for (const r of prevRows) {
    prevByKey.set(`${r.source_type}:${r.source_id}`, Number(r.cumulative_delta_cents));
  }

  // Open non-LKR invoices as of date
  //
  // Proportional foreign-outstanding: foreign_total × (1 − paid/total).
  // This is a pragmatic v1 approximation — a precise version would trace
  // each payment allocation at its own rate to reach a true "foreign cents
  // still unpaid" number, but until the realized-FX-on-settlement path
  // lands (54-multi-currency.sql v2 list), the ledger doesn't keep that
  // per-payment foreign split anyway.
  const invRows = (await tx.execute(sql`
    SELECT
      i.id, i.invoice_number, i.currency, i.fx_rate::text AS fx_rate,
      i.foreign_total_cents, i.total_cents, i.amount_paid_cents
    FROM invoices i
    WHERE i.tenant_id = ${tenantId}::uuid
      AND i.status = 'posted'
      AND i.deleted_at IS NULL
      AND i.currency <> 'LKR'
      AND i.issue_date <= ${asOfDate}::date
      AND i.foreign_total_cents IS NOT NULL
      AND i.total_cents > 0
      AND i.amount_paid_cents < i.total_cents
  `)) as unknown as Array<{
    id: string;
    invoice_number: string;
    currency: string;
    fx_rate: string;
    foreign_total_cents: number | null;
    total_cents: number;
    amount_paid_cents: number;
  }>;

  const billRows = (await tx.execute(sql`
    SELECT
      b.id,
      COALESCE(b.internal_reference, b.supplier_bill_number, b.id::text) AS bill_number,
      b.currency, b.fx_rate::text AS fx_rate,
      b.foreign_total_cents, b.total_cents, b.amount_paid_cents
    FROM bills b
    WHERE b.tenant_id = ${tenantId}::uuid
      AND b.status = 'posted'
      AND b.deleted_at IS NULL
      AND b.currency <> 'LKR'
      AND b.bill_date <= ${asOfDate}::date
      AND b.foreign_total_cents IS NOT NULL
      AND b.total_cents > 0
      AND b.amount_paid_cents < b.total_cents
  `)) as unknown as Array<{
    id: string;
    bill_number: string;
    currency: string;
    fx_rate: string;
    foreign_total_cents: number | null;
    total_cents: number;
    amount_paid_cents: number;
  }>;

  const lines: DraftLine[] = [];

  const push = (
    row: {
      id: string;
      number: string;
      currency: string;
      fx_rate: string;
      foreign_total_cents: number;
      total_cents: number;
      amount_paid_cents: number;
    },
    direction: "ar" | "ap",
  ) => {
    const asOfRate = rateFor(row.currency);
    if (!asOfRate) return; // no rate → skip (surfaced in warnings out-of-band later)

    const paidRatio = row.total_cents > 0 ? row.amount_paid_cents / row.total_cents : 0;
    const foreignOutstanding = Math.round(row.foreign_total_cents * (1 - paidRatio));
    if (foreignOutstanding <= 0) return;

    const lkrOnLedger = Math.round(foreignOutstanding * Number(row.fx_rate));
    const lkrAtAsOf = Math.round(foreignOutstanding * Number(asOfRate));
    const cumulative = lkrAtAsOf - lkrOnLedger;
    const prev = prevByKey.get(`${direction === "ar" ? "invoice" : "bill"}:${row.id}`) ?? 0;
    const incremental = cumulative - prev;

    lines.push({
      sourceType: direction === "ar" ? "invoice" : "bill",
      sourceId: row.id,
      docNumber: row.number,
      currency: row.currency,
      issueFxRate: row.fx_rate,
      foreignOutstandingCents: foreignOutstanding,
      lkrOnLedgerCents: lkrOnLedger,
      asOfRate,
      lkrAtAsOfCents: lkrAtAsOf,
      cumulativeDeltaCents: cumulative,
      previousCumulativeDeltaCents: prev,
      incrementalDeltaCents: incremental,
      direction,
    });
  };

  for (const r of invRows) {
    push(
      {
        id: r.id,
        number: r.invoice_number,
        currency: r.currency,
        fx_rate: r.fx_rate,
        foreign_total_cents: r.foreign_total_cents!,
        total_cents: r.total_cents,
        amount_paid_cents: r.amount_paid_cents,
      },
      "ar",
    );
  }
  for (const r of billRows) {
    push(
      {
        id: r.id,
        number: r.bill_number,
        currency: r.currency,
        fx_rate: r.fx_rate,
        foreign_total_cents: r.foreign_total_cents!,
        total_cents: r.total_cents,
        amount_paid_cents: r.amount_paid_cents,
      },
      "ap",
    );
  }

  return lines;
}

function aggregateTotals(lines: DraftLine[]) {
  let arGain = 0;
  let arLoss = 0;
  let apGain = 0;
  let apLoss = 0;
  for (const l of lines) {
    if (l.direction === "ar") {
      if (l.incrementalDeltaCents > 0) arGain += l.incrementalDeltaCents;
      else if (l.incrementalDeltaCents < 0) arLoss += -l.incrementalDeltaCents;
    } else {
      // AP: positive cumulative = liability worth MORE LKR → loss
      if (l.incrementalDeltaCents > 0) apLoss += l.incrementalDeltaCents;
      else if (l.incrementalDeltaCents < 0) apGain += -l.incrementalDeltaCents;
    }
  }
  return { arGainCents: arGain, arLossCents: arLoss, apGainCents: apGain, apLossCents: apLoss };
}

function currencySummary(lines: DraftLine[]) {
  const out: Record<string, { openForeign: number; openLkr: number; asOfRate: number; deltaLkr: number }> = {};
  for (const l of lines) {
    const bucket = out[l.currency] ?? {
      openForeign: 0,
      openLkr: 0,
      asOfRate: Number(l.asOfRate),
      deltaLkr: 0,
    };
    bucket.openForeign += l.foreignOutstandingCents;
    bucket.openLkr += l.lkrOnLedgerCents;
    bucket.asOfRate = Number(l.asOfRate); // latest seen for this ccy (same across lines by construction)
    bucket.deltaLkr += l.incrementalDeltaCents;
    out[l.currency] = bucket;
  }
  return out;
}

// ---------- Routes ------------------------------------------------------------

export const fxRevaluationRoutes: FastifyPluginAsync = async (fastify) => {
  // POST / — compute + persist a DRAFT run (no GL effect yet).
  // Rejects if another non-voided run exists for the same as_of_date.
  fastify.post("/", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "accounting.manage");
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "INVALID_INPUT", issues: parsed.error.issues },
      });
    }
    const { asOfDate, notes } = parsed.data;

    try {
      const result = await withTenant(ctx.tenantId, async (tx) => {
        const lines = await computeDraftLines(tx, ctx.tenantId, asOfDate);
        const totals = aggregateTotals(lines);
        const summary = currencySummary(lines);

        const [header] = await tx
          .insert(schema.fxRevaluations)
          .values({
            tenantId: ctx.tenantId,
            asOfDate,
            status: "draft",
            arGainCents: totals.arGainCents,
            arLossCents: totals.arLossCents,
            apGainCents: totals.apGainCents,
            apLossCents: totals.apLossCents,
            currencySummary: summary,
            notes: notes ?? null,
            createdByUserId: ctx.userId,
          })
          .returning();
        if (!header) throw new Error("INSERT_FAILED");

        if (lines.length > 0) {
          await tx.insert(schema.fxRevaluationLines).values(
            lines.map((l) => ({
              tenantId: ctx.tenantId,
              revaluationId: header.id,
              sourceType: l.sourceType,
              sourceId: l.sourceId,
              currency: l.currency,
              issueFxRate: l.issueFxRate,
              foreignOutstandingCents: l.foreignOutstandingCents,
              lkrOnLedgerCents: l.lkrOnLedgerCents,
              asOfRate: l.asOfRate,
              lkrAtAsOfCents: l.lkrAtAsOfCents,
              cumulativeDeltaCents: l.cumulativeDeltaCents,
              previousCumulativeDeltaCents: l.previousCumulativeDeltaCents,
              incrementalDeltaCents: l.incrementalDeltaCents,
              direction: l.direction,
            })),
          );
        }

        return { header, lineCount: lines.length };
      });

      return reply.status(201).send({ revaluation: result.header, lineCount: result.lineCount });
    } catch (err: unknown) {
      if (err instanceof Error && /fx_revaluations_tenant_as_of_active_unique/.test(err.message)) {
        return reply.status(409).send({
          error: {
            code: "DUPLICATE_RUN",
            message: "A non-voided FX revaluation already exists for this as-of date.",
          },
        });
      }
      throw err;
    }
  });

  // GET / — list
  fastify.get<{ Querystring: { status?: string; limit?: string } }>("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
    const status = req.query.status;

    const rows = await withTenant(ctx.tenantId, async (tx) => {
      const conds = [eq(schema.fxRevaluations.tenantId, ctx.tenantId)];
      if (status) conds.push(eq(schema.fxRevaluations.status, status));
      return tx
        .select()
        .from(schema.fxRevaluations)
        .where(and(...conds))
        .orderBy(desc(schema.fxRevaluations.asOfDate), desc(schema.fxRevaluations.createdAt))
        .limit(limit);
    });

    return reply.send({ revaluations: rows });
  });

  // GET /:id — detail with lines
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const headerRows = await tx
        .select()
        .from(schema.fxRevaluations)
        .where(
          and(
            eq(schema.fxRevaluations.tenantId, ctx.tenantId),
            eq(schema.fxRevaluations.id, req.params.id),
          ),
        )
        .limit(1);
      const header = headerRows[0];
      if (!header) return null;

      const lines = await tx
        .select()
        .from(schema.fxRevaluationLines)
        .where(eq(schema.fxRevaluationLines.revaluationId, header.id));

      // Enrich lines with document numbers for display
      const invIds = lines.filter((l) => l.sourceType === "invoice").map((l) => l.sourceId);
      const billIds = lines.filter((l) => l.sourceType === "bill").map((l) => l.sourceId);
      const invNums: Record<string, string> = {};
      const billNums: Record<string, string> = {};
      if (invIds.length > 0) {
        const r = await tx
          .select({ id: schema.invoices.id, number: schema.invoices.invoiceNumber })
          .from(schema.invoices)
          .where(inArray(schema.invoices.id, invIds));
        for (const row of r) if (row.number) invNums[row.id] = row.number;
      }
      if (billIds.length > 0) {
        const r = await tx
          .select({
            id: schema.bills.id,
            internalRef: schema.bills.internalReference,
            supplierNum: schema.bills.supplierBillNumber,
          })
          .from(schema.bills)
          .where(inArray(schema.bills.id, billIds));
        for (const row of r) {
          billNums[row.id] = row.internalRef ?? row.supplierNum ?? row.id;
        }
      }
      const enriched = lines.map((l) => ({
        ...l,
        docNumber: l.sourceType === "invoice" ? invNums[l.sourceId] : billNums[l.sourceId],
      }));

      return { header, lines: enriched };
    });

    if (!result) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send({ revaluation: result.header, lines: result.lines });
  });

  // POST /:id/post — book the JE. Aggregates to (at most) 4 lines:
  //   DR 1100 AR  / CR 4510 gain  — ar gain
  //   DR 5510 loss / CR 1100 AR   — ar loss
  //   DR 2000 AP  / CR 4510 gain  — ap gain  (liability dropped → gain)
  //   DR 5510 loss / CR 2000 AP   — ap loss  (liability grew → loss)
  fastify.post<{ Params: { id: string } }>("/:id/post", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "accounting.manage");
    if (!ctx) return;

    try {
      const result = await withTenant(ctx.tenantId, async (tx) => {
        const headerRows = await tx
          .select()
          .from(schema.fxRevaluations)
          .where(
            and(
              eq(schema.fxRevaluations.tenantId, ctx.tenantId),
              eq(schema.fxRevaluations.id, req.params.id),
            ),
          )
          .limit(1);
        const header = headerRows[0];
        if (!header) return { error: "NOT_FOUND" as const };
        if (header.status !== "draft") return { error: "NOT_DRAFT" as const };

        // Resolve COA ids for AR, AP, 4510, 5510
        const coaRows = await tx
          .select()
          .from(schema.chartOfAccounts)
          .where(eq(schema.chartOfAccounts.tenantId, ctx.tenantId));
        const arAccount = coaRows.find((a) => a.accountSubtype === "ar");
        const apAccount = coaRows.find((a) => a.accountSubtype === "ap");
        const gainAccount = coaRows.find((a) => a.code === "4510");
        const lossAccount = coaRows.find((a) => a.code === "5510");
        if (!arAccount || !apAccount || !gainAccount || !lossAccount) {
          return { error: "MISSING_ACCOUNTS" as const };
        }

        const arGain = header.arGainCents;
        const arLoss = header.arLossCents;
        const apGain = header.apGainCents;
        const apLoss = header.apLossCents;

        if (arGain === 0 && arLoss === 0 && apGain === 0 && apLoss === 0) {
          return { error: "NO_DELTA" as const };
        }

        // Build JE. Net per account — caller must balance.
        //   ar gain → DR AR, CR gain
        //   ar loss → DR loss, CR AR
        //   ap gain → DR AP, CR gain   (AP is a liability; reducing it = DR AP)
        //   ap loss → DR loss, CR AP
        const arDr = arGain;
        const arCr = arLoss;
        const apDr = apGain;
        const apCr = apLoss;
        const gainCr = arGain + apGain;
        const lossDr = arLoss + apLoss;

        const jLines: Parameters<typeof postJournal>[1]["lines"] = [];
        if (arDr > 0 || arCr > 0) {
          if (arDr > arCr) {
            jLines.push({
              accountId: arAccount.id,
              drCents: arDr - arCr,
              description: `FX reval · AR @ ${header.asOfDate}`,
            });
          } else if (arCr > arDr) {
            jLines.push({
              accountId: arAccount.id,
              crCents: arCr - arDr,
              description: `FX reval · AR @ ${header.asOfDate}`,
            });
          }
        }
        if (apDr > 0 || apCr > 0) {
          if (apDr > apCr) {
            jLines.push({
              accountId: apAccount.id,
              drCents: apDr - apCr,
              description: `FX reval · AP @ ${header.asOfDate}`,
            });
          } else if (apCr > apDr) {
            jLines.push({
              accountId: apAccount.id,
              crCents: apCr - apDr,
              description: `FX reval · AP @ ${header.asOfDate}`,
            });
          }
        }
        if (gainCr > 0) {
          jLines.push({
            accountId: gainAccount.id,
            crCents: gainCr,
            description: `Unrealized FX gain @ ${header.asOfDate}`,
          });
        }
        if (lossDr > 0) {
          jLines.push({
            accountId: lossAccount.id,
            drCents: lossDr,
            description: `Unrealized FX loss @ ${header.asOfDate}`,
          });
        }
        if (jLines.length < 2) return { error: "UNBALANCED" as const };

        const { entryId, entryNumber } = await postJournal(tx, {
          tenantId: ctx.tenantId,
          entryDate: header.asOfDate,
          memo: `FX revaluation @ ${header.asOfDate}`,
          sourceType: "fx_revaluation",
          sourceId: header.id,
          postedByUserId: ctx.userId,
          lines: jLines,
        });

        await tx
          .update(schema.fxRevaluations)
          .set({
            status: "posted",
            journalEntryId: entryId,
            postedAt: new Date(),
            postedByUserId: ctx.userId,
          })
          .where(eq(schema.fxRevaluations.id, header.id));

        return { ok: true as const, entryId, entryNumber };
      });

      if ("error" in result && result.error) {
        const code: string = result.error;
        const info: Record<string, { status: number; message: string }> = {
          NOT_FOUND: { status: 404, message: "Revaluation run not found." },
          NOT_DRAFT: { status: 409, message: "Only draft runs can be posted." },
          MISSING_ACCOUNTS: {
            status: 500,
            message: "Missing one of: AR (1100), AP (2000), 4510, 5510.",
          },
          NO_DELTA: {
            status: 400,
            message: "No incremental delta to post (nothing would change).",
          },
          UNBALANCED: {
            status: 500,
            message: "Could not construct a balanced journal entry.",
          },
        };
        const entry = info[code] ?? { status: 500, message: code };
        return reply
          .status(entry.status)
          .send({ error: { code, message: entry.message } });
      }

      return reply.send({ journalEntryId: result.entryId, entryNumber: result.entryNumber });
    } catch (err: unknown) {
      if (err instanceof Error && (err as Error & { code?: string }).code === "PERIOD_LOCKED") {
        return reply.status(409).send({
          error: { code: "PERIOD_LOCKED", message: err.message },
        });
      }
      throw err;
    }
  });

  // POST /:id/void — reverse the JE. Lines' cumulative baselines stop
  // counting (the query in computeDraftLines filters `status='posted'`), so
  // the next run recomputes against the last still-posted baseline.
  fastify.post<{ Params: { id: string }; Body: { reason?: string; reversalDate?: string } }>(
    "/:id/void",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "accounting.manage");
      if (!ctx) return;

      const reason = req.body?.reason?.slice(0, 1000) ?? null;

      try {
        const result = await withTenant(ctx.tenantId, async (tx) => {
          const headerRows = await tx
            .select()
            .from(schema.fxRevaluations)
            .where(
              and(
                eq(schema.fxRevaluations.tenantId, ctx.tenantId),
                eq(schema.fxRevaluations.id, req.params.id),
              ),
            )
            .limit(1);
          const header = headerRows[0];
          if (!header) return { error: "NOT_FOUND" as const };
          if (header.status !== "posted") return { error: "NOT_POSTED" as const };
          if (!header.journalEntryId) return { error: "NO_JE" as const };

          const reversalDate =
            req.body?.reversalDate && /^\d{4}-\d{2}-\d{2}$/.test(req.body.reversalDate)
              ? req.body.reversalDate
              : header.asOfDate;

          const { entryId, entryNumber } = await postReversingJournal(tx, {
            tenantId: ctx.tenantId,
            sourceEntryId: header.journalEntryId,
            reversalDate,
            memo: `Void FX revaluation @ ${header.asOfDate}`,
            sourceType: "fx_revaluation_void",
            sourceId: header.id,
            postedByUserId: ctx.userId,
          });

          await tx
            .update(schema.fxRevaluations)
            .set({
              status: "voided",
              voidJournalEntryId: entryId,
              voidedAt: new Date(),
              voidedByUserId: ctx.userId,
              voidReason: reason,
            })
            .where(eq(schema.fxRevaluations.id, header.id));

          return { ok: true as const, entryId, entryNumber };
        });

        if ("error" in result && result.error) {
          const code: string = result.error;
          const info: Record<string, number> = {
            NOT_FOUND: 404,
            NOT_POSTED: 409,
            NO_JE: 500,
          };
          const status = info[code] ?? 500;
          return reply.status(status).send({ error: { code } });
        }
        return reply.send({ voidJournalEntryId: result.entryId, entryNumber: result.entryNumber });
      } catch (err: unknown) {
        if (err instanceof Error && (err as Error & { code?: string }).code === "PERIOD_LOCKED") {
          return reply.status(409).send({
            error: { code: "PERIOD_LOCKED", message: err.message },
          });
        }
        throw err;
      }
    },
  );

  // DELETE /:id — only for draft runs. Posted / voided stay as audit.
  fastify.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "accounting.manage");
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.fxRevaluations)
        .where(
          and(
            eq(schema.fxRevaluations.tenantId, ctx.tenantId),
            eq(schema.fxRevaluations.id, req.params.id),
          ),
        )
        .limit(1);
      const h = rows[0];
      if (!h) return "NOT_FOUND" as const;
      if (h.status !== "draft") return "NOT_DRAFT" as const;

      await tx.delete(schema.fxRevaluations).where(eq(schema.fxRevaluations.id, h.id));
      return "OK" as const;
    });

    if (result === "NOT_FOUND") return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    if (result === "NOT_DRAFT")
      return reply
        .status(409)
        .send({ error: { code: "NOT_DRAFT", message: "Only draft runs can be deleted." } });
    return reply.status(204).send();
  });
};
