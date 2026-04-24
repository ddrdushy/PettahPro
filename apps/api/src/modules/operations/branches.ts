import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, asc } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requireQuota } from "../../lib/plan-gate.js";

const CreateSchema = z.object({
  code: z.string().trim().min(1).max(16),
  name: z.string().trim().min(1).max(255),
  isHeadOffice: z.boolean().optional().default(false),
  addressLine1: z.string().trim().max(255).optional().or(z.literal("")),
  addressLine2: z.string().trim().max(255).optional().or(z.literal("")),
  city: z.string().trim().max(128).optional().or(z.literal("")),
  postalCode: z.string().trim().max(16).optional().or(z.literal("")),
  phone: z.string().trim().max(32).optional().or(z.literal("")),
});

const UpdateSchema = CreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

function emptyToNull<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = { ...input };
  for (const k of Object.keys(out)) {
    if (out[k] === "") out[k] = null;
  }
  return out as T;
}

export const branchesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /branches — list all branches for this tenant
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.branches)
        .where(
          and(
            eq(schema.branches.tenantId, ctx.tenantId),
            isNull(schema.branches.deletedAt),
          ),
        )
        .orderBy(asc(schema.branches.code)),
    );

    return reply.send({ branches: rows });
  });

  // GET /branches/:id — single branch
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const row = await withTenant(ctx.tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.branches)
        .where(
          and(
            eq(schema.branches.tenantId, ctx.tenantId),
            eq(schema.branches.id, req.params.id),
            isNull(schema.branches.deletedAt),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    });

    if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send({ branch: row });
  });

  // POST /branches — create
  fastify.post("/", async (req, reply) => {
    // Quota gate (#65). Active branches (deleted_at IS NULL) against the
    // plan's maxBranches. Starter = 1 (head office only); Growth = 3;
    // Scale = unlimited. Soft-deleted branches don't count — a tenant
    // that deletes an old branch can create a replacement.
    const ctx = await requireQuota(req, reply, "branches");
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const data = emptyToNull(parsed.data);

    try {
      const branch = await withTenant(ctx.tenantId, async (tx) => {
        // Only one head-office per tenant — demote any existing one first.
        if (data.isHeadOffice) {
          await tx
            .update(schema.branches)
            .set({ isHeadOffice: false, updatedAt: new Date() })
            .where(
              and(
                eq(schema.branches.tenantId, ctx.tenantId),
                eq(schema.branches.isHeadOffice, true),
              ),
            );
        }
        const [b] = await tx
          .insert(schema.branches)
          .values({
            tenantId: ctx.tenantId,
            code: data.code as string,
            name: data.name as string,
            isHeadOffice: data.isHeadOffice ?? false,
            addressLine1: (data.addressLine1 as string | null) ?? null,
            addressLine2: (data.addressLine2 as string | null) ?? null,
            city: (data.city as string | null) ?? null,
            postalCode: (data.postalCode as string | null) ?? null,
            phone: (data.phone as string | null) ?? null,
          })
          .returning();
        return b;
      });
      return reply.status(201).send({ branch });
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (msg.includes("branches_tenant_code_unique")) {
        return reply
          .status(409)
          .send({ error: { code: "DUPLICATE_CODE", message: "A branch with this code already exists." } });
      }
      throw err;
    }
  });

  // PATCH /branches/:id — update
  fastify.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const data = emptyToNull(parsed.data);

    try {
      const branch = await withTenant(ctx.tenantId, async (tx) => {
        const existing = await tx
          .select()
          .from(schema.branches)
          .where(
            and(
              eq(schema.branches.tenantId, ctx.tenantId),
              eq(schema.branches.id, req.params.id),
              isNull(schema.branches.deletedAt),
            ),
          )
          .limit(1);
        if (!existing[0]) return null;

        // Demote other head-office when this one is being promoted.
        if (data.isHeadOffice === true && !existing[0].isHeadOffice) {
          await tx
            .update(schema.branches)
            .set({ isHeadOffice: false, updatedAt: new Date() })
            .where(
              and(
                eq(schema.branches.tenantId, ctx.tenantId),
                eq(schema.branches.isHeadOffice, true),
              ),
            );
        }

        const patch: Partial<typeof schema.branches.$inferInsert> = {
          updatedAt: new Date(),
        };
        if (data.code !== undefined) patch.code = data.code as string;
        if (data.name !== undefined) patch.name = data.name as string;
        if (data.isHeadOffice !== undefined) patch.isHeadOffice = data.isHeadOffice as boolean;
        if (data.isActive !== undefined) patch.isActive = data.isActive as boolean;
        if (data.addressLine1 !== undefined) patch.addressLine1 = data.addressLine1 as string | null;
        if (data.addressLine2 !== undefined) patch.addressLine2 = data.addressLine2 as string | null;
        if (data.city !== undefined) patch.city = data.city as string | null;
        if (data.postalCode !== undefined) patch.postalCode = data.postalCode as string | null;
        if (data.phone !== undefined) patch.phone = data.phone as string | null;

        const [b] = await tx
          .update(schema.branches)
          .set(patch)
          .where(
            and(
              eq(schema.branches.tenantId, ctx.tenantId),
              eq(schema.branches.id, req.params.id),
            ),
          )
          .returning();
        return b ?? null;
      });

      if (!branch) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
      return reply.send({ branch });
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (msg.includes("branches_tenant_code_unique")) {
        return reply
          .status(409)
          .send({ error: { code: "DUPLICATE_CODE", message: "A branch with this code already exists." } });
      }
      throw err;
    }
  });
};
