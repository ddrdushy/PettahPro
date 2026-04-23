// Petty cash float module (roadmap #38).
//
// Routes the full petty cash lifecycle: open/close floats, record
// expenses and staff advances, request + approve + post top-ups, and
// EOD reconciliations that post variance to 5190 Cash Over/Short.
//
// Posting invariants — every mutating path here:
//   1. Posts exactly one JE via `postJournal` (void posts a reversing JE).
//   2. Updates `petty_cash_floats.current_balance_cents` atomically in the
//      same DB transaction. This column is the single source of truth for
//      per-float balance; if it drifts, GL total stays correct but per-float
//      ledger view lies. Tests should re-derive from petty_cash_transactions
//      to catch drift.
//   3. Writes an audit event through `recordAuditEvent`.
//
// Permission model (no approval engine for v1 — see spec notes):
//   · petty_cash.operate  — open float, post expense/advance/return,
//                           request top-up, record reconciliation.
//   · petty_cash.approve  — approve + post + reject top-ups, close
//                           float, void a transaction.
//
// SOD: a user cannot approve their own top-up request (enforced at
// approve time). Voids are gated on .approve specifically so a
// holder can't quietly undo their own expense row.

import type { FastifyPluginAsync } from "fastify";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { schema, withTenant } from "@pettahpro/db";
import { requirePermission } from "../../lib/permissions.js";
import { postJournal } from "./journal-posting.js";
import { postReversingJournal } from "./reversing-journal.js";
import { recordAuditEvent } from "../../lib/audit.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const OpenFloatSchema = z.object({
  branchId: z.string().uuid(),
  name: z.string().min(1).max(120),
  floatHolderUserId: z.string().uuid(),
  ceilingCents: z.number().int().min(0),
  // Optional seed top-up posted together with the open so the float
  // starts with cash. If omitted, balance opens at 0 and the holder
  // must request a top-up.
  seedAmountCents: z.number().int().min(0).optional(),
  seedSourceAccountId: z.string().uuid().optional(),
  notes: z.string().max(1000).optional().or(z.literal("")),
});

const PatchFloatSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  ceilingCents: z.number().int().min(0).optional(),
  notes: z.string().max(1000).optional().or(z.literal("")),
});

const CloseFloatSchema = z.object({
  // Where the remaining balance goes. If balance=0 this is optional.
  destinationAccountId: z.string().uuid().optional(),
  closeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(1000).optional().or(z.literal("")),
});

const ExpenseSchema = z.object({
  pettyCashFloatId: z.string().uuid(),
  amountCents: z.number().int().min(1),
  txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1).max(500),
  categoryAccountId: z.string().uuid(),
  receiptNumber: z.string().max(64).optional().or(z.literal("")),
});

const AdvanceOutSchema = z.object({
  pettyCashFloatId: z.string().uuid(),
  amountCents: z.number().int().min(1),
  txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1).max(500),
  staffAdvanceAccountId: z.string().uuid(),
  counterpartyEmployeeId: z.string().uuid(),
  receiptNumber: z.string().max(64).optional().or(z.literal("")),
});

const AdvanceReturnSchema = AdvanceOutSchema;

