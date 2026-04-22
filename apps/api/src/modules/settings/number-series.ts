import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

// Tokens accepted by number-series templates. Rendered at allocation time by
// the Postgres `format_document_number` helper — kept here only for shape
// documentation and client-side preview guard.
//
//   {PREFIX}  — the configured prefix (e.g. "INV")
//   {YYYY}    — 4-digit year  (e.g. "2026")
//   {YY}      — 2-digit year  (e.g. "26")
//   {MM}      — 2-digit month (e.g. "04")
//   {MMM}     — short month   (e.g. "Apr")
//   {MONTH}   — full month    (e.g. "April")
//   {SEQ}     — counter, left-padded to `padWidth`
//
// A template must contain {SEQ} — otherwise every generated number collides.

const ScopeSchema = z.enum(["year", "month", "global"]);
const TemplateSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((t) => t.includes("{SEQ}"), {
    message: "Template must contain {SEQ} somewhere — otherwise every number collides.",
  });

// PATCH body. All fields optional — patch semantics.
const PatchSchema = z
  .object({
    prefix: z.string().min(1).max(32).optional(),
    template: TemplateSchema.optional(),
    scope: ScopeSchema.optional(),
    padWidth: z.number().int().min(1).max(10).optional(),
    // Forward-only counter adjustment: set the current counter to `counter`,
    // so the *next* allocated number will be `counter + 1`. Going backwards
    // risks duplicates — blocked server-side.
    counter: z.number().int().min(0).optional(),
  })
  .refine(
    (v) =>
      v.prefix !== undefined ||
      v.template !== undefined ||
      v.scope !== undefined ||
      v.padWidth !== undefined ||
      v.counter !== undefined,
    { message: "No fields to update." },
  );

const PreviewSchema = z.object({
  prefix: z.string().min(1).max(32),
  template: TemplateSchema,
  padWidth: z.number().int().min(1).max(10),
  nextCounter: z.number().int().min(1),
});

interface NumberSeriesRow {
  sequenceName: string;
  displayName: string | null;
  prefix: string;
  template: string;
  scope: "year" | "month" | "global";
  padWidth: number;
  counter: number;
  currentYear: number | null;
  currentMonth: number | null;
  nextPreview: string;
  updatedAt: string;
}

export const numberSeriesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /number-series — list every configured series for the tenant with
  // the next-number preview rendered today.
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) => {
      return (await tx.execute(sql`
        SELECT
          sequence_name  AS "sequenceName",
          display_name   AS "displayName",
          prefix,
          template,
          scope,
          pad_width      AS "padWidth",
          counter,
          current_year   AS "currentYear",
          current_month  AS "currentMonth",
          updated_at     AS "updatedAt",
          format_document_number(
            template,
            prefix,
            pad_width::smallint,
            counter + 1,
            current_date
          ) AS "nextPreview"
        FROM document_sequences
        WHERE tenant_id = current_tenant_id()
        ORDER BY display_name NULLS LAST, sequence_name
      `)) as unknown as NumberSeriesRow[];
    });

    return reply.send({ series: rows });
  });

  // GET /number-series/:name — single series (useful for detail edits).
  fastify.get<{ Params: { name: string } }>(
    "/:name",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;
      const { name } = req.params;

      const row = await withTenant(ctx.tenantId, async (tx) => {
        const rows = (await tx.execute(sql`
          SELECT
            sequence_name  AS "sequenceName",
            display_name   AS "displayName",
            prefix,
            template,
            scope,
            pad_width      AS "padWidth",
            counter,
            current_year   AS "currentYear",
            current_month  AS "currentMonth",
            updated_at     AS "updatedAt",
            format_document_number(
              template,
              prefix,
              pad_width::smallint,
              counter + 1,
              current_date
            ) AS "nextPreview"
          FROM document_sequences
          WHERE tenant_id = current_tenant_id()
            AND sequence_name = ${name}
          LIMIT 1
        `)) as unknown as NumberSeriesRow[];
        return rows[0] ?? null;
      });

      if (!row) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: `No series named '${name}'.` },
        });
      }
      return reply.send({ series: row });
    },
  );

  // PATCH /number-series/:name — update prefix/template/scope/padWidth/counter.
  fastify.patch<{ Params: { name: string } }>(
    "/:name",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;
      const { name } = req.params;

      const parsed = PatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "INVALID_INPUT", issues: parsed.error.issues },
        });
      }
      const patch = parsed.data;

      const result = await withTenant(ctx.tenantId, async (tx) => {
        // Guard forward-only counter: refuse to move backwards.
        if (patch.counter !== undefined) {
          const rows = (await tx.execute(sql`
            SELECT counter FROM document_sequences
            WHERE tenant_id = current_tenant_id()
              AND sequence_name = ${name}
          `)) as unknown as Array<{ counter: number }>;
          const current = rows[0]?.counter;
          if (current === undefined) return { error: "NOT_FOUND" as const };
          if (patch.counter < current) {
            return {
              error: "COUNTER_DECREASE_BLOCKED" as const,
              current,
            };
          }
        }

        const updated = (await tx.execute(sql`
          UPDATE document_sequences
             SET prefix     = COALESCE(${patch.prefix     ?? null}::varchar, prefix),
                 template   = COALESCE(${patch.template   ?? null}::varchar, template),
                 scope      = COALESCE(${patch.scope      ?? null}::varchar, scope),
                 pad_width  = COALESCE(${patch.padWidth   ?? null}::smallint, pad_width),
                 counter    = COALESCE(${patch.counter    ?? null}::integer, counter),
                 updated_at = now()
           WHERE tenant_id = current_tenant_id()
             AND sequence_name = ${name}
           RETURNING sequence_name
        `)) as unknown as Array<{ sequence_name: string }>;

        if (updated.length === 0) return { error: "NOT_FOUND" as const };
        return { ok: true as const };
      });

      if ("error" in result) {
        if (result.error === "NOT_FOUND") {
          return reply
            .status(404)
            .send({ error: { code: "NOT_FOUND", message: `No series named '${name}'.` } });
        }
        if (result.error === "COUNTER_DECREASE_BLOCKED") {
          return reply.status(400).send({
            error: {
              code: "COUNTER_DECREASE_BLOCKED",
              message: `Counter can only move forward — current is ${result.current}.`,
            },
          });
        }
      }
      return reply.send({ ok: true });
    },
  );

  // POST /number-series/preview — render a preview for un-persisted values.
  // The settings UI calls this on every keystroke to show the effect.
  fastify.post("/preview", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = PreviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "INVALID_INPUT", issues: parsed.error.issues },
      });
    }
    const { prefix, template, padWidth, nextCounter } = parsed.data;

    const preview = await withTenant(ctx.tenantId, async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT format_document_number(
          ${template}::varchar,
          ${prefix}::varchar,
          ${padWidth}::smallint,
          ${nextCounter}::integer,
          current_date
        ) AS preview
      `)) as unknown as Array<{ preview: string }>;
      return rows[0]?.preview ?? "";
    });

    return reply.send({ preview });
  });
};
