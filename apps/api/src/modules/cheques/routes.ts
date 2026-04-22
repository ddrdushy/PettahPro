import type { FastifyPluginAsync } from "fastify";
import { and, eq, desc, inArray, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema, db as rootDb } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";
import { postJournal } from "../accounting/journal-posting.js";
import { resolveChequeGLAccounts } from "./accounts.js";
import { runStaleFlaggingForTenant } from "./stale-flag.js";

const BOUNCE_REASONS = [
  "insufficient_funds",
  "account_closed",
  "stopped_payment",
  "signature_mismatch",
  "post_dated",
  "stale",
  "refer_to_drawer",
  "other",
] as const;

const ClearSchema = z.object({
  clearedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const BounceSchema = z.object({
  reasonCode: z.enum(BOUNCE_REASONS),
  reasonDetails: z.string().max(500).optional(),
  bankChargesCents: z.number().int().min(0).default(0),
  bouncedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const ACTIVE_STATES_RECEIVED = ["received", "deposited", "in_clearing"] as const;
const ACTIVE_STATES_ISSUED = ["drafted", "issued", "presented"] as const;

export const chequesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /cheques — list with party name
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) => {
      const cq = await tx
        .select()
        .from(schema.cheques)
        .where(eq(schema.cheques.tenantId, ctx.tenantId))
        .orderBy(desc(schema.cheques.createdAt))
        .limit(200);

      const custIds = Array.from(
        new Set(cq.map((c) => c.customerId).filter((v): v is string => !!v)),
      );
      const supIds = Array.from(
        new Set(cq.map((c) => c.supplierId).filter((v): v is string => !!v)),
      );
      const customers = custIds.length
        ? await tx
            .select({ id: schema.customers.id, name: schema.customers.name })
            .from(schema.customers)
            .where(inArray(schema.customers.id, custIds))
        : [];
      const suppliers = supIds.length
        ? await tx
            .select({ id: schema.suppliers.id, name: schema.suppliers.name })
            .from(schema.suppliers)
            .where(inArray(schema.suppliers.id, supIds))
        : [];
      const customerName = new Map(customers.map((c) => [c.id, c.name]));
      const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));

      return cq.map((c) => ({
        ...c,
        partyName:
          c.direction === "received"
            ? (customerName.get(c.customerId ?? "") ?? c.otherPartyName ?? "—")
            : (supplierName.get(c.supplierId ?? "") ?? c.otherPartyName ?? c.payeeName ?? "—"),
      }));
    });

    return reply.send({ cheques: rows });
  });

  // GET /cheques/:id — detail + bounce events
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const cheque = (
        await tx
          .select()
          .from(schema.cheques)
          .where(
            and(eq(schema.cheques.tenantId, ctx.tenantId), eq(schema.cheques.id, req.params.id)),
          )
          .limit(1)
      )[0];
      if (!cheque) return null;

      const events = await tx
        .select()
        .from(schema.chequeBounceEvents)
        .where(eq(schema.chequeBounceEvents.chequeId, cheque.id))
        .orderBy(asc(schema.chequeBounceEvents.bounceNumber));

      let party: { id: string; name: string } | null = null;
      if (cheque.customerId) {
        const r = await tx
          .select({ id: schema.customers.id, name: schema.customers.name })
          .from(schema.customers)
          .where(eq(schema.customers.id, cheque.customerId))
          .limit(1);
        if (r[0]) party = r[0];
      } else if (cheque.supplierId) {
        const r = await tx
          .select({ id: schema.suppliers.id, name: schema.suppliers.name })
          .from(schema.suppliers)
          .where(eq(schema.suppliers.id, cheque.supplierId))
          .limit(1);
        if (r[0]) party = r[0];
      }

      let bankAccount: { code: string; name: string } | null = null;
      if (cheque.bankAccountId) {
        const r = await tx
          .select({
            code: schema.chartOfAccounts.code,
            name: schema.chartOfAccounts.name,
          })
          .from(schema.chartOfAccounts)
          .where(eq(schema.chartOfAccounts.id, cheque.bankAccountId))
          .limit(1);
        if (r[0]) bankAccount = r[0];
      }

      return { cheque, events, party, bankAccount };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  // POST /cheques/:id/clear — reclassify in-clearing/transit → bank
  fastify.post<{ Params: { id: string } }>("/:id/clear", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = ClearSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const clearedOn = parsed.data.clearedOn ?? new Date().toISOString().slice(0, 10);

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const cheque = (
        await tx
          .select()
          .from(schema.cheques)
          .where(
            and(eq(schema.cheques.tenantId, ctx.tenantId), eq(schema.cheques.id, req.params.id)),
          )
          .limit(1)
      )[0];
      if (!cheque) return { error: "NOT_FOUND" as const };
      const active =
        cheque.direction === "received"
          ? (ACTIVE_STATES_RECEIVED as readonly string[]).includes(cheque.status)
          : (ACTIVE_STATES_ISSUED as readonly string[]).includes(cheque.status);
      if (!active) return { error: "NOT_CLEARABLE" as const };
      if (!cheque.bankAccountId) return { error: "NO_BANK_ACCOUNT" as const };

      const { bankClearingAccountId, bankTransitAccountId } = await resolveChequeGLAccounts(
        tx,
        ctx.tenantId,
      );
      const holdingId =
        cheque.direction === "received" ? bankClearingAccountId : bankTransitAccountId;
      if (!holdingId) return { error: "NO_HOLDING_ACCOUNT" as const };

      const { entryId, entryNumber } = await postJournal(tx, {
        tenantId: ctx.tenantId,
        entryDate: clearedOn,
        memo: `Cheque ${cheque.chequeNumber} cleared`,
        sourceType: "cheque",
        sourceId: cheque.id,
        postedByUserId: ctx.userId,
        lines: [
          {
            accountId: cheque.bankAccountId,
            drCents: cheque.amountCents,
            description: `Cheque ${cheque.chequeNumber} cleared`,
            customerId: cheque.customerId ?? undefined,
            supplierId: cheque.supplierId ?? undefined,
          },
          {
            accountId: holdingId,
            crCents: cheque.amountCents,
            description:
              cheque.direction === "received"
                ? "Clearing account reclassified"
                : "Transit account reclassified",
          },
        ],
      });

      await tx
        .update(schema.cheques)
        .set({
          status: "cleared",
          clearedAt: new Date(),
          journalEntryIdClear: entryId,
          updatedAt: new Date(),
          ...(cheque.direction === "issued" ? { presentedAt: new Date() } : {}),
        })
        .where(eq(schema.cheques.id, cheque.id));

      return { ok: true as const, entryNumber };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        NOT_FOUND: 404,
        NOT_CLEARABLE: 409,
        NO_BANK_ACCOUNT: 500,
        NO_HOLDING_ACCOUNT: 500,
      };
      return reply.status(map[result.error] ?? 500).send({ error: { code: result.error } });
    }
    return reply.send(result);
  });

  // POST /cheques/:id/bounce — reverse the original posting + record bank charges
  fastify.post<{ Params: { id: string } }>("/:id/bounce", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = BounceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const { reasonCode, reasonDetails, bankChargesCents } = parsed.data;
    const bouncedOn = parsed.data.bouncedOn ?? new Date().toISOString().slice(0, 10);

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const cheque = (
        await tx
          .select()
          .from(schema.cheques)
          .where(
            and(eq(schema.cheques.tenantId, ctx.tenantId), eq(schema.cheques.id, req.params.id)),
          )
          .limit(1)
      )[0];
      if (!cheque) return { error: "NOT_FOUND" as const };
      const canBounce =
        cheque.direction === "received"
          ? (ACTIVE_STATES_RECEIVED as readonly string[]).includes(cheque.status)
          : (ACTIVE_STATES_ISSUED as readonly string[]).includes(cheque.status);
      if (!canBounce) return { error: "NOT_BOUNCEABLE" as const };
      if (!cheque.bankAccountId) return { error: "NO_BANK_ACCOUNT" as const };

      const { bankClearingAccountId, bankTransitAccountId, bankFeesAccountId } =
        await resolveChequeGLAccounts(tx, ctx.tenantId);

      const holdingId =
        cheque.direction === "received" ? bankClearingAccountId : bankTransitAccountId;
      if (!holdingId) return { error: "NO_HOLDING_ACCOUNT" as const };

      // Resolve AR / AP so we can re-open the original balance
      const coaRows = await tx
        .select()
        .from(schema.chartOfAccounts)
        .where(eq(schema.chartOfAccounts.tenantId, ctx.tenantId));
      const bySub = new Map(coaRows.map((a) => [a.accountSubtype, a]));
      const arAcc = bySub.get("ar");
      const apAcc = bySub.get("ap");

      const reversalLines: Parameters<typeof postJournal>[1]["lines"] = [];
      if (cheque.direction === "received") {
        // Original: DR Clearing, CR AR. Reverse: DR AR, CR Clearing.
        if (!arAcc) return { error: "NO_AR_ACCOUNT" as const };
        reversalLines.push(
          {
            accountId: arAcc.id,
            drCents: cheque.amountCents,
            description: `Bounce reversal · cheque ${cheque.chequeNumber}`,
            customerId: cheque.customerId ?? undefined,
          },
          {
            accountId: holdingId,
            crCents: cheque.amountCents,
            description: `Bounce reversal · clearing released`,
          },
        );
      } else {
        // Original: DR AP, CR Transit. Reverse: DR Transit, CR AP.
        if (!apAcc) return { error: "NO_AP_ACCOUNT" as const };
        reversalLines.push(
          {
            accountId: holdingId,
            drCents: cheque.amountCents,
            description: `Bounce reversal · transit released`,
          },
          {
            accountId: apAcc.id,
            crCents: cheque.amountCents,
            description: `Bounce reversal · cheque ${cheque.chequeNumber}`,
            supplierId: cheque.supplierId ?? undefined,
          },
        );
      }

      if (bankChargesCents > 0) {
        if (!bankFeesAccountId) return { error: "NO_BANK_FEES_ACCOUNT" as const };
        reversalLines.push(
          {
            accountId: bankFeesAccountId,
            drCents: bankChargesCents,
            description: `Bounce fee · cheque ${cheque.chequeNumber}`,
          },
          {
            accountId: cheque.bankAccountId,
            crCents: bankChargesCents,
            description: `Bounce fee deducted from bank`,
          },
        );
      }

      const { entryId, entryNumber } = await postJournal(tx, {
        tenantId: ctx.tenantId,
        entryDate: bouncedOn,
        memo: `Cheque ${cheque.chequeNumber} bounced (${reasonCode})`,
        sourceType: "cheque_bounce",
        sourceId: cheque.id,
        postedByUserId: ctx.userId,
        lines: reversalLines,
      });

      // Record the bounce event
      const bounceNumber = (cheque.bounceCount ?? 0) + 1;
      await tx.insert(schema.chequeBounceEvents).values({
        tenantId: ctx.tenantId,
        chequeId: cheque.id,
        bounceNumber,
        bouncedAt: new Date(bouncedOn + "T00:00:00Z"),
        reasonCode,
        reasonDetails: reasonDetails ?? null,
        bankChargesCents,
        bankChargesAccountId: bankChargesCents > 0 ? bankFeesAccountId : null,
        reversalJournalEntryId: entryId,
        createdByUserId: ctx.userId,
      });

      await tx
        .update(schema.cheques)
        .set({
          status: "bounced",
          bouncedAt: new Date(),
          bounceCount: bounceNumber,
          lastBounceReason: reasonCode,
          journalEntryIdBounce: entryId,
          updatedAt: new Date(),
        })
        .where(eq(schema.cheques.id, cheque.id));

      // Also re-open the allocated invoice/bill: its balance came back on bounce
      if (cheque.direction === "received" && cheque.sourceReceiptId) {
        const allocs = await tx
          .select()
          .from(schema.paymentAllocations)
          .where(eq(schema.paymentAllocations.paymentId, cheque.sourceReceiptId));
        for (const a of allocs) {
          const inv = (
            await tx
              .select()
              .from(schema.invoices)
              .where(eq(schema.invoices.id, a.invoiceId))
              .limit(1)
          )[0];
          if (!inv) continue;
          const newPaid = inv.amountPaidCents - a.allocatedCents;
          const newBalance = inv.balanceDueCents + a.allocatedCents;
          await tx
            .update(schema.invoices)
            .set({
              amountPaidCents: newPaid,
              balanceDueCents: newBalance,
              status: newBalance === inv.totalCents ? "posted" : "partially_paid",
              updatedAt: new Date(),
            })
            .where(eq(schema.invoices.id, inv.id));
        }
        // 2-bounce auto-flag: if this customer now has ≥ 2 bounced cheques
        // against this tenant, park them on credit hold until a human
        // reviews. Mirrors the SL SME practice of being cautious with
        // serial bouncers — and keeps our exposure down.
        if (cheque.customerId) {
          const bounceRows = (await tx.execute(sql`
            SELECT customer_bounce_count(${cheque.customerId}::uuid)::int AS bounce_count
          `)) as unknown as Array<{ bounce_count: number }>;
          const bounceCount = bounceRows[0]?.bounce_count ?? 0;
          if (bounceCount >= 2) {
            await tx
              .update(schema.customers)
              .set({
                creditHold: true,
                creditHoldReason: `Auto-flag: ${bounceCount} bounced cheques`,
                creditHoldAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(schema.customers.id, cheque.customerId));
          }
        }
      } else if (cheque.direction === "issued" && cheque.sourcePaymentId) {
        const allocs = await tx
          .select()
          .from(schema.billAllocations)
          .where(eq(schema.billAllocations.paymentId, cheque.sourcePaymentId));
        for (const a of allocs) {
          const bill = (
            await tx
              .select()
              .from(schema.bills)
              .where(eq(schema.bills.id, a.billId))
              .limit(1)
          )[0];
          if (!bill) continue;
          const newPaid = bill.amountPaidCents - a.allocatedCents;
          const newBalance = bill.balanceDueCents + a.allocatedCents;
          await tx
            .update(schema.bills)
            .set({
              amountPaidCents: newPaid,
              balanceDueCents: newBalance,
              status: newBalance === bill.totalCents ? "posted" : "partially_paid",
              updatedAt: new Date(),
            })
            .where(eq(schema.bills.id, bill.id));
        }
      }

      return { ok: true as const, entryNumber, bounceNumber };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        NOT_FOUND: 404,
        NOT_BOUNCEABLE: 409,
        NO_BANK_ACCOUNT: 500,
        NO_HOLDING_ACCOUNT: 500,
        NO_AR_ACCOUNT: 500,
        NO_AP_ACCOUNT: 500,
        NO_BANK_FEES_ACCOUNT: 500,
      };
      return reply.status(map[result.error] ?? 500).send({ error: { code: result.error } });
    }
    return reply.send(result);
  });

  // POST /cheques/flag-stale — manual trigger of the daily flagger for just
  // this tenant. Useful for "we just migrated a pile of old cheques and want
  // to flip the already-past-due ones right now" flows. The scheduled worker
  // does this daily anyway, so this endpoint is purely a convenience.
  fastify.post("/flag-stale", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "accounting.manage");
    if (!ctx) return;

    const result = await runStaleFlaggingForTenant(rootDb, ctx.tenantId);
    return reply.send({
      flagged: result.flagged,
      cheques: result.rows.map((r) => ({
        id: r.id,
        chequeNumber: r.cheque_number,
        direction: r.direction,
        amountCents: Number(r.amount_cents),
        staleAt: r.stale_at,
      })),
    });
  });

  const ReissueSchema = z.object({
    newChequeNumber: z.string().min(1).max(32),
    newChequeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    memo: z.string().max(500).optional(),
  });

  // POST /cheques/:id/reissue — for issued-direction stale cheques.
  //
  // When our own cheque to a supplier goes stale, SL banking practice is
  // to issue a new cheque (new number, new date) for the same amount and
  // hand it over. The underlying AP obligation stays the same — we're not
  // reversing the original JE, just superseding the cheque instrument.
  //
  // Mechanics here:
  //   · Original cheque must be direction='issued' AND status='stale'
  //   · New cheque inherits supplier / amount / bank / sourcePaymentId /
  //     journalEntryIdCreate from the original (same AP leg, same JE)
  //   · Original flips to status='replaced' with replaced_by_cheque_id
  //     pointing at the new row — preserves the audit chain without
  //     reversing any ledger postings.
  //
  // Received-direction: deliberately NOT supported here. When a customer's
  // cheque to us goes stale, the workflow is "call them and get a new cheque"
  // which is a brand new receipt entry with its own JE (the prior cheque's
  // JE reversal — if it was ever posted — is handled at bounce time, not here).
  fastify.post<{ Params: { id: string } }>("/:id/reissue", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "accounting.manage");
    if (!ctx) return;

    const parsed = ReissueSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const { newChequeNumber, newChequeDate, memo } = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const original = (
        await tx
          .select()
          .from(schema.cheques)
          .where(
            and(
              eq(schema.cheques.tenantId, ctx.tenantId),
              eq(schema.cheques.id, req.params.id),
            ),
          )
          .limit(1)
      )[0];
      if (!original) return { error: "NOT_FOUND" as const };
      if (original.direction !== "issued") return { error: "NOT_ISSUED" as const };
      if (original.status !== "stale") return { error: "NOT_STALE" as const };
      if (!original.bankAccountId) return { error: "NO_BANK_ACCOUNT" as const };

      // SL convention: cheques go stale 6 months after cheque date
      const staleDate = new Date(newChequeDate + "T00:00:00Z");
      staleDate.setMonth(staleDate.getMonth() + 6);
      const newStaleAt = staleDate.toISOString().slice(0, 10);

      const now = new Date();
      const [inserted] = await tx
        .insert(schema.cheques)
        .values({
          tenantId: ctx.tenantId,
          direction: "issued",
          status: "issued",
          chequeNumber: newChequeNumber,
          chequeDate: newChequeDate,
          amountCents: original.amountCents,
          currency: original.currency,
          supplierId: original.supplierId,
          payeeName: original.payeeName,
          bankAccountId: original.bankAccountId,
          draweeBankName: original.draweeBankName,
          draweeBranchName: original.draweeBranchName,
          draweeAccountNumber: original.draweeAccountNumber,
          sourcePaymentId: original.sourcePaymentId,
          issuedAt: now,
          handedOverAt: now,
          staleAt: newStaleAt,
          journalEntryIdCreate: original.journalEntryIdCreate,
          createdByUserId: ctx.userId,
          memo: memo ?? `Reissue of stale cheque ${original.chequeNumber}`,
        })
        .returning({ id: schema.cheques.id });
      if (!inserted) return { error: "INSERT_FAILED" as const };

      await tx
        .update(schema.cheques)
        .set({
          status: "replaced",
          replacedByChequeId: inserted.id,
          updatedAt: now,
        })
        .where(eq(schema.cheques.id, original.id));

      return { ok: true as const, newChequeId: inserted.id };
    });

    if ("error" in result && result.error) {
      const code: string = result.error;
      const map: Record<string, number> = {
        NOT_FOUND: 404,
        NOT_ISSUED: 409,
        NOT_STALE: 409,
        NO_BANK_ACCOUNT: 500,
        INSERT_FAILED: 500,
      };
      const status = map[code] ?? 500;
      return reply.status(status).send({ error: { code } });
    }
    return reply.send(result);
  });
};
