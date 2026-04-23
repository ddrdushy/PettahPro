import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, asc, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";
import { withTenant, schema, nextDocumentNumber } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";
import { recordAuditEvent } from "../../lib/audit.js";
import { loadTenantSettings } from "../settings/routes.js";
import {
  cancelApprovalRequest,
  createApprovalRequest,
  resolveApplicablePolicy,
} from "../admin/approval-engine.js";

// Purchase Requisitions (roadmap #30) — internal "request to buy"
// document routed through the generic approval engine and converted
// to a Purchase Order once approved.
//
// Tenant-gated: every mutating endpoint (and the list/detail reads)
// returns 403 FEATURE_DISABLED unless settings.purchaseRequisitionsEnabled
// is true. Policies stay registered even when the toggle is off so a
// tenant can toggle back on without losing configuration.
//
// Lifecycle mirrors the final-settlement / PO shape:
//
//   draft → (submit) → [pending_approval | approved]
//                             ↓              ↓
//                       (engine approve) → approved
//                             ↓              ↓
//                       rejected | cancelled | converted
//
// Partial approval: individual lines can be marked rejected at approve
// time via `rejectedLineIds`. Header flips to 'approved' if at least one
// line remains approved, else 'rejected'.
//
// SOD: the submitter may not self-approve (enforced in /approve handler
// before handing off to the engine or the core helper).

type Tx = PostgresJsDatabase<typeof schema>;

// ──────────────────────────────────────────────────────────────────────────────
// Schemas
// ──────────────────────────────────────────────────────────────────────────────

const LineSchema = z.object({
  itemId: z.string().uuid().optional(),
  description: z.string().trim().min(1).max(500),
  quantity: z.number().positive().max(1_000_000),
  estimatedUnitPriceCents: z.number().int().min(0).optional(),
});

const CreateSchema = z.object({
  branchId: z.string().uuid().optional(),
  preferredSupplierId: z.string().uuid().optional(),
  neededByDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  currency: z.string().length(3).optional(),
  purpose: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(LineSchema).min(1).max(200),
});

const PatchSchema = z.object({
  branchId: z.string().uuid().nullable().optional(),
  preferredSupplierId: z.string().uuid().nullable().optional(),
  neededByDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  currency: z.string().length(3).optional(),
  purpose: z.string().trim().max(2000).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  lines: z.array(LineSchema).min(1).max(200).optional(),
});

const ApproveSchema = z
  .object({
    // Lines to reject. Lines not listed here keep their current status
    // (or flip to 'approved' if still 'pending').
    rejectedLineIds: z.array(z.string().uuid()).optional().default([]),
    // Optional per-line rejection reasons, keyed by lineId. Applied only
    // to ids also present in rejectedLineIds. Extra keys are ignored.
    lineRejectReasons: z.record(z.string().trim().max(500)).optional(),
  })
  .default({ rejectedLineIds: [], lineRejectReasons: {} });

const RejectSchema = z.object({
  reason: z.string().trim().max(2000).optional(),
});

const CancelSchema = z.object({
  reason: z.string().trim().max(2000).optional(),
});

const ConvertSchema = z.object({
  // Convert-to-PO requires a supplier — if the PR carried a preferred
  // supplier the client may omit this; otherwise required.
  supplierId: z.string().uuid().optional(),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expectedDeliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().trim().max(2000).optional(),
});

// ──────────────────────────────────────────────────────────────────────────────
// Core helper — flip pending_approval → approved. Used by:
//   · The immediate `/approve` route (no policy), passing `["draft"]`.
//   · The approval-engine finaliser when the final step approves a PR
//     request, passing `["pending_approval"]`.
// Both paths share the partial-approval line stamping.
// ──────────────────────────────────────────────────────────────────────────────

export type ApprovePrError = "NOT_FOUND" | "BAD_STATUS" | "ALL_LINES_REJECTED";

export async function approvePurchaseRequisitionCore(
  tx: Tx,
  input: {
    tenantId: string;
    purchaseRequisitionId: string;
    approverUserId: string;
    allowStatuses: readonly string[];
    rejectedLineIds?: readonly string[];
    lineRejectReasons?: Record<string, string>;
  },
): Promise<
  | {
      ok: true;
      pr: typeof schema.purchaseRequisitions.$inferSelect;
      finalStatus: "approved" | "rejected";
    }
  | { error: ApprovePrError }
