import type { FastifyPluginAsync } from "fastify";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema, type ApprovalRequest } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";
import { recordAuditEvent } from "../../lib/audit.js";
import { emitNotification } from "../notifications/emit.js";
import { postJournal } from "../accounting/journal-posting.js";
import { postBillCore } from "../buy/bills.js";
import { sendPurchaseOrderCore } from "../buy/purchase-orders.js";
import { postPayrollRunCore } from "../hr/payroll-runs.js";
import { postBonusRunCore } from "../hr/bonuses.js";
import { approveFinalSettlementCore } from "../hr/final-settlement.js";
import { approvePurchaseRequisitionCore } from "../buy/purchase-requisitions.js";
import {
  ApprovalEngineError,
  cancelApprovalRequest,
  loadUserRoleIds,
  recordDecision,
} from "./approval-engine.js";

/**
 * Cross-domain approval queue routes — roadmap #43 / PR #74.
 *
 * The engine lives in approval-engine.ts. These routes are the thin
 * HTTP surface tenants use to see and decide on in-flight requests
 * regardless of source document type.
 *
 * Permissions:
 *   - GET /approvals and /approvals/:id           → any authenticated user
 *     (you can see requests you submitted, and requests where you're
 *     an approver). A user who sees neither just gets an empty list.
 *   - POST /approvals/:id/approve|reject|cancel   → approval.decide
 *     (new permission key, see 55-tenant-admin.sql seed). Owner bypass
 *     covers existing tenants with no RBAC configured.
 *
 * Approve semantics per document type:
 *   - When the final step of a journal_entry request approves, we
 *     also post the underlying journal_entry_draft via postJournal
 *     and flip the draft row. Other document types are follow-up PRs
 *     and currently 501 on final approval.
 */

const DecideBodySchema = z.object({
  reason: z.string().trim().max(2000).optional(),
});

const CancelBodySchema = z.object({
  reason: z.string().trim().max(2000).optional(),
});

const ListQuerySchema = z.object({
  scope: z.enum(["all", "mine", "submitted_by_me"]).default("all"),
  status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional(),
  documentType: z.string().max(64).optional(),
});

