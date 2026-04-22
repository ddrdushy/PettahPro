import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";
import { postJournal } from "./journal-posting.js";
import { loadTenantSettings } from "../settings/routes.js";
import { emitNotification } from "../notifications/emit.js";
import { recordAuditEvent } from "../../lib/audit.js";

const LineSchema = z
  .object({
    accountId: z.string().uuid(),
    drCents: z.number().int().min(0).optional().default(0),
    crCents: z.number().int().min(0).optional().default(0),
    description: z.string().trim().max(500).optional().or(z.literal("")),
    customerId: z.string().uuid().optional(),
    supplierId: z.string().uuid().optional(),
  })
  .refine((l) => (l.drCents ?? 0) > 0 || (l.crCents ?? 0) > 0, {
    message: "Each line must have a debit or credit amount",
  })
  .refine((l) => !((l.drCents ?? 0) > 0 && (l.crCents ?? 0) > 0), {
    message: "A line can't have both a debit and a credit",
  });

const CreateSchema = z.object({
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memo: z.string().trim().max(500).optional().or(z.literal("")),
  lines: z.array(LineSchema).min(2),
});

export const journalEntriesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /journal-entries?limit=&offset=
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const q = (req.query ?? {}) as { limit?: string; offset?: string };
    const limit = Math.min(Math.max(Number(q.limit ?? 50), 1), 200);
    const offset = Math.max(Number(q.offset ?? 0), 0);

    const rows = await withTenant(ctx.tenantId, async (tx) => {
      return (await tx.execute(sql`
        SELECT je.id,
               je.entry_number,
               je.entry_date::text AS entry_date,
               je.memo,
               je.source_type,
               je.source_id,
               je.is_reversed,
               je.posted_at,
               COALESCE((
                 SELECT SUM(dr_cents)::bigint
                 FROM journal_lines
                 WHERE journal_entry_id = je.id
                   AND tenant_id = je.tenant_id
               ), 0)::bigint AS total_cents,
               (
                 SELECT COUNT(*)::int
                 FROM journal_lines
                 WHERE journal_entry_id = je.id
                   AND tenant_id = je.tenant_id
               ) AS line_count
        FROM journal_entries je
        WHERE je.tenant_id = current_tenant_id()
        ORDER BY je.posted_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `)) as unknown as Array<{
        id: string;
        entry_number: string;
        entry_date: string;
        memo: string | null;
        source_type: string | null;
        source_id: string | null;
        is_reversed: boolean;
        posted_at: string;
        total_cents: number | string;
        line_count: number;
      }>;
    });

    return reply.send({
      entries: rows.map((r) => ({
        id: r.id,
        entryNumber: r.entry_number,
        entryDate: r.entry_date,
        memo: r.memo,
        sourceType: r.source_type,
        sourceId: r.source_id,
        isReversed: r.is_reversed,
        postedAt: r.posted_at,
        totalCents: Number(r.total_cents),
        lineCount: r.line_count,
      })),
    });
  });

  // GET /journal-entries/:id
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const entries = await tx
        .select()
        .from(schema.journalEntries)
        .where(
          and(
            eq(schema.journalEntries.tenantId, ctx.tenantId),
            eq(schema.journalEntries.id, req.params.id),
          ),
        )
        .limit(1);
      const entry = entries[0];
      if (!entry) return null;

      const lines = (await tx.execute(sql`
        SELECT jl.id,
               jl.line_no,
               jl.account_id,
               coa.code AS account_code,
               coa.name AS account_name,
               jl.dr_cents,
               jl.cr_cents,
               jl.description,
               jl.customer_id,
               jl.supplier_id,
               c.name AS customer_name,
               s.name AS supplier_name
        FROM journal_lines jl
        JOIN chart_of_accounts coa
          ON coa.id = jl.account_id
         AND coa.tenant_id = jl.tenant_id
        LEFT JOIN customers c
          ON c.id = jl.customer_id
         AND c.tenant_id = jl.tenant_id
        LEFT JOIN suppliers s
          ON s.id = jl.supplier_id
         AND s.tenant_id = jl.tenant_id
        WHERE jl.journal_entry_id = ${req.params.id}
          AND jl.tenant_id = current_tenant_id()
        ORDER BY jl.line_no ASC
      `)) as unknown as Array<{
        id: string;
        line_no: number;
        account_id: string;
        account_code: string;
        account_name: string;
        dr_cents: number | string;
        cr_cents: number | string;
        description: string | null;
        customer_id: string | null;
        supplier_id: string | null;
        customer_name: string | null;
        supplier_name: string | null;
      }>;

      return {
        entry: {
          id: entry.id,
          entryNumber: entry.entryNumber,
          entryDate: entry.entryDate,
          memo: entry.memo,
          sourceType: entry.sourceType,
          sourceId: entry.sourceId,
          isReversed: entry.isReversed,
          postedAt: entry.postedAt,
        },
        lines: lines.map((l) => ({
          id: l.id,
          lineNo: l.line_no,
          accountId: l.account_id,
          accountCode: l.account_code,
          accountName: l.account_name,
          drCents: Number(l.dr_cents),
          crCents: Number(l.cr_cents),
          description: l.description,
          customerId: l.customer_id,
          customerName: l.customer_name,
          supplierId: l.supplier_id,
          supplierName: l.supplier_name,
        })),
      };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  // POST /journal-entries — create & post a manual entry. When total >= the
  // tenant's journalApprovalThresholdCents, this instead parks the entry
  // as a draft in journal_entry_drafts pending approval.
  fastify.post("/", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "accounting.manage");
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }

    const { entryDate, memo, lines } = parsed.data;

    const drTotal = lines.reduce((s, l) => s + (l.drCents ?? 0), 0);
    const crTotal = lines.reduce((s, l) => s + (l.crCents ?? 0), 0);
    if (drTotal === 0) {
      return reply
        .status(400)
        .send({ error: { code: "UNBALANCED", message: "Entry has no debit amounts." } });
    }
    if (drTotal !== crTotal) {
      return reply.status(400).send({
        error: {
          code: "UNBALANCED",
          message: `Debits (${drTotal}) don't equal credits (${crTotal}).`,
        },
      });
    }

    try {
      const result = await withTenant(ctx.tenantId, async (tx) => {
        const settings = await loadTenantSettings(tx);
        const threshold = settings.journalApprovalThresholdCents;
        const needsApproval = threshold > 0 && drTotal >= threshold;

        const normLines = lines.map((l) => ({
          accountId: l.accountId,
          drCents: l.drCents ?? 0,
          crCents: l.crCents ?? 0,
          description: l.description && l.description.trim() ? l.description.trim() : null,
          customerId: l.customerId ?? null,
          supplierId: l.supplierId ?? null,
        }));

        if (needsApproval) {
          const [draft] = await tx
            .insert(schema.journalEntryDrafts)
            .values({
              tenantId: ctx.tenantId,
              entryDate,
              memo: memo && memo.trim() ? memo.trim() : null,
              totalCents: drTotal,
              payload: { lines: normLines },
              createdByUserId: ctx.userId,
            })
            .returning();
          if (!draft) throw new Error("Draft insert failed");

          await emitNotification(tx, {
            tenantId: ctx.tenantId,
            kind: "je_approval_pending",
            title: `Journal entry pending approval · ${(drTotal / 100).toFixed(2)}`,
            body: memo && memo.trim() ? memo.trim() : `Entry dated ${entryDate}`,
            refType: "journal_entry_draft",
            refId: draft.id,
          });

          return {
            status: "pending_approval" as const,
            draftId: draft.id,
            thresholdCents: threshold,
            totalCents: drTotal,
          };
        }

        const posted = await postJournal(tx, {
          tenantId: ctx.tenantId,
          entryDate,
          memo: memo && memo.trim() ? memo.trim() : undefined,
          sourceType: "manual",
          postedByUserId: ctx.userId,
          lines: normLines.map((l) => ({
            ...l,
            description: l.description ?? undefined,
          })),
        });
        await recordAuditEvent(tx, {
          kind: "journal.post",
          summary: `Posted manual journal ${posted.entryNumber} · ${(drTotal / 100).toFixed(2)}`,
          refType: "journal_entry",
          refId: posted.entryId,
          diff: {
            entryNumber: posted.entryNumber,
            entryDate,
            memo: memo && memo.trim() ? memo.trim() : null,
            totalCents: drTotal,
            lineCount: normLines.length,
          },
          actorUserId: ctx.userId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers["user-agent"] ?? null,
        });
        return {
          status: "posted" as const,
          entryId: posted.entryId,
          entryNumber: posted.entryNumber,
        };
      });
      return reply.status(201).send({ ok: true, ...result });
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (msg.toLowerCase().includes("fiscal period")) {
        return reply
          .status(400)
          .send({ error: { code: "CLOSED_PERIOD", message: "Entry falls in a closed fiscal period." } });
      }
      if (msg.toLowerCase().includes("unbalanced") || msg.includes("drTotal")) {
        return reply.status(400).send({ error: { code: "UNBALANCED", message: msg } });
      }
      throw err;
    }
  });

  // GET /journal-entries/drafts — pending + recently-decided drafts.
  fastify.get("/drafts", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const drafts = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.journalEntryDrafts)
        .where(eq(schema.journalEntryDrafts.tenantId, ctx.tenantId))
        .orderBy(desc(schema.journalEntryDrafts.createdAt))
        .limit(200),
    );
    return reply.send({ drafts });
  });

  // POST /journal-entries/drafts/:id/approve — post via postJournal, link
  // the posted entry back, flip status. Approver can't be the creator
  // (segregation of duties).
  fastify.post<{ Params: { id: string } }>("/drafts/:id/approve", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "accounting.manage");
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [draft] = await tx
        .select()
        .from(schema.journalEntryDrafts)
        .where(
          and(
            eq(schema.journalEntryDrafts.tenantId, ctx.tenantId),
            eq(schema.journalEntryDrafts.id, req.params.id),
          ),
        )
        .limit(1);
      if (!draft) return { error: "NOT_FOUND" as const };
      if (draft.status !== "pending_approval") return { error: "NOT_PENDING" as const };
      if (draft.createdByUserId === ctx.userId) return { error: "SELF_APPROVAL" as const };

      const { entryId, entryNumber } = await postJournal(tx, {
        tenantId: ctx.tenantId,
        entryDate: draft.entryDate,
        memo: draft.memo ?? undefined,
        sourceType: "manual",
        sourceId: draft.id,
        postedByUserId: ctx.userId,
        lines: draft.payload.lines.map((l) => ({
          accountId: l.accountId,
          drCents: l.drCents,
          crCents: l.crCents,
          description: l.description ?? undefined,
          customerId: l.customerId ?? null,
          supplierId: l.supplierId ?? null,
        })),
      });

      await tx
        .update(schema.journalEntryDrafts)
        .set({
          status: "approved",
          approvedByUserId: ctx.userId,
          approvedAt: new Date(),
          postedJournalEntryId: entryId,
          updatedAt: new Date(),
        })
        .where(eq(schema.journalEntryDrafts.id, draft.id));

      if (draft.createdByUserId) {
        await emitNotification(tx, {
          tenantId: ctx.tenantId,
          userId: draft.createdByUserId,
          kind: "je_approved",
          title: `Journal entry approved · ${entryNumber}`,
          body: draft.memo ?? null,
          refType: "journal_entry",
          refId: entryId,
        });
      }

      await recordAuditEvent(tx, {
        kind: "journal.approve",
        summary: `Approved journal ${entryNumber} · ${(draft.totalCents / 100).toFixed(2)}`,
        refType: "journal_entry",
        refId: entryId,
        diff: {
          draftId: draft.id,
          entryNumber,
          entryDate: draft.entryDate,
          memo: draft.memo,
          totalCents: draft.totalCents,
          createdByUserId: draft.createdByUserId,
        },
        actorUserId: ctx.userId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return { ok: true as const, entryId, entryNumber };
    });

    if ("error" in result) {
      const map: Record<string, number> = {
        NOT_FOUND: 404,
        NOT_PENDING: 409,
        SELF_APPROVAL: 409,
      };
      const msgs: Record<string, string> = {
        NOT_PENDING: "This draft isn't pending approval.",
        SELF_APPROVAL: "You can't approve a journal entry you created yourself — ask someone else.",
      };
      const code = result.error as string;
      return reply.status(map[code] ?? 500).send({ error: { code, message: msgs[code] ?? code } });
    }
    return reply.send(result);
  });

  // POST /journal-entries/drafts/:id/reject — shelve with reason.
  fastify.post<{ Params: { id: string }; Body: { reason: string } }>(
    "/drafts/:id/reject",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "accounting.manage");
      if (!ctx) return;
      const reason = (req.body?.reason ?? "").trim();
      if (!reason) {
        return reply
          .status(400)
          .send({ error: { code: "REASON_REQUIRED", message: "Reason is required." } });
      }

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [draft] = await tx
          .select()
          .from(schema.journalEntryDrafts)
          .where(
            and(
              eq(schema.journalEntryDrafts.tenantId, ctx.tenantId),
              eq(schema.journalEntryDrafts.id, req.params.id),
            ),
          )
          .limit(1);
        if (!draft) return { error: "NOT_FOUND" as const };
        if (draft.status !== "pending_approval") return { error: "NOT_PENDING" as const };

        await tx
          .update(schema.journalEntryDrafts)
          .set({
            status: "rejected",
            rejectedByUserId: ctx.userId,
            rejectedAt: new Date(),
            rejectionReason: reason,
            updatedAt: new Date(),
          })
          .where(eq(schema.journalEntryDrafts.id, draft.id));

        if (draft.createdByUserId) {
          await emitNotification(tx, {
            tenantId: ctx.tenantId,
            userId: draft.createdByUserId,
            kind: "je_rejected",
            title: `Journal entry rejected · ${(draft.totalCents / 100).toFixed(2)}`,
            body: reason,
            refType: "journal_entry_draft",
            refId: draft.id,
          });
        }

        await recordAuditEvent(tx, {
          kind: "journal.reject",
          summary: `Rejected journal draft · ${(draft.totalCents / 100).toFixed(2)} · ${reason}`,
          refType: "journal_entry_draft",
          refId: draft.id,
          diff: {
            draftId: draft.id,
            entryDate: draft.entryDate,
            memo: draft.memo,
            totalCents: draft.totalCents,
            createdByUserId: draft.createdByUserId,
            reason,
          },
          actorUserId: ctx.userId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers["user-agent"] ?? null,
        });

        return { ok: true as const };
      });

      if ("error" in result) {
        const map: Record<string, number> = {
          NOT_FOUND: 404,
          NOT_PENDING: 409,
        };
        const code = result.error as string;
        return reply.status(map[code] ?? 500).send({ error: { code } });
      }
      return reply.send(result);
    },
  );
};
