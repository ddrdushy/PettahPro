import type { FastifyPluginAsync } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { postJournal } from "./journal-posting.js";

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

  // POST /journal-entries — create & post a manual entry
  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }

    const { entryDate, memo, lines } = parsed.data;

    // Balance check up-front so we return a clear error rather than the
    // trigger's generic one.
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
        return postJournal(tx, {
          tenantId: ctx.tenantId,
          entryDate,
          memo: memo && memo.trim() ? memo.trim() : undefined,
          sourceType: "manual",
          postedByUserId: ctx.userId,
          lines: lines.map((l) => ({
            accountId: l.accountId,
            drCents: l.drCents ?? 0,
            crCents: l.crCents ?? 0,
            description: l.description && l.description.trim() ? l.description.trim() : undefined,
            customerId: l.customerId ?? null,
            supplierId: l.supplierId ?? null,
          })),
        });
      });
      return reply.status(201).send({ ok: true, entryId: result.entryId, entryNumber: result.entryNumber });
    } catch (err) {
      const msg = (err as Error).message ?? "";
      // Fiscal-period trigger, balance trigger, FK violations all bubble here.
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
};