> {
  const {
    tenantId,
    purchaseRequisitionId,
    approverUserId,
    allowStatuses,
    rejectedLineIds = [],
    lineRejectReasons = {},
  } = input;

  const [pr] = await tx
    .select()
    .from(schema.purchaseRequisitions)
    .where(
      and(
        eq(schema.purchaseRequisitions.tenantId, tenantId),
        eq(schema.purchaseRequisitions.id, purchaseRequisitionId),
        isNull(schema.purchaseRequisitions.deletedAt),
      ),
    )
    .limit(1);
  if (!pr) return { error: "NOT_FOUND" };
  if (!allowStatuses.includes(pr.status)) return { error: "BAD_STATUS" };

  const lines = await tx
    .select()
    .from(schema.purchaseRequisitionLines)
    .where(
      and(
        eq(schema.purchaseRequisitionLines.tenantId, tenantId),
        eq(schema.purchaseRequisitionLines.purchaseRequisitionId, pr.id),
      ),
    )
    .orderBy(asc(schema.purchaseRequisitionLines.lineNo));

  const rejectSet = new Set(rejectedLineIds);
  // Safety: ignore ids that don't belong to this PR.
  const validRejectIds = lines
    .filter((l) => rejectSet.has(l.id))
    .map((l) => l.id);

  // Stamp per-line statuses. If every line is rejected we fail fast —
  // the caller should either leave at least one line approved or use the
  // /reject endpoint instead.
  const approvedLineCount = lines.filter((l) => !rejectSet.has(l.id)).length;
  if (approvedLineCount === 0) return { error: "ALL_LINES_REJECTED" };

  if (validRejectIds.length > 0) {
    // Set each rejected line individually (Drizzle doesn't have a batch
    // per-row update). In practice the list is small — usually 0-5.
    for (const lineId of validRejectIds) {
      await tx
        .update(schema.purchaseRequisitionLines)
        .set({
          lineStatus: "rejected",
          lineRejectedReason: lineRejectReasons[lineId]?.trim() || null,
        })
        .where(eq(schema.purchaseRequisitionLines.id, lineId));
    }
  }
  // Flip all still-pending lines to approved.
  await tx
    .update(schema.purchaseRequisitionLines)
    .set({ lineStatus: "approved" })
    .where(
      and(
        eq(schema.purchaseRequisitionLines.purchaseRequisitionId, pr.id),
        eq(schema.purchaseRequisitionLines.lineStatus, "pending"),
      ),
    );

  const finalStatus: "approved" | "rejected" = "approved";

  const [updated] = await tx
    .update(schema.purchaseRequisitions)
    .set({
      status: finalStatus,
      approvedAt: new Date(),
      approvedByUserId: approverUserId,
      // Clear the engine handle so /cancel and /convert don't read it as
      // still-engine-owned. The approval_request row stays in its own
      // 'approved' terminal state as the audit trail.
      approvalRequestId: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.purchaseRequisitions.id, pr.id))
    .returning();

  await recordAuditEvent(tx, {
    kind: "purchase_requisition.approved",
    summary: `Approved ${pr.prNumber ?? "draft PR"} (${approvedLineCount}/${lines.length} lines)`,
    refType: "purchase_requisition",
    refId: pr.id,
    diff: {
      priorStatus: pr.status,
      finalStatus,
      rejectedLineIds: validRejectIds,
      approvedLineCount,
      totalLineCount: lines.length,
    },
    actorUserId: approverUserId,
    ipAddress: null,
    userAgent: null,
  });

  return { ok: true, pr: updated!, finalStatus };
}

// ──────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────────

async function guardEnabled(
  tx: Tx,
  reply: { status: (c: number) => { send: (b: unknown) => unknown } },
): Promise<boolean> {
  const settings = await loadTenantSettings(tx);
  if (!settings.purchaseRequisitionsEnabled) {
    reply.status(403).send({
      error: {
        code: "FEATURE_DISABLED",
        message:
          "Purchase requisitions are disabled for this tenant. Enable them from Settings.",
      },
    });
    return false;
  }
  return true;
}

function computeEstimatedTotal(
  lines: Array<{ quantity: number; estimatedUnitPriceCents?: number | null }>,
): number {
  return lines.reduce((total, l) => {
    const unit = l.estimatedUnitPriceCents ?? 0;
    return total + Math.round(l.quantity * unit);
  }, 0);
}

