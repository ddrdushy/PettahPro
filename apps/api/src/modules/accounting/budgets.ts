import type { FastifyPluginAsync } from "fastify";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";

/**
 * Budgets CRUD + lines (#133 / gaps B2).
 *
 *   GET    /budgets                  — list (auth-only)
 *   GET    /budgets/:id              — header + lines
 *   POST   /budgets                  — create header (settings.manage)
 *   PATCH  /budgets/:id              — update header (settings.manage)
 *   DELETE /budgets/:id              — soft-delete (settings.manage)
 *   PUT    /budgets/:id/lines        — replace-all lines (settings.manage)
 *
 * Lines are managed as a single replace-all PUT instead of per-line
 * CRUD because the editor UI is a spreadsheet — round-tripping every
 * cell as a separate request would be chatty and the partial unique
 * index already enforces (budget, account, cost_center) uniqueness.
 *
 * The vs-actuals report lives in /reports/budget-vs-actual (separate
 * file) since it joins against journal_lines and has its own period
 * math.
 */

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  fiscalYear: z.number().int().min(2000).max(2100),
  status: z.enum(["draft", "active", "archived"]).default("draft"),
  notes: z.string().trim().max(2000).nullable().optional(),
});

const UpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    status: z.enum(["draft", "active", "archived"]).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field is required.",
  });

const LineSchema = z.object({
  accountId: z.string().uuid(),
  costCenterId: z.string().uuid().nullable().optional(),
  amountCents: z.number().int(),
  notes: z.string().trim().max(500).nullable().optional(),
});

const ReplaceLinesSchema = z.object({
  lines: z.array(LineSchema).max(2000),
});

