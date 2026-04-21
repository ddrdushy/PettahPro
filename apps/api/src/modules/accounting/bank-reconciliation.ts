import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

// ──────────────────────────────────────────────────────────────────────────────
// CSV parsing — permissive header mapping for typical SL bank exports
// ──────────────────────────────────────────────────────────────────────────────

interface ParsedLine {
  date: string;          // YYYY-MM-DD
  description: string;
  amountCents: number;   // signed: +inflow, -outflow
  reference: string | null;
}

// Column aliases we'll try, in order. Case-insensitive match on header text.
const DATE_HEADERS = ["date", "transaction date", "txn date", "posting date", "value date"];
const DESC_HEADERS = ["description", "narration", "particulars", "details", "memo", "remarks"];
const DEBIT_HEADERS = ["debit", "withdrawal", "debit amount", "dr", "out"];
const CREDIT_HEADERS = ["credit", "deposit", "credit amount", "cr", "in"];
const AMOUNT_HEADERS = ["amount", "amount (lkr)", "amount lkr", "value"];
const REF_HEADERS = ["reference", "ref", "cheque no", "cheque number", "txn ref"];

function parseCsvRow(line: string): string[] {
  // Minimal CSV: handles quoted fields (with embedded commas) and escaped
  // quotes (\"\"). Doesn't handle newlines inside quotes — that's a rare
  // case in bank CSVs, can be added if needed.
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === ",") {
        out.push(cur);
        cur = "";
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  // Accept YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
  return null;
}

function parseMoney(raw: string): number {
  // Strip commas, spaces. Empty → 0.
  const s = raw.replace(/[,\s]/g, "");
  if (!s) return 0;
  const v = Number(s);
  return Number.isFinite(v) ? Math.round(v * 100) : 0;
}

function parseCsvStatement(csv: string): { lines: ParsedLine[]; issues: string[] } {
  const issues: string[] = [];
  const rows = csv
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  if (rows.length < 2) {
    issues.push("CSV is empty or missing a header row.");
    return { lines: [], issues };
  }

  const header = parseCsvRow(rows[0]!).map((h) => h.toLowerCase());
  const findCol = (names: string[]) =>
    header.findIndex((h) => names.includes(h));

  const dateIdx = findCol(DATE_HEADERS);
  const descIdx = findCol(DESC_HEADERS);
  const debitIdx = findCol(DEBIT_HEADERS);
  const creditIdx = findCol(CREDIT_HEADERS);
  const amountIdx = findCol(AMOUNT_HEADERS);
  const refIdx = findCol(REF_HEADERS);

  if (dateIdx === -1) issues.push(`Couldn't find a date column. Tried: ${DATE_HEADERS.join(", ")}.`);
  if (descIdx === -1) issues.push(`Couldn't find a description column. Tried: ${DESC_HEADERS.join(", ")}.`);
  if (debitIdx === -1 && creditIdx === -1 && amountIdx === -1) {
    issues.push(
      `Couldn't find an amount column. Accept either a single "Amount" column (signed) or separate "Debit"/"Credit" columns.`,
    );
  }
  if (issues.length > 0) return { lines: [], issues };

  const lines: ParsedLine[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cols = parseCsvRow(rows[i]!);
    const rawDate = cols[dateIdx] ?? "";
    const date = normalizeDate(rawDate);
    if (!date) {
      issues.push(`Row ${i + 1}: couldn't parse date "${rawDate}".`);
      continue;
    }
    const description = (cols[descIdx] ?? "").slice(0, 500) || "(no description)";

    let amountCents = 0;
    if (amountIdx !== -1) {
      amountCents = parseMoney(cols[amountIdx] ?? "");
    } else {
      const debit = debitIdx !== -1 ? parseMoney(cols[debitIdx] ?? "") : 0;
      const credit = creditIdx !== -1 ? parseMoney(cols[creditIdx] ?? "") : 0;
      // Bank statement convention: credit = money in (inflow, +),
      //                           debit  = money out (outflow, -)
      amountCents = credit - debit;
    }
    if (amountCents === 0) {
      issues.push(`Row ${i + 1}: amount parsed as 0, skipping.`);
      continue;
    }

    const reference = refIdx !== -1 ? (cols[refIdx] ?? "").slice(0, 128) || null : null;

    lines.push({ date, description, amountCents, reference });
  }

  return { lines, issues };
}

