import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

// Supplier statement reconciliation — roadmap #20 (buy §13.2).
//
// Sri Lankan SMEs regularly get month-end statements from their biggest
// suppliers (typically a PDF or printed page). They want to confirm that
// our AP ledger lines up with what the supplier thinks is outstanding.
//
// v1 is a pure comparison engine: caller pastes a normalized CSV of the
// supplier's open items (bill reference + amount), server returns the
// match/mismatch analysis. We do NOT auto-create missing bills or
// auto-post anything — the accountant reconciles manually from the
// result, which is the safer default for a first release.
//
// Matching strategy (in order of precedence):
//   1. Exact match on supplier_bill_number + balance amount → `matched`
//   2. Exact supplier_bill_number, different amount            → `amount_mismatch`
//   3. Our bill present but not in their statement             → `only_in_ours`
//   4. Their row has no supplier_bill_number in our bills      → `only_in_theirs`
//
// Normalization: supplier_bill_number is matched case-insensitively and
// with whitespace trimmed. Amounts are compared with a 1-cent tolerance
// to tolerate banker's rounding in the supplier's spreadsheet.

const RowSchema = z.object({
  reference: z.string().trim().min(1).max(64),
  // Foreign amount expressed in rupees (float), or integer cents — we
  // accept the rupee form from the UI and convert. Keeps the CSV-paste
  // UX natural (supplier sends "12,345.00", user splits to "12345.00").
  amount: z.number().nonnegative(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const ReconcileSchema = z.object({
  rows: z.array(RowSchema).min(1).max(500),
});

type MatchStatus = "matched" | "amount_mismatch" | "only_in_ours" | "only_in_theirs";

interface MatchResult {
  status: MatchStatus;
  reference: string;
  theirAmountCents: number | null;
  theirDate: string | null;
  ourBillId: string | null;
  ourBillNumber: string | null;
  ourInternalReference: string | null;
  ourBalanceCents: number | null;
  diffCents: number | null;
}

function normalize(ref: string): string {
  return ref.trim().toLowerCase();
}

export const supplierReconcileRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /suppliers/:id/reconcile
  fastify.post<{ Params: { id: string } }>("/:id/reconcile", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = ReconcileSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const input = parsed.data;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const [supplier] = await tx
        .select({ id: schema.suppliers.id, name: schema.suppliers.name })
        .from(schema.suppliers)
        .where(
          and(
            eq(schema.suppliers.tenantId, ctx.tenantId),
            eq(schema.suppliers.id, req.params.id),
            isNull(schema.suppliers.deletedAt),
          ),
        )
        .limit(1);
      if (!supplier) return null;

      // Open bills = posted or partially paid, with a remaining balance.
      // draft/void bills aren't part of the supplier's statement view.
      const ourBills = await tx
        .select({
          id: schema.bills.id,
          supplierBillNumber: schema.bills.supplierBillNumber,
          internalReference: schema.bills.internalReference,
          billDate: schema.bills.billDate,
          totalCents: schema.bills.totalCents,
          balanceDueCents: schema.bills.balanceDueCents,
          status: schema.bills.status,
        })
        .from(schema.bills)
        .where(
          and(
            eq(schema.bills.tenantId, ctx.tenantId),
            eq(schema.bills.supplierId, supplier.id),
            isNull(schema.bills.deletedAt),
            inArray(schema.bills.status, ["posted", "partially_paid"]),
          ),
        );

      // Index our bills by normalized supplierBillNumber; also keep a
      // secondary index on internalReference so users who didn't capture
      // the supplier's number still get partial matching when their CSV
      // row happens to carry OUR reference (common when the supplier's
      // "statement" is really our own PO number typed back).
      const byRef = new Map<string, typeof ourBills>();
      for (const b of ourBills) {
        for (const key of [b.supplierBillNumber, b.internalReference]) {
          if (!key) continue;
          const k = normalize(key);
          const arr = byRef.get(k);
          if (arr) arr.push(b);
          else byRef.set(k, [b]);
        }
      }

      const matchedOurIds = new Set<string>();
      const results: MatchResult[] = [];

      for (const row of input.rows) {
        const theirCents = Math.round(row.amount * 100);
        const key = normalize(row.reference);
        const candidates = byRef.get(key) ?? [];
        if (candidates.length === 0) {
          results.push({
            status: "only_in_theirs",
            reference: row.reference,
            theirAmountCents: theirCents,
            theirDate: row.date ?? null,
            ourBillId: null,
            ourBillNumber: null,
            ourInternalReference: null,
            ourBalanceCents: null,
            diffCents: null,
          });
          continue;
        }
        // Pick the first unmatched candidate — duplicates with identical
        // supplier_bill_numbers on our side are rare but possible.
        const bill = candidates.find((c) => !matchedOurIds.has(c.id)) ?? candidates[0]!;
        matchedOurIds.add(bill.id);
        const diff = theirCents - bill.balanceDueCents;
        const isMatch = Math.abs(diff) <= 1;
        results.push({
          status: isMatch ? "matched" : "amount_mismatch",
          reference: row.reference,
          theirAmountCents: theirCents,
          theirDate: row.date ?? null,
          ourBillId: bill.id,
          ourBillNumber: bill.supplierBillNumber,
          ourInternalReference: bill.internalReference,
          ourBalanceCents: bill.balanceDueCents,
          diffCents: diff,
        });
      }

      // Append bills present only on our side.
      for (const b of ourBills) {
        if (matchedOurIds.has(b.id)) continue;
        if (b.balanceDueCents <= 0) continue;
        results.push({
          status: "only_in_ours",
          reference: b.supplierBillNumber ?? b.internalReference ?? "(no ref)",
          theirAmountCents: null,
          theirDate: null,
          ourBillId: b.id,
          ourBillNumber: b.supplierBillNumber,
          ourInternalReference: b.internalReference,
          ourBalanceCents: b.balanceDueCents,
          diffCents: null,
        });
      }

      const theirTotalCents = input.rows.reduce(
        (s, r) => s + Math.round(r.amount * 100),
        0,
      );
      const ourTotalCents = ourBills.reduce((s, b) => s + b.balanceDueCents, 0);

      return {
        supplier: { id: supplier.id, name: supplier.name },
        summary: {
          theirTotalCents,
          ourTotalCents,
          diffCents: theirTotalCents - ourTotalCents,
          matched: results.filter((r) => r.status === "matched").length,
          amountMismatch: results.filter((r) => r.status === "amount_mismatch").length,
          onlyInOurs: results.filter((r) => r.status === "only_in_ours").length,
          onlyInTheirs: results.filter((r) => r.status === "only_in_theirs").length,
        },
        results,
      };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });
};