export const approvalsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /approvals?scope=mine|submitted_by_me|all
  //
  // "mine" = requests where I'm currently the approver on the open
  // step (i.e. the request is pending AND I'm in the current step's
  // approvers list either directly or via a role I hold).
  //
  // "submitted_by_me" = I created the submission, regardless of who's
  // deciding.
  //
  // "all" = tenant-wide list. Cheap to scope because every row is
  // already tenant-bound.
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = ListQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_QUERY", issues: parsed.error.issues } });
    }
    const { scope, status, documentType } = parsed.data;

    const rows = await withTenant(ctx.tenantId, async (tx) => {
      if (scope === "mine") {
        const roleIds = await loadUserRoleIds(tx, ctx.userId);
        // Build a JSON array of user identifiers the step must match.
        // We use a raw SQL EXISTS against jsonb_array_elements to
        // avoid pulling every pending step into memory — the query
        // returns the requests directly.
        const idBag = JSON.stringify([
          { kind: "user", id: ctx.userId },
          ...roleIds.map((id) => ({ kind: "role", id })),
        ]);
        const res = (await tx.execute(sql`
          SELECT r.*
          FROM approval_requests r
          INNER JOIN approval_request_steps s
            ON s.request_id = r.id
           AND s.tenant_id = r.tenant_id
           AND s.step_idx = r.current_step_idx
           AND s.status = 'pending'
          WHERE r.tenant_id = current_tenant_id()
            AND r.status = 'pending'
            AND r.submitter_user_id <> ${ctx.userId}::uuid
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(s.approvers) AS ap(approver)
              INNER JOIN jsonb_array_elements(${idBag}::jsonb) AS me(identity)
                ON (ap.approver ->> 'kind') = (me.identity ->> 'kind')
               AND (ap.approver ->> 'id')   = (me.identity ->> 'id')
            )
          ORDER BY r.created_at DESC
          LIMIT 200
        `)) as unknown as Array<Record<string, unknown>>;
        return res.map(rowToRequest);
      }

      if (scope === "submitted_by_me") {
        const q = tx
          .select()
          .from(schema.approvalRequests)
          .where(
            and(
              eq(schema.approvalRequests.tenantId, ctx.tenantId),
              eq(schema.approvalRequests.submitterUserId, ctx.userId),
              ...(status ? [eq(schema.approvalRequests.status, status)] : []),
              ...(documentType
                ? [eq(schema.approvalRequests.documentType, documentType)]
                : []),
            ),
          )
          .orderBy(desc(schema.approvalRequests.createdAt))
          .limit(200);
        return (await q).map((r) => r);
      }

      // scope === "all"
      return tx
        .select()
        .from(schema.approvalRequests)
        .where(
          and(
            eq(schema.approvalRequests.tenantId, ctx.tenantId),
            ...(status ? [eq(schema.approvalRequests.status, status)] : []),
            ...(documentType
              ? [eq(schema.approvalRequests.documentType, documentType)]
              : []),
          ),
        )
        .orderBy(desc(schema.approvalRequests.createdAt))
        .limit(200);
    });

    return reply.send({ requests: rows });
  });

  // GET /approvals/:id — request + all steps.
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const [request] = await tx
        .select()
        .from(schema.approvalRequests)
        .where(
          and(
            eq(schema.approvalRequests.tenantId, ctx.tenantId),
            eq(schema.approvalRequests.id, req.params.id),
          ),
        );
      if (!request) return null;

      const steps = await tx
        .select()
        .from(schema.approvalRequestSteps)
        .where(
          and(
            eq(schema.approvalRequestSteps.tenantId, ctx.tenantId),
            eq(schema.approvalRequestSteps.requestId, request.id),
          ),
        )
        .orderBy(schema.approvalRequestSteps.stepIdx);

      return { request, steps };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  // POST /approvals/:id/approve
  fastify.post<{ Params: { id: string } }>("/:id/approve", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "approval.decide");
    if (!ctx) return;

    const parsed = DecideBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }

    try {
      const result = await withTenant(ctx.tenantId, async (tx) => {
        const roleIds = await loadUserRoleIds(tx, ctx.userId);
        const decision = await recordDecision(tx, {
          tenantId: ctx.tenantId,
          requestId: req.params.id,
          deciderUserId: ctx.userId,
          deciderRoleIds: roleIds,
          decision: "approve",
          reason: parsed.data.reason ?? null,
        });

        // Final-step approved: drive the domain forward.
        if (decision.finalised === "approved") {
          await finaliseApprovedDocument(tx, {
            request: decision.request,
            deciderUserId: ctx.userId,
            reqMeta: {
              ip: req.ip ?? null,
              ua: req.headers["user-agent"] ?? null,
            },
          });
        }

        await recordAuditEvent(tx, {
          kind: "approval.decide",
          summary:
            decision.finalised === "approved"
              ? `Approved ${decision.request.documentType} request`
              : `Advanced ${decision.request.documentType} request to step ${decision.request.currentStepIdx + 1}/${decision.request.stepsTotal}`,
          refType: "approval_request",
          refId: decision.request.id,
          diff: {
            documentType: decision.request.documentType,
            documentId: decision.request.documentId,
            decision: "approve",
            finalised: decision.finalised,
            stepIdx: decision.request.currentStepIdx,
            stepsTotal: decision.request.stepsTotal,
          },
          actorUserId: ctx.userId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers["user-agent"] ?? null,
        });

        if (decision.finalised !== "approved") {
          // Notify the next step's approvers.
          await notifyNextStepApprovers(tx, decision.request);
        } else {
          await emitNotification(tx, {
            tenantId: ctx.tenantId,
            userId: decision.request.submitterUserId,
            kind: "approval_decided",
            title: `Your ${decision.request.documentType.replace(/_/g, " ")} was approved`,
            body: parsed.data.reason ?? null,
            refType: "approval_request",
            refId: decision.request.id,
          });
        }

        return decision;
      });

      return reply.send({ ok: true, request: result.request });
    } catch (err) {
      return handleEngineError(err, reply);
    }
  });

  // POST /approvals/:id/reject
  fastify.post<{ Params: { id: string } }>("/:id/reject", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "approval.decide");
    if (!ctx) return;

    const parsed = DecideBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }

    try {
      const result = await withTenant(ctx.tenantId, async (tx) => {
        const roleIds = await loadUserRoleIds(tx, ctx.userId);
        const decision = await recordDecision(tx, {
          tenantId: ctx.tenantId,
          requestId: req.params.id,
          deciderUserId: ctx.userId,
          deciderRoleIds: roleIds,
          decision: "reject",
          reason: parsed.data.reason ?? null,
        });

        // Domain reject handling: flip the underlying row so the UI
        // shows it in the rejected bucket. Each wired document type
        // gets its own branch — unwired types just leave the engine
        // in 'rejected' state, which is fine.
        if (decision.request.documentType === "journal_entry") {
          await tx
            .update(schema.journalEntryDrafts)
            .set({
              status: "rejected",
              rejectedByUserId: ctx.userId,
              rejectedAt: new Date(),
              rejectionReason: parsed.data.reason ?? null,
            })
            .where(
              and(
                eq(schema.journalEntryDrafts.tenantId, ctx.tenantId),
                eq(
                  schema.journalEntryDrafts.id,
                  decision.request.documentId,
                ),
              ),
            );
        } else if (decision.request.documentType === "expense_claim") {
          await tx
            .update(schema.expenseClaims)
            .set({
              status: "rejected",
              rejectedByUserId: ctx.userId,
              rejectedAt: new Date(),
              rejectionReason: parsed.data.reason ?? null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.expenseClaims.tenantId, ctx.tenantId),
                eq(schema.expenseClaims.id, decision.request.documentId),
              ),
            );
        } else if (decision.request.documentType === "bill") {
          // Bills (roadmap #43b). No dedicated "rejected" state — flip
          // back to draft and clear approval_request_id so the submitter
          // can edit and re-post cleanly. The rejection reason lives on
          // the approval_request; we also append it to bill notes for
          // per-bill visibility.
          const reason = parsed.data.reason?.trim();
          const [existing] = await tx
            .select({ notes: schema.bills.notes })
            .from(schema.bills)
            .where(
              and(
                eq(schema.bills.tenantId, ctx.tenantId),
                eq(schema.bills.id, decision.request.documentId),
              ),
            )
            .limit(1);
          const stampedNotes = reason
            ? existing?.notes
              ? `${existing.notes}\n\n[Rejected] ${reason}`
              : `[Rejected] ${reason}`
            : existing?.notes;
          await tx
            .update(schema.bills)
            .set({
              status: "draft",
              approvalRequestId: null,
              notes: stampedNotes ?? null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.bills.tenantId, ctx.tenantId),
                eq(schema.bills.id, decision.request.documentId),
              ),
            );
        } else if (decision.request.documentType === "purchase_order") {
          // POs (roadmap #43c). Same shape as the bill branch: no
          // dedicated "rejected" status, flip back to draft + clear the
          // engine handle + stamp the reason into notes so the
          // submitter has context when they reopen the PO.
          const reason = parsed.data.reason?.trim();
          const [existing] = await tx
            .select({ notes: schema.purchaseOrders.notes })
            .from(schema.purchaseOrders)
            .where(
              and(
                eq(schema.purchaseOrders.tenantId, ctx.tenantId),
                eq(schema.purchaseOrders.id, decision.request.documentId),
              ),
            )
            .limit(1);
          const stampedNotes = reason
            ? existing?.notes
              ? `${existing.notes}\n\n[Rejected] ${reason}`
              : `[Rejected] ${reason}`
            : existing?.notes;
          await tx
            .update(schema.purchaseOrders)
            .set({
              status: "draft",
              approvalRequestId: null,
              notes: stampedNotes ?? null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.purchaseOrders.tenantId, ctx.tenantId),
                eq(schema.purchaseOrders.id, decision.request.documentId),
              ),
            );
        } else if (decision.request.documentType === "payroll_run") {
          // Payroll runs (roadmap #43d). Mirror the bill/PO shape: no
          // dedicated "rejected" status, flip back to draft + clear the
          // engine handle + stamp reason into notes so HR can adjust
          // lines and re-post.
          const reason = parsed.data.reason?.trim();
          const [existing] = await tx
            .select({ notes: schema.payrollRuns.notes })
            .from(schema.payrollRuns)
            .where(
              and(
                eq(schema.payrollRuns.tenantId, ctx.tenantId),
                eq(schema.payrollRuns.id, decision.request.documentId),
              ),
            )
            .limit(1);
          const stampedNotes = reason
            ? existing?.notes
              ? `${existing.notes}\n\n[Rejected] ${reason}`
              : `[Rejected] ${reason}`
            : existing?.notes;
          await tx
            .update(schema.payrollRuns)
            .set({
              status: "draft",
              approvalRequestId: null,
              notes: stampedNotes ?? null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.payrollRuns.tenantId, ctx.tenantId),
                eq(schema.payrollRuns.id, decision.request.documentId),
              ),
            );
        } else if (decision.request.documentType === "bonus_run") {
          const reason = parsed.data.reason?.trim();
          const [existing] = await tx
            .select({ notes: schema.bonusRuns.notes })
            .from(schema.bonusRuns)
            .where(
              and(
                eq(schema.bonusRuns.tenantId, ctx.tenantId),
                eq(schema.bonusRuns.id, decision.request.documentId),
              ),
            )
            .limit(1);
          const stampedNotes = reason
            ? existing?.notes
              ? `${existing.notes}\n\n[Rejected] ${reason}`
              : `[Rejected] ${reason}`
            : existing?.notes;
          await tx
            .update(schema.bonusRuns)
            .set({
              status: "draft",
              approvalRequestId: null,
              notes: stampedNotes ?? null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.bonusRuns.tenantId, ctx.tenantId),
                eq(schema.bonusRuns.id, decision.request.documentId),
              ),
            );
        } else if (decision.request.documentType === "final_settlement") {
          // Final settlements (roadmap #43e). Flip back to draft so HR
          // can adjust the worksheet before re-approving. Stamp reason
          // into notes for context.
          const reason = parsed.data.reason?.trim();
          const [existing] = await tx
            .select({ notes: schema.finalSettlements.notes })
            .from(schema.finalSettlements)
            .where(
              and(
                eq(schema.finalSettlements.tenantId, ctx.tenantId),
                eq(schema.finalSettlements.id, decision.request.documentId),
              ),
            )
            .limit(1);
          const stampedNotes = reason
            ? existing?.notes
              ? `${existing.notes}\n\n[Rejected] ${reason}`
              : `[Rejected] ${reason}`
            : existing?.notes;
          await tx
            .update(schema.finalSettlements)
            .set({
              status: "draft",
              approvalRequestId: null,
              notes: stampedNotes ?? null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.finalSettlements.tenantId, ctx.tenantId),
                eq(schema.finalSettlements.id, decision.request.documentId),
              ),
            );
        } else if (decision.request.documentType === "purchase_requisition") {
          // Purchase requisitions (roadmap #30). Flip back to 'rejected'
          // (terminal at engine-reject time) with the reason stamped.
          // Submitters can edit a rejected PR — the PATCH handler
          // auto-resets rejected → draft on edit so they can re-submit.
          const reason = parsed.data.reason?.trim();
          await tx
            .update(schema.purchaseRequisitionLines)
            .set({
              lineStatus: "rejected",
              lineRejectedReason: reason ?? null,
            })
            .where(
              eq(
                schema.purchaseRequisitionLines.purchaseRequisitionId,
                decision.request.documentId,
              ),
            );
          await tx
            .update(schema.purchaseRequisitions)
            .set({
              status: "rejected",
              rejectedAt: new Date(),
              rejectedByUserId: ctx.userId,
              rejectedReason: reason ?? null,
              approvalRequestId: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.purchaseRequisitions.tenantId, ctx.tenantId),
                eq(schema.purchaseRequisitions.id, decision.request.documentId),
              ),
            );
        }

        await recordAuditEvent(tx, {
          kind: "approval.decide",
          summary: `Rejected ${decision.request.documentType} request`,
          refType: "approval_request",
          refId: decision.request.id,
          diff: {
            documentType: decision.request.documentType,
            documentId: decision.request.documentId,
            decision: "reject",
            reason: parsed.data.reason ?? null,
          },
          actorUserId: ctx.userId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers["user-agent"] ?? null,
        });

        await emitNotification(tx, {
          tenantId: ctx.tenantId,
          userId: decision.request.submitterUserId,
          kind: "approval_decided",
          title: `Your ${decision.request.documentType.replace(/_/g, " ")} was rejected`,
          body: parsed.data.reason ?? null,
          refType: "approval_request",
          refId: decision.request.id,
        });

        return decision;
      });

      return reply.send({ ok: true, request: result.request });
    } catch (err) {
      return handleEngineError(err, reply);
    }
  });

  // POST /approvals/:id/cancel — submitter withdraws their request.
  // No permission required beyond auth; we check submitter identity
  // inside the tx.
  fastify.post<{ Params: { id: string } }>("/:id/cancel", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CancelBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [request] = await tx
        .select()
        .from(schema.approvalRequests)
        .where(
          and(
            eq(schema.approvalRequests.tenantId, ctx.tenantId),
            eq(schema.approvalRequests.id, req.params.id),
          ),
        );
      if (!request) return { error: "NOT_FOUND" as const };
      if (request.status !== "pending") {
        return { error: "NOT_PENDING" as const, status: request.status };
      }
      if (request.submitterUserId !== ctx.userId) {
        return { error: "NOT_SUBMITTER" as const };
      }

      await cancelApprovalRequest(tx, {
        tenantId: ctx.tenantId,
        requestId: request.id,
        reason: parsed.data.reason ?? null,
      });

      // Domain-specific cancel handling. Flip the domain row to
      // rejected so the submitter can edit + re-submit cleanly — the
      // expense-claims PATCH route auto-resets rejected → draft on
      // edit, same as the JE draft flow.
      if (request.documentType === "journal_entry") {
        await tx
          .update(schema.journalEntryDrafts)
          .set({
            status: "rejected",
            rejectedByUserId: ctx.userId,
            rejectedAt: new Date(),
            rejectionReason: parsed.data.reason ?? "Withdrawn by submitter",
          })
          .where(
            and(
              eq(schema.journalEntryDrafts.tenantId, ctx.tenantId),
              eq(schema.journalEntryDrafts.id, request.documentId),
            ),
          );
      } else if (request.documentType === "expense_claim") {
        await tx
          .update(schema.expenseClaims)
          .set({
            status: "rejected",
            rejectedByUserId: ctx.userId,
            rejectedAt: new Date(),
            rejectionReason: parsed.data.reason ?? "Withdrawn by submitter",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.expenseClaims.tenantId, ctx.tenantId),
              eq(schema.expenseClaims.id, request.documentId),
            ),
          );
      } else if (request.documentType === "bill") {
        // Bills: cancel flips pending_approval → draft and detaches the
        // request. Submitter can edit the bill and re-post. The notes
        // field picks up the reason so the bill carries context when
        // the submitter comes back to it.
        const reason = parsed.data.reason?.trim() || "Withdrawn by submitter";
        const [existing] = await tx
          .select({ notes: schema.bills.notes })
          .from(schema.bills)
          .where(
            and(
              eq(schema.bills.tenantId, ctx.tenantId),
              eq(schema.bills.id, request.documentId),
            ),
          )
          .limit(1);
        const stampedNotes = existing?.notes
          ? `${existing.notes}\n\n[Withdrawn] ${reason}`
          : `[Withdrawn] ${reason}`;
        await tx
          .update(schema.bills)
          .set({
            status: "draft",
            approvalRequestId: null,
            notes: stampedNotes,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.bills.tenantId, ctx.tenantId),
              eq(schema.bills.id, request.documentId),
            ),
          );
      } else if (request.documentType === "purchase_order") {
        // POs: mirror the bill cancel semantics. pending_approval →
        // draft, detach engine handle, stamp reason into notes.
        const reason = parsed.data.reason?.trim() || "Withdrawn by submitter";
        const [existing] = await tx
          .select({ notes: schema.purchaseOrders.notes })
          .from(schema.purchaseOrders)
          .where(
            and(
              eq(schema.purchaseOrders.tenantId, ctx.tenantId),
              eq(schema.purchaseOrders.id, request.documentId),
            ),
          )
          .limit(1);
        const stampedNotes = existing?.notes
          ? `${existing.notes}\n\n[Withdrawn] ${reason}`
          : `[Withdrawn] ${reason}`;
        await tx
          .update(schema.purchaseOrders)
          .set({
            status: "draft",
            approvalRequestId: null,
            notes: stampedNotes,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.purchaseOrders.tenantId, ctx.tenantId),
              eq(schema.purchaseOrders.id, request.documentId),
            ),
          );
      } else if (request.documentType === "payroll_run") {
        // Payroll runs (roadmap #43d). Same cancel shape as bills/POs:
        // pending_approval → draft, detach engine handle, stamp reason.
        const reason = parsed.data.reason?.trim() || "Withdrawn by submitter";
        const [existing] = await tx
          .select({ notes: schema.payrollRuns.notes })
          .from(schema.payrollRuns)
          .where(
            and(
              eq(schema.payrollRuns.tenantId, ctx.tenantId),
              eq(schema.payrollRuns.id, request.documentId),
            ),
          )
          .limit(1);
        const stampedNotes = existing?.notes
          ? `${existing.notes}\n\n[Withdrawn] ${reason}`
          : `[Withdrawn] ${reason}`;
        await tx
          .update(schema.payrollRuns)
          .set({
            status: "draft",
            approvalRequestId: null,
            notes: stampedNotes,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.payrollRuns.tenantId, ctx.tenantId),
              eq(schema.payrollRuns.id, request.documentId),
            ),
          );
      } else if (request.documentType === "bonus_run") {
        const reason = parsed.data.reason?.trim() || "Withdrawn by submitter";
        const [existing] = await tx
          .select({ notes: schema.bonusRuns.notes })
          .from(schema.bonusRuns)
          .where(
            and(
              eq(schema.bonusRuns.tenantId, ctx.tenantId),
              eq(schema.bonusRuns.id, request.documentId),
            ),
          )
          .limit(1);
        const stampedNotes = existing?.notes
          ? `${existing.notes}\n\n[Withdrawn] ${reason}`
          : `[Withdrawn] ${reason}`;
        await tx
          .update(schema.bonusRuns)
          .set({
            status: "draft",
            approvalRequestId: null,
            notes: stampedNotes,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.bonusRuns.tenantId, ctx.tenantId),
              eq(schema.bonusRuns.id, request.documentId),
            ),
          );
      } else if (request.documentType === "final_settlement") {
        // Final settlements (roadmap #43e). Same cancel shape as
        // payroll/bonus: pending_approval → draft, detach engine handle,
        // stamp reason into notes. The settlement's own `/cancel` is
        // terminal (draft|approved → cancelled); this approvals-queue
        // cancel means "withdraw the request and return it to draft".
        const reason = parsed.data.reason?.trim() || "Withdrawn by submitter";
        const [existing] = await tx
          .select({ notes: schema.finalSettlements.notes })
          .from(schema.finalSettlements)
          .where(
            and(
              eq(schema.finalSettlements.tenantId, ctx.tenantId),
              eq(schema.finalSettlements.id, request.documentId),
            ),
          )
          .limit(1);
        const stampedNotes = existing?.notes
          ? `${existing.notes}\n\n[Withdrawn] ${reason}`
          : `[Withdrawn] ${reason}`;
        await tx
          .update(schema.finalSettlements)
          .set({
            status: "draft",
            approvalRequestId: null,
            notes: stampedNotes,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.finalSettlements.tenantId, ctx.tenantId),
              eq(schema.finalSettlements.id, request.documentId),
            ),
          );
      } else if (request.documentType === "purchase_requisition") {
        // Purchase requisitions (roadmap #30). Withdraw → draft, detach
        // engine handle. Same shape as payroll/bonus/final-settlement:
        // the PR's own /cancel route is terminal; this queue cancel is
        // "withdraw back to draft so I can edit and resubmit".
        const reason = parsed.data.reason?.trim() || "Withdrawn by submitter";
        const [existing] = await tx
          .select({ notes: schema.purchaseRequisitions.notes })
          .from(schema.purchaseRequisitions)
          .where(
            and(
              eq(schema.purchaseRequisitions.tenantId, ctx.tenantId),
              eq(schema.purchaseRequisitions.id, request.documentId),
            ),
          )
          .limit(1);
        const stampedNotes = existing?.notes
          ? `${existing.notes}\n\n[Withdrawn] ${reason}`
          : `[Withdrawn] ${reason}`;
        await tx
          .update(schema.purchaseRequisitions)
          .set({
            status: "draft",
            approvalRequestId: null,
            notes: stampedNotes,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.purchaseRequisitions.tenantId, ctx.tenantId),
              eq(schema.purchaseRequisitions.id, request.documentId),
            ),
          );
      }

      await recordAuditEvent(tx, {
        kind: "approval.cancel",
        summary: `Cancelled ${request.documentType} request`,
        refType: "approval_request",
        refId: request.id,
        diff: {
          documentType: request.documentType,
          documentId: request.documentId,
          reason: parsed.data.reason ?? null,
        },
        actorUserId: ctx.userId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return { ok: true as const };
    });

    if ("error" in result && result.error) {
      const code = result.error;
      const map: Record<typeof code, { status: number; message: string }> = {
        NOT_FOUND: { status: 404, message: "Request not found." },
        NOT_PENDING: { status: 409, message: "Request is no longer pending." },
        NOT_SUBMITTER: {
          status: 403,
          message: "Only the submitter can cancel a request.",
        },
      };
      const m = map[code];
      return reply.status(m.status).send({ error: { code, message: m.message } });
    }
    return reply.send({ ok: true });
  });
};