// Canonical row shape returned to the UI. Keeping the reads explicit
// (rather than dumping the full row) gives the web types a stable
// surface and lets us drop internal columns in future.
function projectPr(pr: typeof schema.purchaseRequisitions.$inferSelect) {
  return {
    id: pr.id,
    prNumber: pr.prNumber,
    status: pr.status,
    branchId: pr.branchId,
    preferredSupplierId: pr.preferredSupplierId,
    neededByDate: pr.neededByDate,
    currency: pr.currency,
    estimatedTotalCents: pr.estimatedTotalCents,
    purpose: pr.purpose,
    notes: pr.notes,
    submittedAt: pr.submittedAt,
    submittedByUserId: pr.submittedByUserId,
    approvedAt: pr.approvedAt,
    approvedByUserId: pr.approvedByUserId,
    rejectedAt: pr.rejectedAt,
    rejectedByUserId: pr.rejectedByUserId,
    rejectedReason: pr.rejectedReason,
    cancelledAt: pr.cancelledAt,
    cancelledReason: pr.cancelledReason,
    convertedAt: pr.convertedAt,
    convertedPoId: pr.convertedPoId,
    approvalRequestId: pr.approvalRequestId,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    createdByUserId: pr.createdByUserId,
  };
}

function projectLine(
  line: typeof schema.purchaseRequisitionLines.$inferSelect,
) {
  return {
    id: line.id,
    lineNo: line.lineNo,
    itemId: line.itemId,
    description: line.description,
    quantity: Number(line.quantity),
    estimatedUnitPriceCents: line.estimatedUnitPriceCents,
    estimatedLineTotalCents: line.estimatedLineTotalCents,
    lineStatus: line.lineStatus,
    lineRejectedReason: line.lineRejectedReason,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────────────────────

export const purchaseRequisitionsRoutes: FastifyPluginAsync = async (
  fastify,
) => {
  // GET /purchase-requisitions — list (most recent first).
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      if (!(await guardEnabled(tx, reply))) return null;

      const rows = await tx
        .select()
        .from(schema.purchaseRequisitions)
        .where(
          and(
            eq(schema.purchaseRequisitions.tenantId, ctx.tenantId),
            isNull(schema.purchaseRequisitions.deletedAt),
          ),
        )
        .orderBy(desc(schema.purchaseRequisitions.createdAt))
        .limit(200);

      return { purchaseRequisitions: rows.map(projectPr) };
    });

    if (result === null) return; // guardEnabled already replied
    return reply.send(result);
  });

  // GET /purchase-requisitions/:id
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      if (!(await guardEnabled(tx, reply))) return null;

      const [pr] = await tx
        .select()
        .from(schema.purchaseRequisitions)
        .where(
          and(
            eq(schema.purchaseRequisitions.tenantId, ctx.tenantId),
            eq(schema.purchaseRequisitions.id, req.params.id),
            isNull(schema.purchaseRequisitions.deletedAt),
          ),
        )
        .limit(1);
      if (!pr) return { error: "NOT_FOUND" as const };

      const lines = await tx
        .select()
        .from(schema.purchaseRequisitionLines)
        .where(
          and(
            eq(schema.purchaseRequisitionLines.tenantId, ctx.tenantId),
            eq(schema.purchaseRequisitionLines.purchaseRequisitionId, pr.id),
          ),
        )
        .orderBy(asc(schema.purchaseRequisitionLines.lineNo));

      return {
        purchaseRequisition: projectPr(pr),
        lines: lines.map(projectLine),
      };
    });

    if (result === null) return;
    if ("error" in result) {
      return reply
        .status(404)
        .send({ error: { code: "NOT_FOUND", message: "PR not found." } });
    }
    return reply.send(result);
  });

  // POST /purchase-requisitions — create draft.
  fastify.post("/", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "purchase_requisitions.manage");
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const body = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      if (!(await guardEnabled(tx, reply))) return null;

      // Derive the estimated line totals + header total up front.
      const computedLines = body.lines.map((l, idx) => ({
        lineNo: idx + 1,
        itemId: l.itemId ?? null,
        description: l.description,
        quantity: l.quantity,
        estimatedUnitPriceCents: l.estimatedUnitPriceCents ?? null,
        estimatedLineTotalCents:
          l.estimatedUnitPriceCents != null
            ? Math.round(l.quantity * l.estimatedUnitPriceCents)
            : 0,
      }));
      const estimatedTotalCents = computedLines.reduce(
        (s, l) => s + l.estimatedLineTotalCents,
        0,
      );

      const [pr] = await tx
        .insert(schema.purchaseRequisitions)
        .values({
          tenantId: ctx.tenantId,
          branchId: body.branchId ?? null,
          preferredSupplierId: body.preferredSupplierId ?? null,
          status: "draft",
          neededByDate: body.neededByDate ?? null,
          currency: body.currency ?? "LKR",
          estimatedTotalCents,
          purpose: body.purpose ?? null,
          notes: body.notes ?? null,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!pr) return { error: "INSERT_FAILED" as const };

      await tx.insert(schema.purchaseRequisitionLines).values(
        computedLines.map((l) => ({
          tenantId: ctx.tenantId,
          purchaseRequisitionId: pr.id,
          lineNo: l.lineNo,
          itemId: l.itemId,
          description: l.description,
          quantity: String(l.quantity),
          estimatedUnitPriceCents: l.estimatedUnitPriceCents,
          estimatedLineTotalCents: l.estimatedLineTotalCents,
          lineStatus: "pending",
        })),
      );

      await recordAuditEvent(tx, {
        kind: "purchase_requisition.created",
        summary: `Created draft PR (${computedLines.length} lines)`,
        refType: "purchase_requisition",
        refId: pr.id,
        diff: {
          estimatedTotalCents,
          lineCount: computedLines.length,
        },
        actorUserId: ctx.userId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return { purchaseRequisition: projectPr(pr) };
    });

    if (result === null) return;
    if ("error" in result) {
      return reply.status(500).send({ error: { code: result.error } });
    }
    return reply.status(201).send(result);
  });

  // PATCH /purchase-requisitions/:id — edit draft. If the PR is in
  // rejected state it auto-resets to draft on edit so the submitter can
  // iterate cleanly (same pattern as expense claims / JE drafts).
  fastify.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "purchase_requisitions.manage");
    if (!ctx) return;

    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const body = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      if (!(await guardEnabled(tx, reply))) return null;

      const [pr] = await tx
        .select()
        .from(schema.purchaseRequisitions)
        .where(
          and(
            eq(schema.purchaseRequisitions.tenantId, ctx.tenantId),
            eq(schema.purchaseRequisitions.id, req.params.id),
            isNull(schema.purchaseRequisitions.deletedAt),
          ),
        )
        .limit(1);
      if (!pr) return { error: "NOT_FOUND" as const };
      if (!["draft", "rejected"].includes(pr.status)) {
        return { error: "NOT_EDITABLE" as const };
      }

      let estimatedTotalCents = pr.estimatedTotalCents;

      if (body.lines) {
        // Replace line set wholesale on edit — matches the expense-claim
        // edit shape. Simpler than diff-and-patch and the UI rebuilds
        // the array anyway.
        const computedLines = body.lines.map((l, idx) => ({
          lineNo: idx + 1,
          itemId: l.itemId ?? null,
          description: l.description,
          quantity: l.quantity,
          estimatedUnitPriceCents: l.estimatedUnitPriceCents ?? null,
          estimatedLineTotalCents:
            l.estimatedUnitPriceCents != null
              ? Math.round(l.quantity * l.estimatedUnitPriceCents)
              : 0,
        }));
        estimatedTotalCents = computedLines.reduce(
          (s, l) => s + l.estimatedLineTotalCents,
          0,
        );

        await tx
          .delete(schema.purchaseRequisitionLines)
          .where(
            eq(schema.purchaseRequisitionLines.purchaseRequisitionId, pr.id),
          );
        await tx.insert(schema.purchaseRequisitionLines).values(
          computedLines.map((l) => ({
            tenantId: ctx.tenantId,
            purchaseRequisitionId: pr.id,
            lineNo: l.lineNo,
            itemId: l.itemId,
            description: l.description,
            quantity: String(l.quantity),
            estimatedUnitPriceCents: l.estimatedUnitPriceCents,
            estimatedLineTotalCents: l.estimatedLineTotalCents,
            lineStatus: "pending",
          })),
        );
      }

      const updates: Partial<typeof schema.purchaseRequisitions.$inferInsert> = {
        updatedAt: new Date(),
        estimatedTotalCents,
      };
      if (body.branchId !== undefined) updates.branchId = body.branchId;
      if (body.preferredSupplierId !== undefined) {
        updates.preferredSupplierId = body.preferredSupplierId;
      }
      if (body.neededByDate !== undefined) {
        updates.neededByDate = body.neededByDate;
      }
      if (body.currency !== undefined) updates.currency = body.currency;
      if (body.purpose !== undefined) updates.purpose = body.purpose;
      if (body.notes !== undefined) updates.notes = body.notes;
      if (pr.status === "rejected") {
        // Reset to draft on edit so the submitter can re-submit.
        updates.status = "draft";
        updates.rejectedAt = null;
        updates.rejectedByUserId = null;
        updates.rejectedReason = null;
      }

      const [updated] = await tx
        .update(schema.purchaseRequisitions)
        .set(updates)
        .where(eq(schema.purchaseRequisitions.id, pr.id))
        .returning();

      return { purchaseRequisition: projectPr(updated!) };
    });

    if (result === null) return;
    if ("error" in result) {
      const map: Record<string, { status: number; message: string }> = {
        NOT_FOUND: { status: 404, message: "PR not found." },
        NOT_EDITABLE: {
          status: 409,
          message: "Only draft or rejected PRs can be edited.",
        },
      };
      const m = map[result.error as keyof typeof map];
      return reply
        .status(m?.status ?? 400)
        .send({ error: { code: result.error, message: m?.message ?? null } });
    }
    return reply.send(result);
  });

  // POST /purchase-requisitions/:id/submit — stamp submittedAt, keep in
  // draft so that a second /approve call is still required. Kept as a
  // distinct step so the UI can show a "submitted" pill distinct from
  // "approved" for tenants without a policy.
  fastify.post<{ Params: { id: string } }>("/:id/submit", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "purchase_requisitions.manage");
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      if (!(await guardEnabled(tx, reply))) return null;

      const [pr] = await tx
        .select()
        .from(schema.purchaseRequisitions)
        .where(
          and(
            eq(schema.purchaseRequisitions.tenantId, ctx.tenantId),
            eq(schema.purchaseRequisitions.id, req.params.id),
            isNull(schema.purchaseRequisitions.deletedAt),
          ),
        )
        .limit(1);
      if (!pr) return { error: "NOT_FOUND" as const };
      if (pr.status !== "draft") return { error: "NOT_DRAFT" as const };

      const [updated] = await tx
        .update(schema.purchaseRequisitions)
        .set({
          submittedAt: new Date(),
          submittedByUserId: ctx.userId,
          updatedAt: new Date(),
        })
        .where(eq(schema.purchaseRequisitions.id, pr.id))
        .returning();

      await recordAuditEvent(tx, {
        kind: "purchase_requisition.submitted",
        summary: `Submitted PR for approval`,
        refType: "purchase_requisition",
        refId: pr.id,
        diff: { estimatedTotalCents: pr.estimatedTotalCents },
        actorUserId: ctx.userId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return { purchaseRequisition: projectPr(updated!) };
    });

    if (result === null) return;
    if ("error" in result) {
      const map: Record<string, { status: number; message: string }> = {
        NOT_FOUND: { status: 404, message: "PR not found." },
        NOT_DRAFT: { status: 409, message: "Only draft PRs can be submitted." },
      };
      const m = map[result.error as keyof typeof map];
      return reply
        .status(m?.status ?? 400)
        .send({ error: { code: result.error, message: m?.message ?? null } });
    }
    return reply.send(result);
  });

  // POST /purchase-requisitions/:id/approve — dual path. If a policy
  // matches, park in pending_approval + hand off to the engine. Else
  // flip directly to approved via approvePurchaseRequisitionCore.
  fastify.post<{ Params: { id: string } }>("/:id/approve", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "purchase_requisitions.manage");
    if (!ctx) return;

    const parsed = ApproveSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const { rejectedLineIds, lineRejectReasons } = parsed.data;

    const outcome = await withTenant(ctx.tenantId, async (tx) => {
      if (!(await guardEnabled(tx, reply))) return null;

      const [pr] = await tx
        .select()
        .from(schema.purchaseRequisitions)
        .where(
          and(
            eq(schema.purchaseRequisitions.tenantId, ctx.tenantId),
            eq(schema.purchaseRequisitions.id, req.params.id),
            isNull(schema.purchaseRequisitions.deletedAt),
          ),
        )
        .limit(1);
      if (!pr) return { error: "NOT_FOUND" as const };
      if (pr.approvalRequestId) return { error: "ENGINE_OWNED" as const };
      if (pr.status !== "draft") return { error: "NOT_DRAFT" as const };

      // SOD: submitter may not also be the approver when acting on a
      // policy-matched path. For the direct (no-policy) path we keep
      // the gate too — tenants who want a self-approve loop can simply
      // not configure SOD. In practice we just refuse both.
      if (pr.submittedByUserId && pr.submittedByUserId === ctx.userId) {
        return { error: "SELF_APPROVAL" as const };
      }

      const policy = await resolveApplicablePolicy(tx, {
        documentType: "purchase_requisition",
        amountCents: pr.estimatedTotalCents,
        submitterUserId: pr.submittedByUserId ?? pr.createdByUserId ?? ctx.userId,
      });

      if (policy) {
        const request = await createApprovalRequest(tx, {
          tenantId: ctx.tenantId,
          documentType: "purchase_requisition",
          documentId: pr.id,
          amountCents: pr.estimatedTotalCents,
          policyId: policy.policyId,
          steps: policy.steps,
          submitterUserId:
            pr.submittedByUserId ?? pr.createdByUserId ?? ctx.userId,
        });
        await tx
          .update(schema.purchaseRequisitions)
          .set({
            status: "pending_approval",
            approvalRequestId: request.id,
            updatedAt: new Date(),
          })
          .where(eq(schema.purchaseRequisitions.id, pr.id));
        return { parked: true as const, requestId: request.id };
      }

      const applied = await approvePurchaseRequisitionCore(tx, {
        tenantId: ctx.tenantId,
        purchaseRequisitionId: pr.id,
        approverUserId: ctx.userId,
        allowStatuses: ["draft"],
        rejectedLineIds,
        lineRejectReasons: lineRejectReasons ?? {},
      });
      if ("error" in applied) return { error: applied.error };
      return {
        parked: false as const,
        pr: projectPr(applied.pr),
        finalStatus: applied.finalStatus,
      };
    });

    if (outcome === null) return;
    if ("error" in outcome) {
      const map: Record<string, { status: number; message: string }> = {
        NOT_FOUND: { status: 404, message: "PR not found." },
        ENGINE_OWNED: {
          status: 409,
          message:
            "This PR is managed by the approval engine. Decide it from the Approvals queue.",
        },
        NOT_DRAFT: { status: 409, message: "Only draft PRs can be approved." },
        SELF_APPROVAL: {
          status: 409,
          message: "You cannot approve a PR you submitted.",
        },
        BAD_STATUS: { status: 409, message: "PR status changed. Reload." },
        ALL_LINES_REJECTED: {
          status: 400,
          message:
            "Every line was marked rejected. Use /reject to reject the whole PR instead.",
        },
      };
      const m = map[outcome.error as keyof typeof map];
      return reply
        .status(m?.status ?? 400)
        .send({ error: { code: outcome.error, message: m?.message ?? null } });
    }
    if (outcome.parked) {
      return reply.send({
        ok: true,
        parked: true,
        approvalRequestId: outcome.requestId,
      });
    }
    return reply.send({
      ok: true,
      purchaseRequisition: outcome.pr,
      finalStatus: outcome.finalStatus,
    });
  });

  // POST /purchase-requisitions/:id/reject — mark all pending lines as
  // rejected, flip header to 'rejected'. Only valid from 'draft' (the
  // engine-owned path goes through the Approvals queue reject flow).
  fastify.post<{ Params: { id: string } }>("/:id/reject", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "purchase_requisitions.manage");
    if (!ctx) return;

    const parsed = RejectSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }

    const result = await withTenant(ctx.tenantId, async (tx) => {
      if (!(await guardEnabled(tx, reply))) return null;

      const [pr] = await tx
        .select()
        .from(schema.purchaseRequisitions)
        .where(
          and(
            eq(schema.purchaseRequisitions.tenantId, ctx.tenantId),
            eq(schema.purchaseRequisitions.id, req.params.id),
            isNull(schema.purchaseRequisitions.deletedAt),
          ),
        )
        .limit(1);
      if (!pr) return { error: "NOT_FOUND" as const };
      if (pr.approvalRequestId) return { error: "ENGINE_OWNED" as const };
      if (pr.status !== "draft") return { error: "NOT_DRAFT" as const };
      if (pr.submittedByUserId && pr.submittedByUserId === ctx.userId) {
        return { error: "SELF_REJECTION" as const };
      }

      await tx
        .update(schema.purchaseRequisitionLines)
        .set({
          lineStatus: "rejected",
          lineRejectedReason: parsed.data.reason ?? null,
        })
        .where(
          eq(schema.purchaseRequisitionLines.purchaseRequisitionId, pr.id),
        );

      const [updated] = await tx
        .update(schema.purchaseRequisitions)
        .set({
          status: "rejected",
          rejectedAt: new Date(),
          rejectedByUserId: ctx.userId,
          rejectedReason: parsed.data.reason ?? null,
          updatedAt: new Date(),
        })
        .where(eq(schema.purchaseRequisitions.id, pr.id))
        .returning();

      await recordAuditEvent(tx, {
        kind: "purchase_requisition.rejected",
        summary: `Rejected ${pr.prNumber ?? "draft PR"}`,
        refType: "purchase_requisition",
        refId: pr.id,
        diff: { priorStatus: pr.status, reason: parsed.data.reason ?? null },
        actorUserId: ctx.userId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return { purchaseRequisition: projectPr(updated!) };
    });

    if (result === null) return;
    if ("error" in result) {
      const map: Record<string, { status: number; message: string }> = {
        NOT_FOUND: { status: 404, message: "PR not found." },
        ENGINE_OWNED: {
          status: 409,
          message:
            "This PR is managed by the approval engine. Decide it from the Approvals queue.",
        },
        NOT_DRAFT: { status: 409, message: "Only draft PRs can be rejected." },
        SELF_REJECTION: {
          status: 409,
          message: "You cannot reject a PR you submitted.",
        },
      };
      const m = map[result.error as keyof typeof map];
      return reply
        .status(m?.status ?? 400)
        .send({ error: { code: result.error, message: m?.message ?? null } });
    }
    return reply.send(result);
  });

  // POST /purchase-requisitions/:id/cancel — submitter withdraws a PR
  // that hasn't yet converted. Terminal: sets status='cancelled'. If
  // the PR is currently engine-owned (pending_approval), we cancel the
  // underlying approval_request first so the /approvals queue drops it.
  fastify.post<{ Params: { id: string } }>("/:id/cancel", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "purchase_requisitions.manage");
    if (!ctx) return;

    const parsed = CancelSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }

    const result = await withTenant(ctx.tenantId, async (tx) => {
      if (!(await guardEnabled(tx, reply))) return null;

      const [pr] = await tx
        .select()
        .from(schema.purchaseRequisitions)
        .where(
          and(
            eq(schema.purchaseRequisitions.tenantId, ctx.tenantId),
            eq(schema.purchaseRequisitions.id, req.params.id),
            isNull(schema.purchaseRequisitions.deletedAt),
          ),
        )
        .limit(1);
      if (!pr) return { error: "NOT_FOUND" as const };
      if (!["draft", "pending_approval", "approved", "rejected"].includes(pr.status)) {
        return { error: "NOT_CANCELLABLE" as const };
      }

      if (pr.status === "pending_approval" && pr.approvalRequestId) {
        await cancelApprovalRequest(tx, {
          tenantId: ctx.tenantId,
          requestId: pr.approvalRequestId,
          reason: parsed.data.reason || "PR cancelled",
        });
      }

      const [updated] = await tx
        .update(schema.purchaseRequisitions)
        .set({
          status: "cancelled",
          cancelledAt: new Date(),
          cancelledReason: parsed.data.reason ?? null,
          approvalRequestId: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.purchaseRequisitions.id, pr.id))
        .returning();

      await recordAuditEvent(tx, {
        kind: "purchase_requisition.cancelled",
        summary: `Cancelled ${pr.prNumber ?? "draft PR"}`,
        refType: "purchase_requisition",
        refId: pr.id,
        diff: { priorStatus: pr.status, reason: parsed.data.reason ?? null },
        actorUserId: ctx.userId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return { purchaseRequisition: projectPr(updated!) };
    });

    if (result === null) return;
    if ("error" in result) {
      const map: Record<string, { status: number; message: string }> = {
        NOT_FOUND: { status: 404, message: "PR not found." },
        NOT_CANCELLABLE: {
          status: 409,
          message: "This PR is past the cancellation window.",
        },
      };
      const m = map[result.error as keyof typeof map];
      return reply
        .status(m?.status ?? 400)
        .send({ error: { code: result.error, message: m?.message ?? null } });
    }
    return reply.send(result);
  });

  // POST /purchase-requisitions/:id/convert — approved → converted.
  // Creates a draft PO whose lines mirror the PR's approved lines
  // (rejected lines are excluded). Back-links source_pr_id /
  // source_pr_line_id and flips the PR to 'converted'. A PR can only
  // convert once.
  fastify.post<{ Params: { id: string } }>("/:id/convert", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "purchase_requisitions.manage");
    if (!ctx) return;

    const parsed = ConvertSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const body = parsed.data;
    const orderDate = body.orderDate ?? new Date().toISOString().slice(0, 10);

    const result = await withTenant(ctx.tenantId, async (tx) => {
      if (!(await guardEnabled(tx, reply))) return null;

      const [pr] = await tx
        .select()
        .from(schema.purchaseRequisitions)
        .where(
          and(
            eq(schema.purchaseRequisitions.tenantId, ctx.tenantId),
            eq(schema.purchaseRequisitions.id, req.params.id),
            isNull(schema.purchaseRequisitions.deletedAt),
          ),
        )
        .limit(1);
      if (!pr) return { error: "NOT_FOUND" as const };
      if (pr.status !== "approved") return { error: "NOT_APPROVED" as const };

      const supplierId = body.supplierId ?? pr.preferredSupplierId;
      if (!supplierId) return { error: "SUPPLIER_REQUIRED" as const };

      const [supplier] = await tx
        .select()
        .from(schema.suppliers)
        .where(
          and(
            eq(schema.suppliers.tenantId, ctx.tenantId),
            eq(schema.suppliers.id, supplierId),
            isNull(schema.suppliers.deletedAt),
          ),
        )
        .limit(1);
      if (!supplier) return { error: "SUPPLIER_NOT_FOUND" as const };

      const approvedLines = await tx
        .select()
        .from(schema.purchaseRequisitionLines)
        .where(
          and(
            eq(schema.purchaseRequisitionLines.tenantId, ctx.tenantId),
            eq(schema.purchaseRequisitionLines.purchaseRequisitionId, pr.id),
            eq(schema.purchaseRequisitionLines.lineStatus, "approved"),
          ),
        )
        .orderBy(asc(schema.purchaseRequisitionLines.lineNo));
      if (approvedLines.length === 0) return { error: "NO_APPROVED_LINES" as const };

      const subtotalCents = approvedLines.reduce(
        (s, l) => s + l.estimatedLineTotalCents,
        0,
      );

      const [po] = await tx
        .insert(schema.purchaseOrders)
        .values({
          tenantId: ctx.tenantId,
          supplierId: supplier.id,
          branchId: pr.branchId,
          status: "draft",
          orderDate,
          expectedDeliveryDate:
            body.expectedDeliveryDate ?? pr.neededByDate ?? null,
          currency: pr.currency,
          subtotalCents,
          discountCents: 0,
          taxCents: 0,
          totalCents: subtotalCents,
          reference: pr.prNumber ?? null,
          notes: body.notes ?? pr.purpose ?? null,
          sourcePrId: pr.id,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!po) return { error: "PO_INSERT_FAILED" as const };

      await tx.insert(schema.purchaseOrderLines).values(
        approvedLines.map((l, idx) => ({
          tenantId: ctx.tenantId,
          purchaseOrderId: po.id,
          lineNo: idx + 1,
          itemId: l.itemId,
          description: l.description,
          quantity: l.quantity,
          unitPriceCents: l.estimatedUnitPriceCents ?? 0,
          lineSubtotalCents: l.estimatedLineTotalCents,
          discountPctBps: 0,
          discountCents: 0,
          taxRateBps: 0,
          taxCents: 0,
          lineTotalCents: l.estimatedLineTotalCents,
          sourcePrLineId: l.id,
        })),
      );

      // Allocate PR number if not already (we only stamp a number once
      // a PR reaches a "real" state; approved is real enough).
      let prNumber = pr.prNumber;
      if (!prNumber) {
        prNumber = await nextDocumentNumber(tx, "purchase_requisition");
      }

      const now = new Date();
      const [updated] = await tx
        .update(schema.purchaseRequisitions)
        .set({
          prNumber,
          status: "converted",
          convertedAt: now,
          convertedPoId: po.id,
          updatedAt: now,
        })
        .where(eq(schema.purchaseRequisitions.id, pr.id))
        .returning();

      await recordAuditEvent(tx, {
        kind: "purchase_requisition.converted",
        summary: `Converted ${prNumber} → PO`,
        refType: "purchase_requisition",
        refId: pr.id,
        diff: {
          poId: po.id,
          supplierId: supplier.id,
          lineCount: approvedLines.length,
          subtotalCents,
        },
        actorUserId: ctx.userId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return {
        purchaseRequisition: projectPr(updated!),
        purchaseOrderId: po.id,
      };
    });

    if (result === null) return;
    if ("error" in result) {
      const map: Record<string, { status: number; message: string }> = {
        NOT_FOUND: { status: 404, message: "PR not found." },
        NOT_APPROVED: {
          status: 409,
          message: "Only approved PRs can be converted to a PO.",
        },
        SUPPLIER_REQUIRED: {
          status: 400,
          message:
            "Supplier is required. Set a preferred supplier on the PR, or pass supplierId.",
        },
        SUPPLIER_NOT_FOUND: { status: 400, message: "Supplier was not found." },
        NO_APPROVED_LINES: {
          status: 400,
          message: "This PR has no approved lines to convert.",
        },
        PO_INSERT_FAILED: {
          status: 500,
          message: "Couldn't create the purchase order.",
        },
      };
      const m = map[result.error as keyof typeof map];
      return reply
        .status(m?.status ?? 400)
        .send({ error: { code: result.error, message: m?.message ?? null } });
    }
    return reply.send({ ok: true, ...result });
  });
};
