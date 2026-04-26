import type { FastifyPluginAsync } from "fastify";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";

/**
 * Cost-centers CRUD (#129 / gaps B1).
 *
 *   GET    /cost-centers                — list (active + archived filter)
 *   GET    /cost-centers/:id            — single
 *   POST   /cost-centers                — create (settings.manage)
 *   PATCH  /cost-centers/:id            — update (settings.manage)
 *   DELETE /cost-centers/:id            — soft-delete (settings.manage)
 *
 * Reads are open to any authenticated tenant user — the cost-center
 * picker on the invoice form needs them, and seeing the list isn't
 * sensitive.
 *
 * Soft-delete only — hard delete would orphan journal_lines that
 * reference this cost_center_id (the FK is ON DELETE SET NULL, so it
 * wouldn't actually break anything, but we'd lose the audit trail of
 * "this line WAS tagged with X before X went away"). Soft-delete keeps
 * the row for historical filtering; the partial unique index on
 * (tenant_id, lower(code)) WHERE deleted_at IS NULL lets a cleared
 * code be re-used later.
 */

const CodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .regex(/^[A-Z0-9_-]+$/, "Code must be uppercase letters, digits, underscore, or hyphen.");

const CreateSchema = z.object({
  code: CodeSchema,
  name: z.string().trim().min(1).max(160),
  parentCostCenterId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean().default(true),
});

const UpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    parentCostCenterId: z.string().uuid().nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field is required.",
  });

function toWire(c: typeof schema.costCenters.$inferSelect) {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    parentCostCenterId: c.parentCostCenterId,
    isActive: c.isActive,
    notes: c.notes,
    deletedAt: c.deletedAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export const costCentersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const querySchema = z.object({
      includeArchived: z.enum(["true", "false"]).optional(),
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const includeArchived = parsed.data.includeArchived === "true";

    const rows = await withTenant(ctx.tenantId, async (tx) => {
      return tx
        .select()
        .from(schema.costCenters)
        .where(
          includeArchived
            ? eq(schema.costCenters.tenantId, ctx.tenantId)
            : and(
                eq(schema.costCenters.tenantId, ctx.tenantId),
                isNull(schema.costCenters.deletedAt),
              ),
        )
        .orderBy(asc(schema.costCenters.code));
    });

    return reply.send({ costCenters: rows.map(toWire) });
  });

  fastify.get("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.costCenters)
        .where(
          and(
            eq(schema.costCenters.tenantId, ctx.tenantId),
            eq(schema.costCenters.id, parsed.data.id),
          ),
        )
        .limit(1),
    );
    const row = rows[0];
    if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send({ costCenter: toWire(row) });
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

    // Code uniqueness — friendly 409 ahead of the partial-unique
    // index 500.
    const existing = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select({ id: schema.costCenters.id })
        .from(schema.costCenters)
        .where(
          and(
            eq(schema.costCenters.tenantId, ctx.tenantId),
            sql`LOWER(${schema.costCenters.code}) = LOWER(${parsed.data.code})`,
            isNull(schema.costCenters.deletedAt),
          ),
        )
        .limit(1),
    );
    if (existing.length > 0) {
      return reply.status(409).send({ error: { code: "CODE_TAKEN" } });
    }

    const [created] = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .insert(schema.costCenters)
        .values({
          tenantId: ctx.tenantId,
          code: parsed.data.code,
          name: parsed.data.name,
          parentCostCenterId: parsed.data.parentCostCenterId ?? null,
          notes: parsed.data.notes ?? null,
          isActive: parsed.data.isActive,
        })
        .returning(),
    );
    if (!created) {
      return reply.status(500).send({ error: { code: "CREATE_FAILED" } });
    }
    return reply.status(201).send({ costCenter: toWire(created) });
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

    // Prevent self-parent — DB also has a CHECK constraint, but a
    // friendly 400 is nicer than a 500.
    if (
      bodyParsed.data.parentCostCenterId === paramsParsed.data.id
    ) {
      return reply
        .status(400)
        .send({ error: { code: "SELF_PARENT" } });
    }

    const [updated] = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .update(schema.costCenters)
        .set({ ...bodyParsed.data, updatedAt: new Date() })
        .where(
          and(
            eq(schema.costCenters.tenantId, ctx.tenantId),
            eq(schema.costCenters.id, paramsParsed.data.id),
            isNull(schema.costCenters.deletedAt),
          ),
        )
        .returning(),
    );
    if (!updated) {
      return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    }
    return reply.send({ costCenter: toWire(updated) });
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
        .update(schema.costCenters)
        .set({ deletedAt: new Date(), isActive: false })
        .where(
          and(
            eq(schema.costCenters.tenantId, ctx.tenantId),
            eq(schema.costCenters.id, parsed.data.id),
            isNull(schema.costCenters.deletedAt),
          ),
        )
        .returning(),
    );
    if (!updated) {
      return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    }
    return reply.send({ ok: true });
  });
};