/**
 * Domain-specific finalisation when the request's last step approves.
 * Journal entries are wired here in PR #74; other document types
 * ship in follow-up PRs (43a–43e).
 */
async function finaliseApprovedDocument(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  input: {
    request: ApprovalRequest;
    deciderUserId: string;
    reqMeta: { ip: string | null; ua: string | null };
  },
): Promise<void> {
  const { request } = input;
  if (request.documentType === "journal_entry") {
    const [draft] = await tx
      .select()
      .from(schema.journalEntryDrafts)
      .where(
        and(
          eq(schema.journalEntryDrafts.tenantId, request.tenantId),
          eq(schema.journalEntryDrafts.id, request.documentId),
        ),
      );
    if (!draft) {
      throw new Error(
        `journal_entry draft ${request.documentId} missing at approval`,
      );
    }
    if (draft.status !== "pending_approval") {
      // Already acted on (e.g. legacy approve route ran first). Idempotent bail.
      return;
    }

    const payloadLines = (draft.payload?.lines ?? []) as Array<{
      accountId: string;
      drCents: number;
      crCents: number;
      description?: string | null;
      customerId?: string | null;
      supplierId?: string | null;
    }>;

    const posted = await postJournal(tx, {
      tenantId: request.tenantId,
      entryDate: draft.entryDate,
      memo: draft.memo ?? undefined,
      sourceType: "manual",
      postedByUserId: input.deciderUserId,
      lines: payloadLines.map((l) => ({
        accountId: l.accountId,
        drCents: l.drCents ?? 0,
        crCents: l.crCents ?? 0,
        description: l.description ?? undefined,
        customerId: l.customerId ?? null,
        supplierId: l.supplierId ?? null,
      })),
    });

    await tx
      .update(schema.journalEntryDrafts)
      .set({
        status: "approved",
        approvedByUserId: input.deciderUserId,
        approvedAt: new Date(),
        postedJournalEntryId: posted.entryId,
      })
      .where(
        and(
          eq(schema.journalEntryDrafts.tenantId, request.tenantId),
          eq(schema.journalEntryDrafts.id, draft.id),
        ),
      );
    return;
  }

  if (request.documentType === "expense_claim") {
    // Expense claims (roadmap #43a) have two disbursement paths:
    //   · 'direct'  — reimburse via a one-off bank payment. Engine
    //     approval flips to 'approved'; the subsequent
    //     /expense-claims/:id/approve-and-pay call posts the JE and
    //     flips to 'paid'. Keeps the payment-account + payment-date
    //     capture out of the generic approvals queue.
    //   · 'payroll' — next payroll run picks up 'approved' claims and
    //     bundles them into the run's JE. Also just needs status flipped.
    //
    // So both methods land the same way here: flip status submitted →
    // approved + stamp approvedAt/approvedByUserId. No JE posting in
    // this branch.
    const [claim] = await tx
      .select()
      .from(schema.expenseClaims)
      .where(
        and(
          eq(schema.expenseClaims.tenantId, request.tenantId),
          eq(schema.expenseClaims.id, request.documentId),
        ),
      );
    if (!claim) {
      throw new Error(
        `expense_claim ${request.documentId} missing at approval`,
      );
    }
    if (claim.status !== "submitted") {
      // Already moved (void/paid/etc). Idempotent bail.
      return;
    }
    await tx
      .update(schema.expenseClaims)
      .set({
        status: "approved",
        approvedByUserId: input.deciderUserId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.expenseClaims.tenantId, request.tenantId),
          eq(schema.expenseClaims.id, claim.id),
        ),
      );
    return;
  }

  if (request.documentType === "bill") {
    // Bills (roadmap #43b). Immediate path: draft → posted. Engine path:
    // draft → pending_approval → posted. Both land in postBillCore (the
    // shared helper in buy/bills.ts) so AP posting, stock receipts, and
    // notifications stay identical regardless of whether approval was
    // required.
    //
    // Engine finalisation expects the bill to be in `pending_approval`.
    // If something else moved the row (void, or a race) the helper
    // returns BAD_STATUS and we bail idempotently so the approval still
    // stamps as 'approved' on the engine side — the domain row's
    // terminal state wins.
    const result = await postBillCore(tx, {
      tenantId: request.tenantId,
      billId: request.documentId,
      postedByUserId: input.deciderUserId,
      allowStatuses: ["pending_approval"],
    });
    if ("error" in result) {
      if (result.error === "BAD_STATUS" || result.error === "NOT_FOUND") {
        return; // idempotent bail — row was voided / replaced
      }
      throw new Error(
        `finaliseApprovedDocument(bill): postBillCore failed — ${result.error}`,
      );
    }
    return;
  }

  if (request.documentType === "purchase_order") {
    // POs (roadmap #43c). Immediate path: draft → sent. Engine path:
    // draft → pending_approval → sent. Both land in sendPurchaseOrderCore
    // (shared helper in buy/purchase-orders.ts) so the "allocate number
    // + flip to sent" transition is byte-identical regardless of
    // whether approval was required.
    //
    // Idempotent bail on BAD_STATUS / NOT_FOUND: same reasoning as the
    // bill branch — the domain row's terminal state wins (PO might
    // have been cancelled from the detail page while the approver was
    // deciding).
    const result = await sendPurchaseOrderCore(tx, {
      tenantId: request.tenantId,
      purchaseOrderId: request.documentId,
      allowStatuses: ["pending_approval"],
    });
    if ("error" in result) {
      if (result.error === "BAD_STATUS" || result.error === "NOT_FOUND") {
        return;
      }
      throw new Error(
        `finaliseApprovedDocument(purchase_order): sendPurchaseOrderCore failed — ${result.error}`,
      );
    }
    return;
  }

  if (request.documentType === "payroll_run") {
    // Payroll runs (roadmap #43d, tenant-admin-ux-spec §7.1 "always →
    // Owner"). Engine path: draft → pending_approval → posted. Both
    // paths land in postPayrollRunCore; the helper re-resolves GL
    // accounts, posts the JE, and flips status to 'posted' while also
    // finalising loan EMI effects.
    const result = await postPayrollRunCore(tx, {
      tenantId: request.tenantId,
      payrollRunId: request.documentId,
      postedByUserId: input.deciderUserId,
      allowStatuses: ["pending_approval"],
    });
    if ("error" in result) {
      if (result.error === "BAD_STATUS" || result.error === "NOT_FOUND") {
        return;
      }
      throw new Error(
        `finaliseApprovedDocument(payroll_run): postPayrollRunCore failed — ${result.error}`,
      );
    }
    return;
  }

  if (request.documentType === "bonus_run") {
    // Bonus runs (roadmap #43d). Engine path: draft → pending_approval
    // → posted. Same shape as payroll above — the helper books the JE
    // and flips status.
    const result = await postBonusRunCore(tx, {
      tenantId: request.tenantId,
      bonusRunId: request.documentId,
      postedByUserId: input.deciderUserId,
      allowStatuses: ["pending_approval"],
    });
    if ("error" in result) {
      if (result.error === "BAD_STATUS" || result.error === "NOT_FOUND") {
        return;
      }
      throw new Error(
        `finaliseApprovedDocument(bonus_run): postBonusRunCore failed — ${result.error}`,
      );
    }
    return;
  }

  if (request.documentType === "final_settlement") {
    // Final settlements (roadmap #43e, tenant-admin-ux-spec §7.1
    // "always → Owner"). Engine path: draft → pending_approval →
    // approved. Flips status + stamps approvedAt/approvedByUserId;
    // does NOT book the GL — the subsequent /post call allocates
    // the FS-xxxx number and books the journal entry, mirroring the
    // pre-engine two-step lifecycle.
    const result = await approveFinalSettlementCore(tx, {
      tenantId: request.tenantId,
      settlementId: request.documentId,
      approverUserId: input.deciderUserId,
      allowStatuses: ["pending_approval"],
    });
    if ("error" in result) {
      if (result.error === "BAD_STATUS" || result.error === "NOT_FOUND") {
        return;
      }
      throw new Error(
        `finaliseApprovedDocument(final_settlement): approveFinalSettlementCore failed — ${result.error}`,
      );
    }
    return;
  }

  if (request.documentType === "purchase_requisition") {
    // Purchase requisitions (roadmap #30). Engine path:
    // draft → pending_approval → approved. Rejected-line details from
    // the original /approve call aren't carried through the engine —
    // the policy-matched path is "approve everything" by default. HR
    // tenants who want line-level partial approval skip the policy
    // and use the immediate route.
    const result = await approvePurchaseRequisitionCore(tx, {
      tenantId: request.tenantId,
      purchaseRequisitionId: request.documentId,
      approverUserId: input.deciderUserId,
      allowStatuses: ["pending_approval"],
    });
    if ("error" in result) {
      if (result.error === "BAD_STATUS" || result.error === "NOT_FOUND") {
        return;
      }
      throw new Error(
        `finaliseApprovedDocument(purchase_requisition): approvePurchaseRequisitionCore failed — ${result.error}`,
      );
    }
    return;
  }

  // Other domains land in their own follow-up PRs. For now, a final
  // approval on an unwired document type just leaves the engine in
  // "approved" state — the domain has its own state machine to
  // progress separately. We don't throw because the engine contract
  // is "record the decision"; wiring is the domain's responsibility.
}