// ──────────────────────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────────────────────

const CreateImportSchema = z.object({
  bankAccountId: z.string().uuid(),
  statementFromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  statementToDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  openingBalanceCents: z.number().int().optional(),
  closingBalanceCents: z.number().int().optional(),
  notes: z.string().optional().or(z.literal("")),
  csv: z.string().min(10),
});

const ManualMatchSchema = z.object({
  matchedRefType: z.enum(["customer_payment", "supplier_payment", "cheque", "manual"]),
  matchedRefId: z.string().uuid().optional(),
  matchNotes: z.string().trim().max(500).optional().or(z.literal("")),
});

const DATE_WINDOW_DAYS = 3;

export const bankReconciliationRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /bank-reconciliation/imports
  fastify.get("/imports", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select({
          id: schema.bankStatementImports.id,
          bankAccountId: schema.bankStatementImports.bankAccountId,
          bankAccountCode: schema.chartOfAccounts.code,
          bankAccountName: schema.chartOfAccounts.name,
          statementFromDate: schema.bankStatementImports.statementFromDate,
          statementToDate: schema.bankStatementImports.statementToDate,
          openingBalanceCents: schema.bankStatementImports.openingBalanceCents,
          closingBalanceCents: schema.bankStatementImports.closingBalanceCents,
          totalLines: schema.bankStatementImports.totalLines,
          matchedLines: schema.bankStatementImports.matchedLines,
          status: schema.bankStatementImports.status,
          reconciledAt: schema.bankStatementImports.reconciledAt,
          createdAt: schema.bankStatementImports.createdAt,
        })
        .from(schema.bankStatementImports)
        .innerJoin(
          schema.chartOfAccounts,
          eq(schema.chartOfAccounts.id, schema.bankStatementImports.bankAccountId),
        )
        .where(eq(schema.bankStatementImports.tenantId, ctx.tenantId))
        .orderBy(desc(schema.bankStatementImports.createdAt))
        .limit(100),
    );
    return reply.send({ imports: rows });
  });

  // GET /bank-reconciliation/imports/:id — header + lines
  fastify.get<{ Params: { id: string } }>("/imports/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const [imp] = await tx
        .select()
        .from(schema.bankStatementImports)
        .where(
          and(
            eq(schema.bankStatementImports.tenantId, ctx.tenantId),
            eq(schema.bankStatementImports.id, req.params.id),
          ),
        )
        .limit(1);
      if (!imp) return null;

      const [bank] = await tx
        .select()
        .from(schema.chartOfAccounts)
        .where(
          and(
            eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
            eq(schema.chartOfAccounts.id, imp.bankAccountId),
          ),
        )
        .limit(1);

      const lines = await tx
        .select()
        .from(schema.bankStatementLines)
        .where(
          and(
            eq(schema.bankStatementLines.tenantId, ctx.tenantId),
            eq(schema.bankStatementLines.importId, imp.id),
          ),
        )
        .orderBy(asc(schema.bankStatementLines.lineNo));

      return { import: imp, bank: bank ?? null, lines };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  // POST /bank-reconciliation/imports — paste CSV + bank account + period
  fastify.post("/imports", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CreateImportSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const body = parsed.data;

    const parsedCsv = parseCsvStatement(body.csv);
    if (parsedCsv.lines.length === 0) {
      return reply
        .status(400)
        .send({ error: { code: "CSV_PARSE_FAILED", message: parsedCsv.issues.join(" ") || "No usable rows." } });
    }

    const result = await withTenant(ctx.tenantId, async (tx) => {
      // Verify the bank account exists and is a cash/bank subtype.
      const [bank] = await tx
        .select()
        .from(schema.chartOfAccounts)
        .where(
          and(
            eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
            eq(schema.chartOfAccounts.id, body.bankAccountId),
            isNull(schema.chartOfAccounts.deletedAt),
          ),
        )
        .limit(1);
      if (!bank) return { error: "BANK_NOT_FOUND" as const };
      if (bank.accountType !== "asset" || !["cash", "bank"].includes(bank.accountSubtype ?? "")) {
        return { error: "INVALID_BANK_ACCOUNT" as const };
      }

      const [imp] = await tx
        .insert(schema.bankStatementImports)
        .values({
          tenantId: ctx.tenantId,
          bankAccountId: body.bankAccountId,
          statementFromDate: body.statementFromDate,
          statementToDate: body.statementToDate,
          openingBalanceCents: body.openingBalanceCents ?? null,
          closingBalanceCents: body.closingBalanceCents ?? null,
          totalLines: parsedCsv.lines.length,
          matchedLines: 0,
          status: "pending",
          notes: body.notes?.trim() || null,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!imp) return { error: "INSERT_FAILED" as const };

      await tx.insert(schema.bankStatementLines).values(
        parsedCsv.lines.map((l, idx) => ({
          tenantId: ctx.tenantId,
          importId: imp.id,
          lineNo: idx + 1,
          transactionDate: l.date,
          description: l.description,
          amountCents: l.amountCents,
          reference: l.reference,
          matchStatus: "unmatched" as const,
        })),
      );

      return { import: imp, issues: parsedCsv.issues };
    });

    if ("error" in result) {
      const msgs: Record<string, string> = {
        BANK_NOT_FOUND: "Bank account not found.",
        INVALID_BANK_ACCOUNT: "Selected account isn't a cash/bank subtype.",
        INSERT_FAILED: "Couldn't save the import.",
      };
      const code = result.error as string;
      return reply
        .status(code === "INSERT_FAILED" ? 500 : 400)
        .send({ error: { code, message: msgs[code] ?? code } });
    }
    return reply.status(201).send(result);
  });

  // POST /bank-reconciliation/imports/:id/auto-match
  // Matches each unmatched line against posted payments + cheques for the
  // same bank account, within ±DATE_WINDOW_DAYS days and exact amount.
  // Uniquely-matched lines flip to 'matched'; multi-candidate lines flip
  // to 'multiple_candidates' so the user resolves manually.
  fastify.post<{ Params: { id: string } }>("/imports/:id/auto-match", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [imp] = await tx
        .select()
        .from(schema.bankStatementImports)
        .where(
          and(
            eq(schema.bankStatementImports.tenantId, ctx.tenantId),
            eq(schema.bankStatementImports.id, req.params.id),
          ),
        )
        .limit(1);
      if (!imp) return { error: "NOT_FOUND" as const };
      if (imp.status === "reconciled") return { error: "ALREADY_RECONCILED" as const };

      // Candidate sources:
      //  1. Posted customer_payments with method != cheque — bank credits
      //     (money in) for this account, matched by payment_date.
      //  2. Posted supplier_payments with method != cheque — bank debits
      //     (money out) for this account, matched by payment_date.
      //  3. CLEARED cheques on this account — matched by cleared_at
      //     (the date the bank actually moved money), not by payment_date.
      //     This is the fix for the "cheque in transit/clearing" gap: a
      //     cheque posts to a clearing account at issue/receipt and only
      //     hits the real bank account when it clears.
      //
      // Non-cheque payments are filtered at the payments side so cheques
      // aren't double-counted (once via their payment row, once via the
      // cheques table).
      const custPayments = await tx.execute(sql`
        SELECT id, payment_date::text AS d, amount_cents, reference, method,
               (SELECT name FROM customers WHERE id = customer_payments.customer_id) AS party
        FROM customer_payments
        WHERE tenant_id = current_tenant_id()
          AND bank_account_id = ${imp.bankAccountId}::uuid
          AND status = 'posted'
          AND method <> 'cheque'
          AND deleted_at IS NULL
          AND payment_date BETWEEN
              (${imp.statementFromDate}::date - INTERVAL '${sql.raw(String(DATE_WINDOW_DAYS))} days') AND
              (${imp.statementToDate}::date + INTERVAL '${sql.raw(String(DATE_WINDOW_DAYS))} days')
      `);
      const supPayments = await tx.execute(sql`
        SELECT id, payment_date::text AS d, amount_cents, reference, method,
               (SELECT name FROM suppliers WHERE id = supplier_payments.supplier_id) AS party
        FROM supplier_payments
        WHERE tenant_id = current_tenant_id()
          AND bank_account_id = ${imp.bankAccountId}::uuid
          AND status = 'posted'
          AND method <> 'cheque'
          AND deleted_at IS NULL
          AND payment_date BETWEEN
              (${imp.statementFromDate}::date - INTERVAL '${sql.raw(String(DATE_WINDOW_DAYS))} days') AND
              (${imp.statementToDate}::date + INTERVAL '${sql.raw(String(DATE_WINDOW_DAYS))} days')
      `);
      const clearedCheques = await tx.execute(sql`
        SELECT c.id,
               c.cleared_at::date::text AS d,
               c.amount_cents,
               c.cheque_number,
               c.direction,
               COALESCE(
                 (SELECT name FROM customers WHERE id = c.customer_id),
                 (SELECT name FROM suppliers WHERE id = c.supplier_id),
                 c.other_party_name
               ) AS party
        FROM cheques c
        WHERE c.tenant_id = current_tenant_id()
          AND c.bank_account_id = ${imp.bankAccountId}::uuid
          AND c.status = 'cleared'
          AND c.cleared_at IS NOT NULL
          AND c.cleared_at::date BETWEEN
              (${imp.statementFromDate}::date - INTERVAL '${sql.raw(String(DATE_WINDOW_DAYS))} days') AND
              (${imp.statementToDate}::date + INTERVAL '${sql.raw(String(DATE_WINDOW_DAYS))} days')
      `);

      interface Candidate {
        refType: "customer_payment" | "supplier_payment" | "cheque";
        refId: string;
        date: string;
        amountCents: number; // signed: customer payments + received cheques are inflows, supplier payments + issued cheques outflows
        reference: string | null;
        party: string | null;
      }

      const alreadyUsed = new Set<string>();

      // Collect already-matched payment IDs from previous runs so we don't
      // double-assign them to a second statement line.
      const existing = await tx
        .select({
          refType: schema.bankStatementLines.matchedRefType,
          refId: schema.bankStatementLines.matchedRefId,
        })
        .from(schema.bankStatementLines)
        .where(
          and(
            eq(schema.bankStatementLines.tenantId, ctx.tenantId),
            eq(schema.bankStatementLines.matchStatus, "matched"),
          ),
        );
      for (const e of existing) {
        if (e.refType && e.refId) alreadyUsed.add(`${e.refType}:${e.refId}`);
      }

      const candidates: Candidate[] = [];
      for (const p of custPayments as unknown as Array<{ id: string; d: string; amount_cents: number | string; reference: string | null; method: string; party: string | null }>) {
        const key = `customer_payment:${p.id}`;
        if (alreadyUsed.has(key)) continue;
        candidates.push({
          refType: "customer_payment",
          refId: p.id,
          date: p.d,
          amountCents: Number(p.amount_cents),
          reference: p.reference,
          party: p.party,
        });
      }
      for (const p of supPayments as unknown as Array<{ id: string; d: string; amount_cents: number | string; reference: string | null; method: string; party: string | null }>) {
        const key = `supplier_payment:${p.id}`;
        if (alreadyUsed.has(key)) continue;
        candidates.push({
          refType: "supplier_payment",
          refId: p.id,
          date: p.d,
          amountCents: -Number(p.amount_cents), // outflow
          reference: p.reference,
          party: p.party,
        });
      }
      for (const c of clearedCheques as unknown as Array<{
        id: string;
        d: string;
        amount_cents: number | string;
        cheque_number: string;
        direction: string;
        party: string | null;
      }>) {
        const key = `cheque:${c.id}`;
        if (alreadyUsed.has(key)) continue;
        // Received cheques clear as bank inflows (+). Issued cheques
        // clear as outflows (−).
        const sign = c.direction === "received" ? 1 : -1;
        candidates.push({
          refType: "cheque",
          refId: c.id,
          date: c.d,
          amountCents: sign * Number(c.amount_cents),
          reference: c.cheque_number,
          party: c.party,
        });
      }

      // Pull all unmatched lines for this import.
      const unmatched = await tx
        .select()
        .from(schema.bankStatementLines)
        .where(
          and(
            eq(schema.bankStatementLines.tenantId, ctx.tenantId),
            eq(schema.bankStatementLines.importId, imp.id),
            eq(schema.bankStatementLines.matchStatus, "unmatched"),
          ),
        );

      let matchedCount = 0;
      let multipleCount = 0;

      for (const line of unmatched) {
        const windowMs = DATE_WINDOW_DAYS * 86_400_000;
        const lineTime = new Date(line.transactionDate).getTime();
        const hits = candidates.filter((c) => {
          if (c.amountCents !== line.amountCents) return false;
          if (alreadyUsed.has(`${c.refType}:${c.refId}`)) return false;
          const diff = Math.abs(new Date(c.date).getTime() - lineTime);
          return diff <= windowMs;
        });

        if (hits.length === 1) {
          const m = hits[0]!;
          await tx
            .update(schema.bankStatementLines)
            .set({
              matchStatus: "matched",
              matchedRefType: m.refType,
              matchedRefId: m.refId,
              matchedAt: new Date(),
              matchedByUserId: ctx.userId,
              matchNotes: m.party ? `Auto-matched · ${m.party}` : "Auto-matched",
            })
            .where(eq(schema.bankStatementLines.id, line.id));
          alreadyUsed.add(`${m.refType}:${m.refId}`);
          matchedCount++;
        } else if (hits.length > 1) {
          await tx
            .update(schema.bankStatementLines)
            .set({
              matchStatus: "multiple_candidates",
              matchNotes: `${hits.length} possible matches — review manually.`,
            })
            .where(eq(schema.bankStatementLines.id, line.id));
          multipleCount++;
        }
      }

      const [counts] = await tx.execute(sql`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE match_status = 'matched')::int AS matched
        FROM bank_statement_lines
        WHERE import_id = ${imp.id}::uuid
      `) as unknown as Array<{ total: number; matched: number }>;

      await tx
        .update(schema.bankStatementImports)
        .set({
          totalLines: counts?.total ?? 0,
          matchedLines: counts?.matched ?? 0,
          updatedAt: new Date(),
        })
        .where(eq(schema.bankStatementImports.id, imp.id));

      return {
        autoMatched: matchedCount,
        multipleCandidates: multipleCount,
        totalLines: counts?.total ?? 0,
        matchedLines: counts?.matched ?? 0,
      };
    });

    if ("error" in result) {
      const code = result.error as string;
      return reply
        .status(code === "NOT_FOUND" ? 404 : 400)
        .send({ error: { code } });
    }
    return reply.send({ ok: true, ...result });
  });

  // POST /bank-reconciliation/lines/:id/match — manual match
  fastify.post<{ Params: { id: string } }>("/lines/:id/match", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = ManualMatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const body = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [line] = await tx
        .select()
        .from(schema.bankStatementLines)
        .where(
          and(
            eq(schema.bankStatementLines.tenantId, ctx.tenantId),
            eq(schema.bankStatementLines.id, req.params.id),
          ),
        )
        .limit(1);
      if (!line) return { error: "NOT_FOUND" as const };

      await tx
        .update(schema.bankStatementLines)
        .set({
          matchStatus: "matched",
          matchedRefType: body.matchedRefType,
          matchedRefId: body.matchedRefId ?? null,
          matchNotes: body.matchNotes?.trim() || null,
          matchedAt: new Date(),
          matchedByUserId: ctx.userId,
        })
        .where(eq(schema.bankStatementLines.id, line.id));

      // Recompute counts on the parent import.
      const [counts] = await tx.execute(sql`
        SELECT COUNT(*) FILTER (WHERE match_status = 'matched')::int AS matched
        FROM bank_statement_lines
        WHERE import_id = ${line.importId}::uuid
      `) as unknown as Array<{ matched: number }>;

      await tx
        .update(schema.bankStatementImports)
        .set({ matchedLines: counts?.matched ?? 0, updatedAt: new Date() })
        .where(eq(schema.bankStatementImports.id, line.importId));

      return {};
    });

    if ("error" in result) {
      const code = result.error as string;
      return reply.status(code === "NOT_FOUND" ? 404 : 400).send({ error: { code } });
    }
    return reply.send({ ok: true });
  });

  // POST /bank-reconciliation/lines/:id/unmatch
  fastify.post<{ Params: { id: string } }>("/lines/:id/unmatch", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [line] = await tx
        .select()
        .from(schema.bankStatementLines)
        .where(
          and(
            eq(schema.bankStatementLines.tenantId, ctx.tenantId),
            eq(schema.bankStatementLines.id, req.params.id),
          ),
        )
        .limit(1);
      if (!line) return { error: "NOT_FOUND" as const };

      await tx
        .update(schema.bankStatementLines)
        .set({
          matchStatus: "unmatched",
          matchedRefType: null,
          matchedRefId: null,
          matchNotes: null,
          matchedAt: null,
          matchedByUserId: null,
        })
        .where(eq(schema.bankStatementLines.id, line.id));

      const [counts] = await tx.execute(sql`
        SELECT COUNT(*) FILTER (WHERE match_status = 'matched')::int AS matched
        FROM bank_statement_lines
        WHERE import_id = ${line.importId}::uuid
      `) as unknown as Array<{ matched: number }>;

      await tx
        .update(schema.bankStatementImports)
        .set({ matchedLines: counts?.matched ?? 0, updatedAt: new Date() })
        .where(eq(schema.bankStatementImports.id, line.importId));

      return {};
    });

    if ("error" in result) {
      const code = result.error as string;
      return reply.status(code === "NOT_FOUND" ? 404 : 400).send({ error: { code } });
    }
    return reply.send({ ok: true });
  });

  // POST /bank-reconciliation/imports/:id/reconcile — lock as reconciled.
  // Doesn't force every line to be matched — user may legitimately ignore
  // some (fees, transfers posted separately). We flag "X of Y unmatched".
  fastify.post<{ Params: { id: string } }>("/imports/:id/reconcile", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [imp] = await tx
        .select()
        .from(schema.bankStatementImports)
        .where(
          and(
            eq(schema.bankStatementImports.tenantId, ctx.tenantId),
            eq(schema.bankStatementImports.id, req.params.id),
          ),
        )
        .limit(1);
      if (!imp) return { error: "NOT_FOUND" as const };
      if (imp.status === "reconciled") return { error: "ALREADY_RECONCILED" as const };

      const now = new Date();
      await tx
        .update(schema.bankStatementImports)
        .set({
          status: "reconciled",
          reconciledAt: now,
          reconciledByUserId: ctx.userId,
          updatedAt: now,
        })
        .where(eq(schema.bankStatementImports.id, imp.id));
      return {};
    });

    if ("error" in result) {
      const code = result.error as string;
      return reply.status(code === "NOT_FOUND" ? 404 : 400).send({ error: { code } });
    }
    return reply.send({ ok: true });
  });
};
