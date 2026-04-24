import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";
import { requireFeature } from "../../lib/plan-gate.js";

// Approval workflow designer — roadmap #26 (tenant-admin §7).
//
// v1 scope: CRUD over linear approval policies, keyed to a document
// type with a simple JSON trigger rule. We store and surface them in
// the admin UI; wiring them into actual posting transitions is a
// follow-up because each domain currently has its own approval state
// machine (see scoping report). Shipping the designer + schema first
// gives the admin UI something real to configure against.

const DOCUMENT_TYPES = [
  "journal_entry",
  "expense_claim",
  "leave_request",
  "bill",
  "purchase_order",
  "invoice",
  // Roadmap #43d — payroll runs (tenant-admin §7.1 "always → Owner")
  // and bonus runs (threshold-gated, same shape as bills).
  "payroll_run",
  "bonus_run",
  // Roadmap #43e — final settlements (tenant-admin §7.1 "always →
  // Owner"; sensitive exit calc). Same always-approve shape as
  // payroll: configure a policy with an empty triggerRule and it
  // matches every submission.
  "final_settlement",
  // Roadmap #30 — purchase requisitions. Tenant-toggled module;
  // when the toggle is off the PR surface is hidden but the document
  // type stays registered so any legacy policy rows remain valid.
  "purchase_requisition",
] as const;

const ApproverSchema = z.object({
  kind: z.enum(["role", "user"]),
  id: z.string().min(1),
  label: z.string().optional(),
});

const StepSchema = z.object({
  approvers: z.array(ApproverSchema).min(1).max(10),
  anyOf: z.boolean().default(true),
});

const TriggerRuleSchema = z
  .object({
    minAmountCents: z.number().int().nonnegative().optional(),
    submitters: z.array(z.string()).optional(),
    // Purchase-order specific. See approval-engine.ts — the runtime
    // matches this against the pre-computed `isFirstPoFromSupplier`
    // flag at submit time. Ignored for other document types.
    firstPoFromSupplier: z.boolean().optional(),
  })
  .default({});

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(128),
  description: z.string().max(2000).optional(),
  documentType: z.enum(DOCUMENT_TYPES),
  triggerRule: TriggerRuleSchema,
  steps: z.array(StepSchema).min(1).max(10),
  isActive: z.boolean().default(true),
});

const UpdateSchema = CreateSchema.partial();

function toRow(p: typeof schema.approvalPolicies.$inferSelect) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    documentType: p.documentType,
    triggerRule: p.triggerRule,
    steps: p.steps,
    isActive: p.isActive,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export const approvalPoliciesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /approval-policies
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) => {
      return tx
        .select()
        .from(schema.approvalPolicies)
        .where(
          and(
            eq(schema.approvalPolicies.tenantId, ctx.tenantId),
            isNull(schema.approvalPolicies.deletedAt),
          ),
        )
        .orderBy(desc(schema.approvalPolicies.createdAt));
    });

    return reply.send({ policies: rows.map(toRow) });
  });

  // POST /approval-policies
  fastify.post("/", async (req, reply) => {
    if (!(await requireFeature(req, reply, "approval_workflows"))) return;
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }

    const row = await withTenant(ctx.tenantId, async (tx) => {
      const [inserted] = await tx
        .insert(schema.approvalPolicies)
        .values({
          tenantId: ctx.tenantId,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          documentType: parsed.data.documentType,
          triggerRule: parsed.data.triggerRule ?? {},
          steps: parsed.data.steps,
          isActive: parsed.data.isActive ?? true,
          createdByUserId: ctx.userId,
        })
        .returning();
      return inserted;
    });
    return reply.send({ policy: toRow(row!) });
  });

  // PATCH /approval-policies/:id
  fastify.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    if (!(await requireFeature(req, reply, "approval_workflows"))) return;
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;

    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }

    const row = await withTenant(ctx.tenantId, async (tx) => {
      const patch: Partial<typeof schema.approvalPolicies.$inferInsert> & {
        updatedAt: Date;
      } = { updatedAt: new Date() };
      if (parsed.data.name !== undefined) patch.name = parsed.data.name;
      if (parsed.data.description !== undefined)
        patch.description = parsed.data.description ?? null;
      if (parsed.data.documentType !== undefined)
        patch.documentType = parsed.data.documentType;
      if (parsed.data.triggerRule !== undefined)
        patch.triggerRule = parsed.data.triggerRule ?? {};
      if (parsed.data.steps !== undefined) patch.steps = parsed.data.steps;
      if (parsed.data.isActive !== undefined) patch.isActive = parsed.data.isActive;

      const [updated] = await tx
        .update(schema.approvalPolicies)
        .set(patch)
        .where(
          and(
            eq(schema.approvalPolicies.tenantId, ctx.tenantId),
            eq(schema.approvalPolicies.id, req.params.id),
            isNull(schema.approvalPolicies.deletedAt),
          ),
        )
        .returning();
      return updated;
    });

    if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send({ policy: toRow(row) });
  });

  // DELETE /approval-policies/:id — soft delete
  fastify.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    if (!(await requireFeature(req, reply, "approval_workflows"))) return;
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;

    const row = await withTenant(ctx.tenantId, async (tx) => {
      const [deleted] = await tx
        .update(schema.approvalPolicies)
        .set({ deletedAt: new Date(), isActive: false })
        .where(
          and(
            eq(schema.approvalPolicies.tenantId, ctx.tenantId),
            eq(schema.approvalPolicies.id, req.params.id),
            isNull(schema.approvalPolicies.deletedAt),
          ),
        )
        .returning({ id: schema.approvalPolicies.id });
      return deleted;
    });

    if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send({ ok: true });
  });
};