async function notifyNextStepApprovers(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  request: ApprovalRequest,
): Promise<void> {
  const [nextStep] = await tx
    .select()
    .from(schema.approvalRequestSteps)
    .where(
      and(
        eq(schema.approvalRequestSteps.tenantId, request.tenantId),
        eq(schema.approvalRequestSteps.requestId, request.id),
        eq(schema.approvalRequestSteps.stepIdx, request.currentStepIdx),
      ),
    );
  if (!nextStep) return;

  // Expand approvers to concrete user ids.
  const userIds = new Set<string>();
  const roleIds: string[] = [];
  for (const a of nextStep.approvers) {
    if (a.kind === "user") userIds.add(a.id);
    else roleIds.push(a.id);
  }
  if (roleIds.length > 0) {
    const res = (await tx.execute(sql`
      SELECT DISTINCT user_id
      FROM user_roles
      WHERE tenant_id = current_tenant_id()
        AND role_id IN (${sql.raw(roleIds.map((id) => `'${id}'::uuid`).join(","))})
    `)) as unknown as Array<{ user_id: string }>;
    for (const r of res) userIds.add(r.user_id);
  }

  for (const userId of userIds) {
    if (userId === request.submitterUserId) continue; // SOD: don't nag the submitter
    await emitNotification(tx, {
      tenantId: request.tenantId,
      userId,
      kind: "approval_pending",
      title: `Approval needed · ${request.documentType.replace(/_/g, " ")}`,
      body:
        request.amountCents != null
          ? `Amount: ${(request.amountCents / 100).toFixed(2)}`
          : null,
      refType: "approval_request",
      refId: request.id,
    });
  }
}