function budgetToWire(b: typeof schema.budgets.$inferSelect) {
  return {
    id: b.id,
    name: b.name,
    fiscalYear: b.fiscalYear,
    status: b.status,
    notes: b.notes,
    deletedAt: b.deletedAt,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

function lineToWire(l: typeof schema.budgetLines.$inferSelect) {
  return {
    id: l.id,
    budgetId: l.budgetId,
    accountId: l.accountId,
    costCenterId: l.costCenterId,
    amountCents: l.amountCents,
    notes: l.notes,
  };
}

export const budgetsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.budgets)
        .where(
          and(
            eq(schema.budgets.tenantId, ctx.tenantId),
            isNull(schema.budgets.deletedAt),
          ),
        )
        .orderBy(asc(schema.budgets.fiscalYear), asc(schema.budgets.name)),
    );
    return reply.send({ budgets: rows.map(budgetToWire) });
  });

  fastify.get("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const headerRows = await tx
        .select()
        .from(schema.budgets)
        .where(
          and(
            eq(schema.budgets.tenantId, ctx.tenantId),
            eq(schema.budgets.id, parsed.data.id),
            isNull(schema.budgets.deletedAt),
          ),
        )
        .limit(1);
      const header = headerRows[0];
      if (!header) return null;

      const lines = await tx
        .select()
        .from(schema.budgetLines)
        .where(
          and(
            eq(schema.budgetLines.tenantId, ctx.tenantId),
            eq(schema.budgetLines.budgetId, parsed.data.id),
          ),
        );
      return { budget: budgetToWire(header), lines: lines.map(lineToWire) };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  fastify.post("/", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "INVALID_INPUT",
          message: parsed.error.issues[0]?.message ?? "Invalid payload.",
        },
      });
    }

    // Active budgets are 1-per-(tenant, fiscal_year). Reject in the
    // app layer for a friendly 409 ahead of the partial unique index.
    if (parsed.data.status === "active") {
      const existing = await withTenant(ctx.tenantId, async (tx) =>
        tx
          .select({ id: schema.budgets.id })
          .from(schema.budgets)
          .where(
            and(
              eq(schema.budgets.tenantId, ctx.tenantId),
              eq(schema.budgets.fiscalYear, parsed.data.fiscalYear),
              eq(schema.budgets.status, "active"),
              isNull(schema.budgets.deletedAt),
            ),
          )
          .limit(1),
      );
      if (existing.length > 0) {
        return reply.status(409).send({
          error: {
            code: "ACTIVE_BUDGET_EXISTS",
            message: `An active budget for fiscal year ${parsed.data.fiscalYear} already exists. Archive it before activating another.`,
          },
        });
      }
    }

    const [created] = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .insert(schema.budgets)
        .values({
          tenantId: ctx.tenantId,
          name: parsed.data.name,
          fiscalYear: parsed.data.fiscalYear,
          status: parsed.data.status,
          notes: parsed.data.notes ?? null,
          createdByUserId: ctx.userId,
        })
        .returning(),
    );
    if (!created) {
      return reply.status(500).send({ error: { code: "CREATE_FAILED" } });
    }
    return reply.status(201).send({ budget: budgetToWire(created) });
  });

  fastify.patch("/:id", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;
    const paramsParsed = z
      .object({ id: z.string().uuid() })
      .safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const bodyParsed = UpdateSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return reply.status(400).send({
        error: {
          code: "INVALID_INPUT",
          message: bodyParsed.error.issues[0]?.message ?? "Invalid payload.",
        },
      });
    }

    // Activating a budget for a year that already has an active one
    // triggers the partial-unique. Pre-flight for friendliness.
    if (bodyParsed.data.status === "active") {
      const target = await withTenant(ctx.tenantId, async (tx) =>
        tx
          .select({ fiscalYear: schema.budgets.fiscalYear })
          .from(schema.budgets)
          .where(
            and(
              eq(schema.budgets.tenantId, ctx.tenantId),
              eq(schema.budgets.id, paramsParsed.data.id),
            ),
          )
          .limit(1),
      );
      const fy = target[0]?.fiscalYear;
      if (fy != null) {
        const conflict = await withTenant(ctx.tenantId, async (tx) =>
          tx
            .select({ id: schema.budgets.id })
            .from(schema.budgets)
            .where(
              and(
                eq(schema.budgets.tenantId, ctx.tenantId),
                eq(schema.budgets.fiscalYear, fy),
                eq(schema.budgets.status, "active"),
                isNull(schema.budgets.deletedAt),
              ),
            ),
        );
        const otherActive = conflict.find((r) => r.id !== paramsParsed.data.id);
        if (otherActive) {
          return reply.status(409).send({
            error: {
              code: "ACTIVE_BUDGET_EXISTS",
              message: `An active budget for fiscal year ${fy} already exists.`,
            },
          });
        }
      }
    }

    const [updated] = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .update(schema.budgets)
        .set({ ...bodyParsed.data, updatedAt: new Date() })
        .where(
          and(
            eq(schema.budgets.tenantId, ctx.tenantId),
            eq(schema.budgets.id, paramsParsed.data.id),
            isNull(schema.budgets.deletedAt),
          ),
        )
        .returning(),
    );
    if (!updated) {
      return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    }
    return reply.send({ budget: budgetToWire(updated) });
  });

  fastify.delete("/:id", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;
    const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const [updated] = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .update(schema.budgets)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(schema.budgets.tenantId, ctx.tenantId),
            eq(schema.budgets.id, parsed.data.id),
            isNull(schema.budgets.deletedAt),
          ),
        )
        .returning(),
    );
    if (!updated) {
      return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    }
    return reply.send({ ok: true });
  });

  fastify.put("/:id/lines", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;
    const paramsParsed = z
      .object({ id: z.string().uuid() })
      .safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const bodyParsed = ReplaceLinesSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return reply.status(400).send({
        error: {
          code: "INVALID_INPUT",
          message: bodyParsed.error.issues[0]?.message ?? "Invalid payload.",
        },
      });
    }

    // Deduplicate (account, cost_center) on the way in — last write
    // wins for a given combo. The DB unique index would catch dupes
    // but we'd rather pre-flight than bubble a 500.
    const seen = new Map<string, (typeof bodyParsed.data.lines)[number]>();
    for (const line of bodyParsed.data.lines) {
      const key = `${line.accountId}::${line.costCenterId ?? ""}`;
      seen.set(key, line);
    }
    const finalLines = Array.from(seen.values());

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const headerRows = await tx
        .select({ id: schema.budgets.id })
        .from(schema.budgets)
        .where(
          and(
            eq(schema.budgets.tenantId, ctx.tenantId),
            eq(schema.budgets.id, paramsParsed.data.id),
            isNull(schema.budgets.deletedAt),
          ),
        )
        .limit(1);
      if (headerRows.length === 0) return { ok: false as const };

      // Replace-all: nuke + re-insert. budget_lines has no FK
      // dependents so this is safe.
      await tx
        .delete(schema.budgetLines)
        .where(eq(schema.budgetLines.budgetId, paramsParsed.data.id));

      if (finalLines.length === 0) return { ok: true as const, lines: [] };

      const inserted = await tx
        .insert(schema.budgetLines)
        .values(
          finalLines.map((l) => ({
            tenantId: ctx.tenantId,
            budgetId: paramsParsed.data.id,
            accountId: l.accountId,
            costCenterId: l.costCenterId ?? null,
            amountCents: l.amountCents,
            notes: l.notes ?? null,
          })),
        )
        .returning();
      return { ok: true as const, lines: inserted };
    });

    if (!result.ok) {
      return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    }
    return reply.send({ lines: result.lines.map(lineToWire) });
  });
};