const VoidTxnSchema = z.object({
  reason: z.string().min(1).max(500),
  reversalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const CreateTopUpRequestSchema = z.object({
  pettyCashFloatId: z.string().uuid(),
  requestedAmountCents: z.number().int().min(1),
  reason: z.string().min(1).max(1000),
});

const DecideTopUpRequestSchema = z.object({
  decisionNotes: z.string().max(1000).optional().or(z.literal("")),
});

const PostTopUpRequestSchema = z.object({
  txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceAccountId: z.string().uuid(),
  // Allow posting an amount different from the requested amount in
  // case the approver decides to part-fund the request.
  amountCents: z.number().int().min(1).optional(),
});

const CreateReconciliationSchema = z.object({
  pettyCashFloatId: z.string().uuid(),
  reconDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  countedCents: z.number().int().min(0),
  varianceReason: z.string().max(1000).optional().or(z.literal("")),
  notes: z.string().max(1000).optional().or(z.literal("")),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Tx = Parameters<typeof postJournal>[0];

async function resolveCashOverShortAccount(tx: Tx, tenantId: string) {
  const rows = await tx
    .select()
    .from(schema.chartOfAccounts)
    .where(
      and(
        eq(schema.chartOfAccounts.tenantId, tenantId),
        eq(schema.chartOfAccounts.code, "5190"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function resolvePettyCashAccount(tx: Tx, tenantId: string) {
  const rows = await tx
    .select()
    .from(schema.chartOfAccounts)
    .where(
      and(
        eq(schema.chartOfAccounts.tenantId, tenantId),
        eq(schema.chartOfAccounts.code, "1005"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function getFloatForUpdate(
  tx: Tx,
  tenantId: string,
  floatId: string,
): Promise<typeof schema.pettyCashFloats.$inferSelect | null> {
  // SELECT ... FOR UPDATE so concurrent posts against the same float
  // serialise and the denormalised balance can't race.
  const rows = (await tx.execute(sql`
    SELECT * FROM petty_cash_floats
     WHERE tenant_id = ${tenantId}::uuid
       AND id = ${floatId}::uuid
     FOR UPDATE
  `)) as unknown as Array<typeof schema.pettyCashFloats.$inferSelect>;
  return rows[0] ?? null;
}

function bumpBalanceOrFail(
  currentCents: number,
  deltaCents: number,
  ceilingCents: number,
  opts: { enforceCeiling: boolean; allowNegative?: boolean },
): { ok: true; newBalance: number } | { ok: false; code: string } {
  const newBalance = currentCents + deltaCents;
  if (!opts.allowNegative && newBalance < 0) {
    return { ok: false, code: "INSUFFICIENT_BALANCE" };
  }
  if (opts.enforceCeiling && newBalance > ceilingCents) {
    return { ok: false, code: "CEILING_EXCEEDED" };
  }
  return { ok: true, newBalance };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const pettyCashRoutes: FastifyPluginAsync = async (fastify) => {
  // =========================================================================
  // FLOATS
  // =========================================================================

  // GET /petty-cash/floats — list all floats (active + closed) with summary
  fastify.get("/floats", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "petty_cash.operate");
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.pettyCashFloats)
        .where(
          and(
            eq(schema.pettyCashFloats.tenantId, ctx.tenantId),
            isNull(schema.pettyCashFloats.deletedAt),
          ),
        )
        .orderBy(desc(schema.pettyCashFloats.openedAt)),
    );
    return reply.send({ floats: rows });
  });

  // GET /petty-cash/floats/:id — float detail
  fastify.get<{ Params: { id: string } }>(
    "/floats/:id",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "petty_cash.operate");
      if (!ctx) return;

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.pettyCashFloats)
          .where(
            and(
              eq(schema.pettyCashFloats.tenantId, ctx.tenantId),
              eq(schema.pettyCashFloats.id, req.params.id),
            ),
          )
          .limit(1);
        return row ?? null;
      });
      if (!result) {
        return reply.status(404).send({ error: { code: "NOT_FOUND" } });
      }
      return reply.send({ float: result });
    },
  );

  // POST /petty-cash/floats — open a new float (optionally seed-top-up in same tx)
  fastify.post("/floats", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "petty_cash.operate");
    if (!ctx) return;

    const parsed = OpenFloatSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "INVALID_INPUT", issues: parsed.error.issues },
      });
    }
    const input = parsed.data;

    if (
      input.seedAmountCents !== undefined &&
      input.seedAmountCents > 0 &&
      !input.seedSourceAccountId
    ) {
      return reply.status(400).send({
        error: {
          code: "SEED_SOURCE_REQUIRED",
          message: "seedSourceAccountId is required when seedAmountCents > 0.",
        },
      });
    }

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const pettyCashAccount = await resolvePettyCashAccount(tx, ctx.tenantId);
      if (!pettyCashAccount) return { error: "NO_PETTY_CASH_ACCOUNT" as const };

      // One active float per branch — partial unique index also catches this
      // but a friendly 409 is nicer than a Postgres error bubble.
      const existing = await tx
        .select({ id: schema.pettyCashFloats.id })
        .from(schema.pettyCashFloats)
        .where(
          and(
            eq(schema.pettyCashFloats.tenantId, ctx.tenantId),
            eq(schema.pettyCashFloats.branchId, input.branchId),
            eq(schema.pettyCashFloats.status, "active"),
            isNull(schema.pettyCashFloats.deletedAt),
          ),
        )
        .limit(1);
      if (existing[0]) {
        return {
          error: "BRANCH_FLOAT_EXISTS" as const,
          floatId: existing[0].id,
        };
      }

      const [float] = await tx
        .insert(schema.pettyCashFloats)
        .values({
          tenantId: ctx.tenantId,
          branchId: input.branchId,
          name: input.name,
          floatHolderUserId: input.floatHolderUserId,
          ceilingCents: input.ceilingCents,
          pettyCashAccountId: pettyCashAccount.id,
          openedByUserId: ctx.userId,
          notes: input.notes || null,
        })
        .returning();
      if (!float) throw new Error("Float insert failed");

      // Optional seed top-up — posts a `top_up` txn in the same transaction.
      let seedTxnId: string | null = null;
      if (
        input.seedAmountCents !== undefined &&
        input.seedAmountCents > 0 &&
        input.seedSourceAccountId
      ) {
        const seedDate = new Date().toISOString().slice(0, 10);
        const { entryId, entryNumber } = await postJournal(tx, {
          tenantId: ctx.tenantId,
          entryDate: seedDate,
          memo: `Petty cash seed · ${float.name}`,
          sourceType: "petty_cash_float",
          sourceId: float.id,
          postedByUserId: ctx.userId,
          lines: [
            {
              accountId: pettyCashAccount.id,
              drCents: input.seedAmountCents,
              description: `Petty cash seed (${float.name})`,
            },
            {
              accountId: input.seedSourceAccountId,
              crCents: input.seedAmountCents,
              description: `Petty cash seed · source`,
            },
          ],
        });
        const [txn] = await tx
          .insert(schema.pettyCashTransactions)
          .values({
            tenantId: ctx.tenantId,
            pettyCashFloatId: float.id,
            txnType: "top_up",
            amountCents: input.seedAmountCents,
            txnDate: seedDate,
            description: `Seed top-up on open · ${entryNumber}`,
            counterpartyAccountId: input.seedSourceAccountId,
            journalEntryId: entryId,
            postedByUserId: ctx.userId,
          })
          .returning();
        seedTxnId = txn?.id ?? null;

        await tx
          .update(schema.pettyCashFloats)
          .set({
            currentBalanceCents: input.seedAmountCents,
            updatedAt: new Date(),
          })
          .where(eq(schema.pettyCashFloats.id, float.id));
        float.currentBalanceCents = input.seedAmountCents;
      }

      await recordAuditEvent(tx, {
        kind: "petty_cash_float.opened",
        summary: `Opened petty cash float "${float.name}"`,
        refType: "petty_cash_float",
        refId: float.id,
        diff: {
          branchId: input.branchId,
          ceilingCents: input.ceilingCents,
          floatHolderUserId: input.floatHolderUserId,
          seedTxnId,
        },
        actorUserId: ctx.userId,
      });

      return { ok: true as const, float };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        NO_PETTY_CASH_ACCOUNT: 500,
        BRANCH_FLOAT_EXISTS: 409,
      };
      const messages: Record<string, string> = {
        NO_PETTY_CASH_ACCOUNT:
          "The tenant is missing its 1005 Petty Cash account. Re-run migration 75.",
        BRANCH_FLOAT_EXISTS:
          "An active float already exists for this branch. Close it before opening a new one.",
      };
      const code = String(result.error);
      return reply.status(map[code] ?? 500).send({
        error: {
          code,
          message: messages[code],
          ...(result.error === "BRANCH_FLOAT_EXISTS" && "floatId" in result
            ? { floatId: result.floatId }
            : {}),
        },
      });
    }
    return reply.status(201).send({ float: result.float });
  });

  // PATCH /petty-cash/floats/:id — light edit (name / ceiling / notes)
  fastify.patch<{ Params: { id: string } }>(
    "/floats/:id",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "petty_cash.operate");
      if (!ctx) return;

      const parsed = PatchFloatSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "INVALID_INPUT", issues: parsed.error.issues },
        });
      }
      const input = parsed.data;

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const existing = await getFloatForUpdate(tx, ctx.tenantId, req.params.id);
        if (!existing) return { error: "NOT_FOUND" as const };
        if (existing.status !== "active") return { error: "NOT_ACTIVE" as const };

        const updates: Partial<typeof schema.pettyCashFloats.$inferInsert> = {
          updatedAt: new Date(),
        };
        if (input.name !== undefined) updates.name = input.name;
        if (input.ceilingCents !== undefined) updates.ceilingCents = input.ceilingCents;
        if (input.notes !== undefined) updates.notes = input.notes || null;

        const [updated] = await tx
          .update(schema.pettyCashFloats)
          .set(updates)
          .where(eq(schema.pettyCashFloats.id, existing.id))
          .returning();

        await recordAuditEvent(tx, {
          kind: "petty_cash_float.updated",
          summary: `Updated petty cash float "${existing.name}"`,
          refType: "petty_cash_float",
          refId: existing.id,
          diff: { before: existing, after: updated },
          actorUserId: ctx.userId,
        });

        return { ok: true as const, float: updated };
      });

      if ("error" in result) {
        const map: Record<string, number> = {
          NOT_FOUND: 404,
          NOT_ACTIVE: 409,
        };
        return reply
          .status(map[String(result.error)] ?? 500)
          .send({ error: { code: result.error } });
      }
      return reply.send({ float: result.float });
    },
  );

  // POST /petty-cash/floats/:id/close — close float, transfer remaining balance out
  fastify.post<{ Params: { id: string } }>(
    "/floats/:id/close",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "petty_cash.approve");
      if (!ctx) return;

      const parsed = CloseFloatSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "INVALID_INPUT", issues: parsed.error.issues },
        });
      }
      const input = parsed.data;

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const floatRow = await getFloatForUpdate(tx, ctx.tenantId, req.params.id);
        if (!floatRow) return { error: "NOT_FOUND" as const };
        if (floatRow.status !== "active") return { error: "NOT_ACTIVE" as const };

        // If balance > 0 we must transfer it back to a real cash/bank
        // account. If balance = 0, destinationAccountId is optional.
        if (floatRow.currentBalanceCents > 0 && !input.destinationAccountId) {
          return { error: "DEST_REQUIRED" as const };
        }
        // Balance < 0 should be impossible — guard anyway.
        if (floatRow.currentBalanceCents < 0) {
          return { error: "NEGATIVE_BALANCE" as const };
        }

        let closeTxnId: string | null = null;
        if (floatRow.currentBalanceCents > 0 && input.destinationAccountId) {
          const { entryId, entryNumber } = await postJournal(tx, {
            tenantId: ctx.tenantId,
            entryDate: input.closeDate,
            memo: `Petty cash close · ${floatRow.name}`,
            sourceType: "petty_cash_float",
            sourceId: floatRow.id,
            postedByUserId: ctx.userId,
            lines: [
              {
                accountId: input.destinationAccountId,
                drCents: floatRow.currentBalanceCents,
                description: `Petty cash close · transfer out`,
              },
              {
                accountId: floatRow.pettyCashAccountId,
                crCents: floatRow.currentBalanceCents,
                description: `Petty cash close (${floatRow.name})`,
              },
            ],
          });
          const [txn] = await tx
            .insert(schema.pettyCashTransactions)
            .values({
              tenantId: ctx.tenantId,
              pettyCashFloatId: floatRow.id,
              txnType: "close_transfer",
              amountCents: floatRow.currentBalanceCents,
              txnDate: input.closeDate,
              description: `Close transfer · ${entryNumber}`,
              counterpartyAccountId: input.destinationAccountId,
              journalEntryId: entryId,
              postedByUserId: ctx.userId,
            })
            .returning();
          closeTxnId = txn?.id ?? null;
        }

        const [updated] = await tx
          .update(schema.pettyCashFloats)
          .set({
            status: "closed",
            currentBalanceCents: 0,
            closedAt: new Date(),
            closedByUserId: ctx.userId,
            closedReason: input.reason || null,
            updatedAt: new Date(),
          })
          .where(eq(schema.pettyCashFloats.id, floatRow.id))
          .returning();

        await recordAuditEvent(tx, {
          kind: "petty_cash_float.closed",
          summary: `Closed petty cash float "${floatRow.name}"`,
          refType: "petty_cash_float",
          refId: floatRow.id,
          diff: {
            closedBalanceTransferredCents: floatRow.currentBalanceCents,
            destinationAccountId: input.destinationAccountId ?? null,
            closeTxnId,
            reason: input.reason || null,
          },
          actorUserId: ctx.userId,
        });

        return { ok: true as const, float: updated };
      });

      if ("error" in result) {
        const map: Record<string, number> = {
          NOT_FOUND: 404,
          NOT_ACTIVE: 409,
          DEST_REQUIRED: 400,
          NEGATIVE_BALANCE: 500,
        };
        const messages: Record<string, string> = {
          DEST_REQUIRED:
            "destinationAccountId is required to close a float with a non-zero balance.",
          NEGATIVE_BALANCE:
            "Float balance is negative — reconcile before closing.",
          NOT_ACTIVE: "This float is already closed.",
        };
        return reply.status(map[String(result.error)] ?? 500).send({
          error: { code: result.error, message: messages[String(result.error)] },
        });
      }
      return reply.send({ float: result.float });
    },
  );

  // =========================================================================
  // TRANSACTIONS
  // =========================================================================

  // GET /petty-cash/floats/:id/transactions — float ledger view
  fastify.get<{ Params: { id: string } }>(
    "/floats/:id/transactions",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "petty_cash.operate");
      if (!ctx) return;

      const rows = await withTenant(ctx.tenantId, async (tx) =>
        tx
          .select()
          .from(schema.pettyCashTransactions)
          .where(
            and(
              eq(schema.pettyCashTransactions.tenantId, ctx.tenantId),
              eq(schema.pettyCashTransactions.pettyCashFloatId, req.params.id),
            ),
          )
          .orderBy(
            desc(schema.pettyCashTransactions.txnDate),
            desc(schema.pettyCashTransactions.postedAt),
          )
          .limit(500),
      );
      return reply.send({ transactions: rows });
    },
  );

  // POST /petty-cash/transactions/expense
  fastify.post("/transactions/expense", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "petty_cash.operate");
    if (!ctx) return;

    const parsed = ExpenseSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "INVALID_INPUT", issues: parsed.error.issues },
      });
    }
    const input = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const floatRow = await getFloatForUpdate(
        tx,
        ctx.tenantId,
        input.pettyCashFloatId,
      );
      if (!floatRow) return { error: "FLOAT_NOT_FOUND" as const };
      if (floatRow.status !== "active")
        return { error: "FLOAT_NOT_ACTIVE" as const };

      const bumped = bumpBalanceOrFail(
        floatRow.currentBalanceCents,
        -input.amountCents,
        floatRow.ceilingCents,
        { enforceCeiling: false },
      );
      if (!bumped.ok) return { error: bumped.code as "INSUFFICIENT_BALANCE" };

      // DR <category> / CR petty cash
      const { entryId, entryNumber } = await postJournal(tx, {
        tenantId: ctx.tenantId,
        entryDate: input.txnDate,
        memo: `Petty cash expense · ${input.description}`,
        sourceType: "petty_cash_transaction",
        sourceId: floatRow.id,
        postedByUserId: ctx.userId,
        lines: [
          {
            accountId: input.categoryAccountId,
            drCents: input.amountCents,
            description: input.description,
          },
          {
            accountId: floatRow.pettyCashAccountId,
            crCents: input.amountCents,
            description: `Petty cash · ${floatRow.name}`,
          },
        ],
      });

      const [txn] = await tx
        .insert(schema.pettyCashTransactions)
        .values({
          tenantId: ctx.tenantId,
          pettyCashFloatId: floatRow.id,
          txnType: "expense",
          amountCents: input.amountCents,
          txnDate: input.txnDate,
          description: input.description,
          categoryAccountId: input.categoryAccountId,
          receiptNumber: input.receiptNumber || null,
          journalEntryId: entryId,
          postedByUserId: ctx.userId,
        })
        .returning();
      if (!txn) throw new Error("Txn insert failed");

      await tx
        .update(schema.pettyCashFloats)
        .set({
          currentBalanceCents: bumped.newBalance,
          updatedAt: new Date(),
        })
        .where(eq(schema.pettyCashFloats.id, floatRow.id));

      await recordAuditEvent(tx, {
        kind: "petty_cash_transaction.posted",
        summary: `Expense · ${input.description} · ${input.amountCents} cents`,
        refType: "petty_cash_transaction",
        refId: txn.id,
        diff: { txnType: "expense", amountCents: input.amountCents, entryNumber },
        actorUserId: ctx.userId,
      });

      return { ok: true as const, transaction: txn };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        FLOAT_NOT_FOUND: 404,
        FLOAT_NOT_ACTIVE: 409,
        INSUFFICIENT_BALANCE: 400,
      };
      const messages: Record<string, string> = {
        FLOAT_NOT_FOUND: "Float not found.",
        FLOAT_NOT_ACTIVE: "Cannot post on a closed float.",
        INSUFFICIENT_BALANCE:
          "Not enough cash in this float. Request a top-up first.",
      };
      return reply.status(map[String(result.error)] ?? 500).send({
        error: { code: result.error, message: messages[String(result.error)] },
      });
    }
    return reply.status(201).send({ transaction: result.transaction });
  });

  // POST /petty-cash/transactions/advance-out
  fastify.post("/transactions/advance-out", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "petty_cash.operate");
    if (!ctx) return;

    const parsed = AdvanceOutSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "INVALID_INPUT", issues: parsed.error.issues },
      });
    }
    const input = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const floatRow = await getFloatForUpdate(
        tx,
        ctx.tenantId,
        input.pettyCashFloatId,
      );
      if (!floatRow) return { error: "FLOAT_NOT_FOUND" as const };
      if (floatRow.status !== "active")
        return { error: "FLOAT_NOT_ACTIVE" as const };

      const bumped = bumpBalanceOrFail(
        floatRow.currentBalanceCents,
        -input.amountCents,
        floatRow.ceilingCents,
        { enforceCeiling: false },
      );
      if (!bumped.ok) return { error: bumped.code as "INSUFFICIENT_BALANCE" };

      // DR <staff_advance> / CR petty cash
      const { entryId, entryNumber } = await postJournal(tx, {
        tenantId: ctx.tenantId,
        entryDate: input.txnDate,
        memo: `Staff advance · ${input.description}`,
        sourceType: "petty_cash_transaction",
        sourceId: floatRow.id,
        postedByUserId: ctx.userId,
        lines: [
          {
            accountId: input.staffAdvanceAccountId,
            drCents: input.amountCents,
            description: input.description,
          },
          {
            accountId: floatRow.pettyCashAccountId,
            crCents: input.amountCents,
            description: `Petty cash · ${floatRow.name}`,
          },
        ],
      });

      const [txn] = await tx
        .insert(schema.pettyCashTransactions)
        .values({
          tenantId: ctx.tenantId,
          pettyCashFloatId: floatRow.id,
          txnType: "advance_out",
          amountCents: input.amountCents,
          txnDate: input.txnDate,
          description: input.description,
          categoryAccountId: input.staffAdvanceAccountId,
          counterpartyEmployeeId: input.counterpartyEmployeeId,
          receiptNumber: input.receiptNumber || null,
          journalEntryId: entryId,
          postedByUserId: ctx.userId,
        })
        .returning();
      if (!txn) throw new Error("Txn insert failed");

      await tx
        .update(schema.pettyCashFloats)
        .set({
          currentBalanceCents: bumped.newBalance,
          updatedAt: new Date(),
        })
        .where(eq(schema.pettyCashFloats.id, floatRow.id));

      await recordAuditEvent(tx, {
        kind: "petty_cash_transaction.posted",
        summary: `Advance out · ${input.description} · ${input.amountCents} cents`,
        refType: "petty_cash_transaction",
        refId: txn.id,
        diff: {
          txnType: "advance_out",
          amountCents: input.amountCents,
          counterpartyEmployeeId: input.counterpartyEmployeeId,
          entryNumber,
        },
        actorUserId: ctx.userId,
      });

      return { ok: true as const, transaction: txn };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        FLOAT_NOT_FOUND: 404,
        FLOAT_NOT_ACTIVE: 409,
        INSUFFICIENT_BALANCE: 400,
      };
      return reply
        .status(map[String(result.error)] ?? 500)
        .send({ error: { code: result.error } });
    }
    return reply.status(201).send({ transaction: result.transaction });
  });

  // POST /petty-cash/transactions/advance-return — cash back into the float.
  // Allow temporarily exceeding the ceiling on a return (edge case — a
  // staffer returning advance right before a scheduled top-up). The
  // spec explicitly loosens the guard for advance returns.
  fastify.post("/transactions/advance-return", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "petty_cash.operate");
    if (!ctx) return;

    const parsed = AdvanceReturnSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "INVALID_INPUT", issues: parsed.error.issues },
      });
    }
    const input = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const floatRow = await getFloatForUpdate(
        tx,
        ctx.tenantId,
        input.pettyCashFloatId,
      );
      if (!floatRow) return { error: "FLOAT_NOT_FOUND" as const };
      if (floatRow.status !== "active")
        return { error: "FLOAT_NOT_ACTIVE" as const };

      const bumped = bumpBalanceOrFail(
        floatRow.currentBalanceCents,
        input.amountCents,
        floatRow.ceilingCents,
        { enforceCeiling: false },
      );
      if (!bumped.ok) return { error: bumped.code as "CEILING_EXCEEDED" };

      // DR petty cash / CR staff advance
      const { entryId, entryNumber } = await postJournal(tx, {
        tenantId: ctx.tenantId,
        entryDate: input.txnDate,
        memo: `Staff advance return · ${input.description}`,
        sourceType: "petty_cash_transaction",
        sourceId: floatRow.id,
        postedByUserId: ctx.userId,
        lines: [
          {
            accountId: floatRow.pettyCashAccountId,
            drCents: input.amountCents,
            description: `Petty cash · ${floatRow.name}`,
          },
          {
            accountId: input.staffAdvanceAccountId,
            crCents: input.amountCents,
            description: input.description,
          },
        ],
      });

      const [txn] = await tx
        .insert(schema.pettyCashTransactions)
        .values({
          tenantId: ctx.tenantId,
          pettyCashFloatId: floatRow.id,
          txnType: "advance_return",
          amountCents: input.amountCents,
          txnDate: input.txnDate,
          description: input.description,
          categoryAccountId: input.staffAdvanceAccountId,
          counterpartyEmployeeId: input.counterpartyEmployeeId,
          receiptNumber: input.receiptNumber || null,
          journalEntryId: entryId,
          postedByUserId: ctx.userId,
        })
        .returning();
      if (!txn) throw new Error("Txn insert failed");

      await tx
        .update(schema.pettyCashFloats)
        .set({
          currentBalanceCents: bumped.newBalance,
          updatedAt: new Date(),
        })
        .where(eq(schema.pettyCashFloats.id, floatRow.id));

      await recordAuditEvent(tx, {
        kind: "petty_cash_transaction.posted",
        summary: `Advance return · ${input.description} · ${input.amountCents} cents`,
        refType: "petty_cash_transaction",
        refId: txn.id,
        diff: {
          txnType: "advance_return",
          amountCents: input.amountCents,
          counterpartyEmployeeId: input.counterpartyEmployeeId,
          entryNumber,
        },
        actorUserId: ctx.userId,
      });

      return { ok: true as const, transaction: txn };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        FLOAT_NOT_FOUND: 404,
        FLOAT_NOT_ACTIVE: 409,
      };
      return reply
        .status(map[String(result.error)] ?? 500)
        .send({ error: { code: result.error } });
    }
    return reply.status(201).send({ transaction: result.transaction });
  });

  // POST /petty-cash/transactions/:id/void — post reversing JE + un-bump balance.
  // Gated on petty_cash.approve so holders can't silently unwind their own rows.
  fastify.post<{ Params: { id: string } }>(
    "/transactions/:id/void",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "petty_cash.approve");
      if (!ctx) return;

      const parsed = VoidTxnSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "INVALID_INPUT", issues: parsed.error.issues },
        });
      }
      const input = parsed.data;

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [txn] = await tx
          .select()
          .from(schema.pettyCashTransactions)
          .where(
            and(
              eq(schema.pettyCashTransactions.tenantId, ctx.tenantId),
              eq(schema.pettyCashTransactions.id, req.params.id),
            ),
          )
          .limit(1);
        if (!txn) return { error: "NOT_FOUND" as const };
        if (txn.voidedAt) return { error: "ALREADY_VOIDED" as const };
        // Voiding reconciliation / close-transfer rows would corrupt the
        // recon chain. Block it; reopen the float or post an adjustment instead.
        if (
          txn.txnType === "variance_short" ||
          txn.txnType === "variance_over" ||
          txn.txnType === "close_transfer"
        ) {
          return { error: "NOT_VOIDABLE" as const };
        }

        const floatRow = await getFloatForUpdate(
          tx,
          ctx.tenantId,
          txn.pettyCashFloatId,
        );
        if (!floatRow) return { error: "FLOAT_NOT_FOUND" as const };
        if (floatRow.status !== "active")
          return { error: "FLOAT_NOT_ACTIVE" as const };

        // Reverse balance delta based on original txn sign.
        const rewindDelta = (() => {
          switch (txn.txnType) {
            case "expense":
            case "advance_out":
              return txn.amountCents; // original was −; rewind is +
            case "advance_return":
            case "top_up":
              return -txn.amountCents; // original was +; rewind is −
            default:
              return 0;
          }
        })();

        const { entryId, entryNumber } = await postReversingJournal(tx, {
          tenantId: ctx.tenantId,
          sourceEntryId: txn.journalEntryId,
          reversalDate: input.reversalDate,
          memo: `Void petty cash txn · ${input.reason}`,
          sourceType: "petty_cash_transaction",
          sourceId: txn.id,
          postedByUserId: ctx.userId,
        });

        await tx
          .update(schema.pettyCashTransactions)
          .set({
            voidedAt: new Date(),
            voidedByUserId: ctx.userId,
            voidReason: input.reason,
            voidJournalEntryId: entryId,
            updatedAt: new Date(),
          })
          .where(eq(schema.pettyCashTransactions.id, txn.id));

        await tx
          .update(schema.pettyCashFloats)
          .set({
            currentBalanceCents: floatRow.currentBalanceCents + rewindDelta,
            updatedAt: new Date(),
          })
          .where(eq(schema.pettyCashFloats.id, floatRow.id));

        // If this was the post of a top-up request, roll the request
        // status back to 'approved' so it can be posted again. (Rare
        // enough; keeps state consistent.)
        if (txn.topUpRequestId) {
          await tx
            .update(schema.pettyCashTopUpRequests)
            .set({
              status: "approved",
              postedTransactionId: null,
              updatedAt: new Date(),
            })
            .where(eq(schema.pettyCashTopUpRequests.id, txn.topUpRequestId));
        }

        await recordAuditEvent(tx, {
          kind: "petty_cash_transaction.voided",
          summary: `Voided petty cash txn · ${input.reason}`,
          refType: "petty_cash_transaction",
          refId: txn.id,
          diff: {
            reversalEntryNumber: entryNumber,
            rewoundBalanceDelta: rewindDelta,
            reason: input.reason,
          },
          actorUserId: ctx.userId,
        });

        return { ok: true as const };
      });

      if ("error" in result) {
        const map: Record<string, number> = {
          NOT_FOUND: 404,
          ALREADY_VOIDED: 409,
          NOT_VOIDABLE: 409,
          FLOAT_NOT_FOUND: 404,
          FLOAT_NOT_ACTIVE: 409,
        };
        const messages: Record<string, string> = {
          NOT_VOIDABLE:
            "Variance and close-transfer rows cannot be voided. Reopen the float or post a correcting adjustment.",
          FLOAT_NOT_ACTIVE: "Cannot void on a closed float.",
        };
        return reply.status(map[String(result.error)] ?? 500).send({
          error: { code: result.error, message: messages[String(result.error)] },
        });
      }
      return reply.send({ ok: true });
    },
  );

  // =========================================================================
  // TOP-UP REQUESTS
  // =========================================================================

  // GET /petty-cash/top-up-requests — filter by ?floatId= and ?status=
  fastify.get<{ Querystring: { floatId?: string; status?: string } }>(
    "/top-up-requests",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "petty_cash.operate");
      if (!ctx) return;

      const rows = await withTenant(ctx.tenantId, async (tx) => {
        const conds = [
          eq(schema.pettyCashTopUpRequests.tenantId, ctx.tenantId),
        ];
        if (req.query.floatId) {
          conds.push(
            eq(
              schema.pettyCashTopUpRequests.pettyCashFloatId,
              req.query.floatId,
            ),
          );
        }
        if (req.query.status) {
          conds.push(
            eq(schema.pettyCashTopUpRequests.status, req.query.status),
          );
        }
        return tx
          .select()
          .from(schema.pettyCashTopUpRequests)
          .where(and(...conds))
          .orderBy(desc(schema.pettyCashTopUpRequests.requestedAt))
          .limit(200);
      });
      return reply.send({ requests: rows });
    },
  );

  // POST /petty-cash/top-up-requests — holder requests a top-up
  fastify.post("/top-up-requests", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "petty_cash.operate");
    if (!ctx) return;

    const parsed = CreateTopUpRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "INVALID_INPUT", issues: parsed.error.issues },
      });
    }
    const input = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [floatRow] = await tx
        .select()
        .from(schema.pettyCashFloats)
        .where(
          and(
            eq(schema.pettyCashFloats.tenantId, ctx.tenantId),
            eq(schema.pettyCashFloats.id, input.pettyCashFloatId),
          ),
        )
        .limit(1);
      if (!floatRow) return { error: "FLOAT_NOT_FOUND" as const };
      if (floatRow.status !== "active")
        return { error: "FLOAT_NOT_ACTIVE" as const };

      const [rqst] = await tx
        .insert(schema.pettyCashTopUpRequests)
        .values({
          tenantId: ctx.tenantId,
          pettyCashFloatId: input.pettyCashFloatId,
          requestedAmountCents: input.requestedAmountCents,
          reason: input.reason,
          requestedByUserId: ctx.userId,
        })
        .returning();
      if (!rqst) throw new Error("Top-up insert failed");

      await recordAuditEvent(tx, {
        kind: "petty_cash_top_up.requested",
        summary: `Top-up request · ${input.requestedAmountCents} cents · "${floatRow.name}"`,
        refType: "petty_cash_top_up_request",
        refId: rqst.id,
        diff: {
          requestedAmountCents: input.requestedAmountCents,
          reason: input.reason,
        },
        actorUserId: ctx.userId,
      });

      return { ok: true as const, request: rqst };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        FLOAT_NOT_FOUND: 404,
        FLOAT_NOT_ACTIVE: 409,
      };
      return reply
        .status(map[String(result.error)] ?? 500)
        .send({ error: { code: result.error } });
    }
    return reply.status(201).send({ request: result.request });
  });

  // POST /petty-cash/top-up-requests/:id/approve — move pending → approved.
  // SOD: requester ≠ approver.
  fastify.post<{ Params: { id: string } }>(
    "/top-up-requests/:id/approve",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "petty_cash.approve");
      if (!ctx) return;

      const parsed = DecideTopUpRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "INVALID_INPUT", issues: parsed.error.issues },
        });
      }
      const input = parsed.data;

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [rqst] = await tx
          .select()
          .from(schema.pettyCashTopUpRequests)
          .where(
            and(
              eq(schema.pettyCashTopUpRequests.tenantId, ctx.tenantId),
              eq(schema.pettyCashTopUpRequests.id, req.params.id),
            ),
          )
          .limit(1);
        if (!rqst) return { error: "NOT_FOUND" as const };
        if (rqst.status !== "pending")
          return { error: "NOT_PENDING" as const };
        if (rqst.requestedByUserId === ctx.userId)
          return { error: "SOD_VIOLATION" as const };

        const [updated] = await tx
          .update(schema.pettyCashTopUpRequests)
          .set({
            status: "approved",
            decidedAt: new Date(),
            decidedByUserId: ctx.userId,
            decisionNotes: input.decisionNotes || null,
            updatedAt: new Date(),
          })
          .where(eq(schema.pettyCashTopUpRequests.id, rqst.id))
          .returning();

        await recordAuditEvent(tx, {
          kind: "petty_cash_top_up.approved",
          summary: `Approved top-up request ${rqst.id.slice(0, 8)}`,
          refType: "petty_cash_top_up_request",
          refId: rqst.id,
          diff: { decisionNotes: input.decisionNotes || null },
          actorUserId: ctx.userId,
        });

        return { ok: true as const, request: updated };
      });

      if ("error" in result) {
        const map: Record<string, number> = {
          NOT_FOUND: 404,
          NOT_PENDING: 409,
          SOD_VIOLATION: 403,
        };
        const messages: Record<string, string> = {
          NOT_PENDING: "This request has already been decided.",
          SOD_VIOLATION:
            "You cannot approve your own top-up request. Someone else with petty_cash.approve must approve it.",
        };
        return reply.status(map[String(result.error)] ?? 500).send({
          error: { code: result.error, message: messages[String(result.error)] },
        });
      }
      return reply.send({ request: result.request });
    },
  );

  // POST /petty-cash/top-up-requests/:id/reject
  fastify.post<{ Params: { id: string } }>(
    "/top-up-requests/:id/reject",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "petty_cash.approve");
      if (!ctx) return;

      const parsed = DecideTopUpRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "INVALID_INPUT", issues: parsed.error.issues },
        });
      }
      const input = parsed.data;

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [rqst] = await tx
          .select()
          .from(schema.pettyCashTopUpRequests)
          .where(
            and(
              eq(schema.pettyCashTopUpRequests.tenantId, ctx.tenantId),
              eq(schema.pettyCashTopUpRequests.id, req.params.id),
            ),
          )
          .limit(1);
        if (!rqst) return { error: "NOT_FOUND" as const };
        if (rqst.status !== "pending")
          return { error: "NOT_PENDING" as const };

        const [updated] = await tx
          .update(schema.pettyCashTopUpRequests)
          .set({
            status: "rejected",
            decidedAt: new Date(),
            decidedByUserId: ctx.userId,
            decisionNotes: input.decisionNotes || null,
            updatedAt: new Date(),
          })
          .where(eq(schema.pettyCashTopUpRequests.id, rqst.id))
          .returning();

        await recordAuditEvent(tx, {
          kind: "petty_cash_top_up.rejected",
          summary: `Rejected top-up request ${rqst.id.slice(0, 8)}`,
          refType: "petty_cash_top_up_request",
          refId: rqst.id,
          diff: { decisionNotes: input.decisionNotes || null },
          actorUserId: ctx.userId,
        });

        return { ok: true as const, request: updated };
      });

      if ("error" in result) {
        const map: Record<string, number> = {
          NOT_FOUND: 404,
          NOT_PENDING: 409,
        };
        return reply
          .status(map[String(result.error)] ?? 500)
          .send({ error: { code: result.error } });
      }
      return reply.send({ request: result.request });
    },
  );

  // POST /petty-cash/top-up-requests/:id/post — post the approved top-up
  // against a caller-chosen cash/bank source. Creates a `top_up` txn and
  // bumps the float balance. Enforces the ceiling guard on top-up post.
  fastify.post<{ Params: { id: string } }>(
    "/top-up-requests/:id/post",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "petty_cash.approve");
      if (!ctx) return;

      const parsed = PostTopUpRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "INVALID_INPUT", issues: parsed.error.issues },
        });
      }
      const input = parsed.data;

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [rqst] = await tx
          .select()
          .from(schema.pettyCashTopUpRequests)
          .where(
            and(
              eq(schema.pettyCashTopUpRequests.tenantId, ctx.tenantId),
              eq(schema.pettyCashTopUpRequests.id, req.params.id),
            ),
          )
          .limit(1);
        if (!rqst) return { error: "NOT_FOUND" as const };
        if (rqst.status !== "approved")
          return { error: "NOT_APPROVED" as const };

        const floatRow = await getFloatForUpdate(
          tx,
          ctx.tenantId,
          rqst.pettyCashFloatId,
        );
        if (!floatRow) return { error: "FLOAT_NOT_FOUND" as const };
        if (floatRow.status !== "active")
          return { error: "FLOAT_NOT_ACTIVE" as const };

        const amount = input.amountCents ?? rqst.requestedAmountCents;

        // Ceiling guard: new_balance <= ceiling on top-up post.
        const bumped = bumpBalanceOrFail(
          floatRow.currentBalanceCents,
          amount,
          floatRow.ceilingCents,
          { enforceCeiling: true },
        );
        if (!bumped.ok) return { error: bumped.code as "CEILING_EXCEEDED" };

        // DR petty cash / CR <cash_or_bank_source>
        const { entryId, entryNumber } = await postJournal(tx, {
          tenantId: ctx.tenantId,
          entryDate: input.txnDate,
          memo: `Petty cash top-up · ${floatRow.name}`,
          sourceType: "petty_cash_top_up_request",
          sourceId: rqst.id,
          postedByUserId: ctx.userId,
          lines: [
            {
              accountId: floatRow.pettyCashAccountId,
              drCents: amount,
              description: `Petty cash top-up · ${floatRow.name}`,
            },
            {
              accountId: input.sourceAccountId,
              crCents: amount,
              description: `Top-up source`,
            },
          ],
        });

        const [txn] = await tx
          .insert(schema.pettyCashTransactions)
          .values({
            tenantId: ctx.tenantId,
            pettyCashFloatId: floatRow.id,
            txnType: "top_up",
            amountCents: amount,
            txnDate: input.txnDate,
            description: `Top-up · ${entryNumber}`,
            counterpartyAccountId: input.sourceAccountId,
            journalEntryId: entryId,
            postedByUserId: ctx.userId,
            topUpRequestId: rqst.id,
          })
          .returning();
        if (!txn) throw new Error("Top-up txn insert failed");

        await tx
          .update(schema.pettyCashFloats)
          .set({
            currentBalanceCents: bumped.newBalance,
            updatedAt: new Date(),
          })
          .where(eq(schema.pettyCashFloats.id, floatRow.id));

        const [updatedRqst] = await tx
          .update(schema.pettyCashTopUpRequests)
          .set({
            status: "posted",
            postedTransactionId: txn.id,
            updatedAt: new Date(),
          })
          .where(eq(schema.pettyCashTopUpRequests.id, rqst.id))
          .returning();

        await recordAuditEvent(tx, {
          kind: "petty_cash_top_up.posted",
          summary: `Posted top-up · ${amount} cents · "${floatRow.name}"`,
          refType: "petty_cash_top_up_request",
          refId: rqst.id,
          diff: {
            amountCents: amount,
            sourceAccountId: input.sourceAccountId,
            txnId: txn.id,
            entryNumber,
          },
          actorUserId: ctx.userId,
        });

        return { ok: true as const, request: updatedRqst, transaction: txn };
      });

      if ("error" in result) {
        const map: Record<string, number> = {
          NOT_FOUND: 404,
          NOT_APPROVED: 409,
          FLOAT_NOT_FOUND: 404,
          FLOAT_NOT_ACTIVE: 409,
          CEILING_EXCEEDED: 400,
        };
        const messages: Record<string, string> = {
          CEILING_EXCEEDED:
            "Posting this top-up would push the float above its ceiling.",
          NOT_APPROVED:
            "Only approved top-up requests can be posted.",
        };
        return reply.status(map[String(result.error)] ?? 500).send({
          error: { code: result.error, message: messages[String(result.error)] },
        });
      }
      return reply.send({
        request: result.request,
        transaction: result.transaction,
      });
    },
  );

  // POST /petty-cash/top-up-requests/:id/cancel — requester cancels own pending req
  fastify.post<{ Params: { id: string } }>(
    "/top-up-requests/:id/cancel",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "petty_cash.operate");
      if (!ctx) return;

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [rqst] = await tx
          .select()
          .from(schema.pettyCashTopUpRequests)
          .where(
            and(
              eq(schema.pettyCashTopUpRequests.tenantId, ctx.tenantId),
              eq(schema.pettyCashTopUpRequests.id, req.params.id),
            ),
          )
          .limit(1);
        if (!rqst) return { error: "NOT_FOUND" as const };
        if (rqst.status !== "pending")
          return { error: "NOT_PENDING" as const };

        const [updated] = await tx
          .update(schema.pettyCashTopUpRequests)
          .set({
            status: "cancelled",
            decidedAt: new Date(),
            decidedByUserId: ctx.userId,
            updatedAt: new Date(),
          })
          .where(eq(schema.pettyCashTopUpRequests.id, rqst.id))
          .returning();

        await recordAuditEvent(tx, {
          kind: "petty_cash_top_up.cancelled",
          summary: `Cancelled top-up request ${rqst.id.slice(0, 8)}`,
          refType: "petty_cash_top_up_request",
          refId: rqst.id,
          diff: null,
          actorUserId: ctx.userId,
        });

        return { ok: true as const, request: updated };
      });

      if ("error" in result) {
        const map: Record<string, number> = {
          NOT_FOUND: 404,
          NOT_PENDING: 409,
        };
        return reply
          .status(map[String(result.error)] ?? 500)
          .send({ error: { code: result.error } });
      }
      return reply.send({ request: result.request });
    },
  );

  // =========================================================================
  // RECONCILIATIONS
  // =========================================================================

  // GET /petty-cash/floats/:id/reconciliations — recon history
  fastify.get<{ Params: { id: string } }>(
    "/floats/:id/reconciliations",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "petty_cash.operate");
      if (!ctx) return;

      const rows = await withTenant(ctx.tenantId, async (tx) =>
        tx
          .select()
          .from(schema.pettyCashReconciliations)
          .where(
            and(
              eq(schema.pettyCashReconciliations.tenantId, ctx.tenantId),
              eq(
                schema.pettyCashReconciliations.pettyCashFloatId,
                req.params.id,
              ),
            ),
          )
          .orderBy(desc(schema.pettyCashReconciliations.reconDate))
          .limit(100),
      );
      return reply.send({ reconciliations: rows });
    },
  );

  // POST /petty-cash/reconciliations — record EOD count, post variance JE if any.
  fastify.post("/reconciliations", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "petty_cash.operate");
    if (!ctx) return;

    const parsed = CreateReconciliationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "INVALID_INPUT", issues: parsed.error.issues },
      });
    }
    const input = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const floatRow = await getFloatForUpdate(
        tx,
        ctx.tenantId,
        input.pettyCashFloatId,
      );
      if (!floatRow) return { error: "FLOAT_NOT_FOUND" as const };
      if (floatRow.status !== "active")
        return { error: "FLOAT_NOT_ACTIVE" as const };

      // Reject a second recon for the same date (partial unique also catches).
      const existing = await tx
        .select({ id: schema.pettyCashReconciliations.id })
        .from(schema.pettyCashReconciliations)
        .where(
          and(
            eq(schema.pettyCashReconciliations.tenantId, ctx.tenantId),
            eq(
              schema.pettyCashReconciliations.pettyCashFloatId,
              floatRow.id,
            ),
            eq(schema.pettyCashReconciliations.reconDate, input.reconDate),
          ),
        )
        .limit(1);
      if (existing[0]) return { error: "DUPLICATE_RECON" as const };

      // Compute window boundaries: find the previous recon (if any).
      const [prevRecon] = await tx
        .select()
        .from(schema.pettyCashReconciliations)
        .where(
          and(
            eq(schema.pettyCashReconciliations.tenantId, ctx.tenantId),
            eq(schema.pettyCashReconciliations.pettyCashFloatId, floatRow.id),
          ),
        )
        .orderBy(desc(schema.pettyCashReconciliations.reconDate))
        .limit(1);

      const openingBalanceCents = prevRecon ? prevRecon.countedCents : 0;

      // Sum non-voided movements on this float in (prev.recon_date, recon_date].
      // Expressed on the signed balance axis:
      //   in  = top_up + advance_return + variance_over
      //   out = expense + advance_out   + variance_short + close_transfer
      // We need the dated window to stay auditable even if a txn is voided
      // post-hoc; we ignore voided rows.
      const movementsRows = (await tx.execute(sql`
        SELECT txn_type,
               COALESCE(SUM(amount_cents), 0)::bigint AS total
          FROM petty_cash_transactions
         WHERE tenant_id = current_tenant_id()
           AND petty_cash_float_id = ${floatRow.id}::uuid
           AND voided_at IS NULL
           AND txn_date <= ${input.reconDate}::date
           ${prevRecon ? sql`AND txn_date > ${prevRecon.reconDate}::date` : sql``}
         GROUP BY txn_type
      `)) as unknown as Array<{ txn_type: string; total: string | number }>;

      let movementsIn = 0;
      let movementsOut = 0;
      for (const row of movementsRows) {
        const t = Number(row.total);
        if (
          row.txn_type === "top_up" ||
          row.txn_type === "advance_return" ||
          row.txn_type === "variance_over"
        ) {
          movementsIn += t;
        } else if (
          row.txn_type === "expense" ||
          row.txn_type === "advance_out" ||
          row.txn_type === "variance_short" ||
          row.txn_type === "close_transfer"
        ) {
          movementsOut += t;
        }
      }

      const expectedClose = openingBalanceCents + movementsIn - movementsOut;
      const variance = input.countedCents - expectedClose;

      // Variance JE + txn row if non-zero.
      let varianceTxnId: string | null = null;
      if (variance !== 0) {
        const overShort = await resolveCashOverShortAccount(tx, ctx.tenantId);
        if (!overShort) return { error: "NO_OVER_SHORT_ACCOUNT" as const };

        const amount = Math.abs(variance);
        const txnType = variance < 0 ? "variance_short" : "variance_over";

        // variance_short: DR 5190 / CR petty cash  (balance ↓)
        // variance_over : DR petty cash / CR 5190  (balance ↑)
        const lines =
          variance < 0
            ? [
                {
                  accountId: overShort.id,
                  drCents: amount,
                  description: `Petty cash short · ${floatRow.name}`,
                },
                {
                  accountId: floatRow.pettyCashAccountId,
                  crCents: amount,
                  description: `Petty cash · ${floatRow.name}`,
                },
              ]
            : [
                {
                  accountId: floatRow.pettyCashAccountId,
                  drCents: amount,
                  description: `Petty cash · ${floatRow.name}`,
                },
                {
                  accountId: overShort.id,
                  crCents: amount,
                  description: `Petty cash over · ${floatRow.name}`,
                },
              ];

        const { entryId, entryNumber } = await postJournal(tx, {
          tenantId: ctx.tenantId,
          entryDate: input.reconDate,
          memo: `Petty cash ${txnType} · ${floatRow.name}`,
          sourceType: "petty_cash_reconciliation",
          sourceId: floatRow.id,
          postedByUserId: ctx.userId,
          lines,
        });

        const [vtxn] = await tx
          .insert(schema.pettyCashTransactions)
          .values({
            tenantId: ctx.tenantId,
            pettyCashFloatId: floatRow.id,
            txnType,
            amountCents: amount,
            txnDate: input.reconDate,
            description: `Variance ${txnType} · ${entryNumber}`,
            counterpartyAccountId: overShort.id,
            journalEntryId: entryId,
            postedByUserId: ctx.userId,
          })
          .returning();
        varianceTxnId = vtxn?.id ?? null;

        // Update float balance so it matches counted.
        await tx
          .update(schema.pettyCashFloats)
          .set({
            currentBalanceCents: input.countedCents,
            updatedAt: new Date(),
          })
          .where(eq(schema.pettyCashFloats.id, floatRow.id));
      }

      const [recon] = await tx
        .insert(schema.pettyCashReconciliations)
        .values({
          tenantId: ctx.tenantId,
          pettyCashFloatId: floatRow.id,
          reconDate: input.reconDate,
          openingBalanceCents,
          movementsInCents: movementsIn,
          movementsOutCents: movementsOut,
          expectedCloseCents: expectedClose,
          countedCents: input.countedCents,
          varianceCents: variance,
          varianceReason: input.varianceReason || null,
          varianceTransactionId: varianceTxnId,
          reconciledByUserId: ctx.userId,
          notes: input.notes || null,
        })
        .returning();
      if (!recon) throw new Error("Recon insert failed");

      // Back-link the variance txn to this recon row (fk was nullable on insert).
      if (varianceTxnId) {
        await tx
          .update(schema.pettyCashTransactions)
          .set({ reconciliationId: recon.id })
          .where(eq(schema.pettyCashTransactions.id, varianceTxnId));
      }

      await recordAuditEvent(tx, {
        kind: "petty_cash_reconciliation.posted",
        summary: `Reconciled "${floatRow.name}" on ${input.reconDate} · variance ${variance}`,
        refType: "petty_cash_reconciliation",
        refId: recon.id,
        diff: {
          openingBalanceCents,
          movementsIn,
          movementsOut,
          expectedClose,
          countedCents: input.countedCents,
          varianceCents: variance,
          varianceTxnId,
        },
        actorUserId: ctx.userId,
      });

      return { ok: true as const, reconciliation: recon };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        FLOAT_NOT_FOUND: 404,
        FLOAT_NOT_ACTIVE: 409,
        DUPLICATE_RECON: 409,
        NO_OVER_SHORT_ACCOUNT: 500,
      };
      const messages: Record<string, string> = {
        DUPLICATE_RECON:
          "A reconciliation for this float on that date already exists.",
        NO_OVER_SHORT_ACCOUNT:
          "Missing 5190 Cash Over/Short. Re-run the POS migration to seed it.",
      };
      return reply.status(map[String(result.error)] ?? 500).send({
        error: { code: result.error, message: messages[String(result.error)] },
      });
    }
    return reply.status(201).send({ reconciliation: result.reconciliation });
  });

  // Referenced import keepers.
  void asc;
};