function handleEngineError(err: unknown, reply: import("fastify").FastifyReply) {
  if (err instanceof ApprovalEngineError) {
    const status =
      err.code === "NOT_FOUND"
        ? 404
        : err.code === "NOT_AUTHORISED"
          ? 403
          : err.code === "SELF_APPROVAL"
            ? 403
            : 409;
    return reply.status(status).send({ error: { code: err.code, message: err.message } });
  }
  throw err;
}

// Shape drizzle-returned rows that came back via tx.execute(sql``) —
// drizzle's raw execute returns snake_case columns.
function rowToRequest(r: Record<string, unknown>): ApprovalRequest {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    documentType: r.document_type as string,
    documentId: r.document_id as string,
    amountCents: r.amount_cents == null ? null : Number(r.amount_cents),
    policyId: (r.policy_id as string) ?? null,
    submitterUserId: r.submitter_user_id as string,
    status: r.status as string,
    currentStepIdx: Number(r.current_step_idx),
    stepsTotal: Number(r.steps_total),
    decidedAt: r.decided_at ? new Date(r.decided_at as string) : null,
    decidedByUserId: (r.decided_by_user_id as string) ?? null,
    decisionReason: (r.decision_reason as string) ?? null,
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
  } as unknown as ApprovalRequest;
}

// Keep linter happy — inArray isn't used yet; reserved for a
// future "approve in bulk" route.
void inArray;
