import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema, nextDocumentNumber } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { postJournal } from "../accounting/journal-posting.js";
import {
  resolveApplicablePolicy,
  createApprovalRequest,
  cancelApprovalRequest,
} from "../admin/approval-engine.js";
import { emitNotification } from "../notifications/emit.js";

/**
 * Employee expense claims — payroll-module-spec §8, roadmap #14.
 *
 * State machine:
 *   draft → submitted → approved → paid
 *                     → rejected (→ edit → draft → submitted …)
 *   any-non-terminal → void
 *
 * Two disbursement paths:
 *   · 'direct'  — reimburse via a one-off bank payment. approve-and-pay
 *                 books DR <category expense> / CR <bank>, stamps
 *                 payment_journal_id + paid_at.
 *   · 'payroll' — leave status='approved' with disbursement_method='payroll'.
 *                 Next payroll run for the employee claims unclaimed
 *                 approved rows atomically (applied_in_run_id = run.id set
 *                 inside the same tx that creates the earning line). This
 *                 route does not post a JE — the payroll run does, bundled
 *                 into the run's posting. Payroll-side integration is a
 *                 mechanical follow-up; the column plumbing is in place.
 *
 * SOD: the same user cannot submit *and* approve. Enforced via
 * submitted_by_user_id ≠ approved_by_user_id.
 */

const CreateCategorySchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(128),
  description: z.string().optional().or(z.literal("")),
  expenseAccountId: z.string().uuid().nullable().optional(),
  isTaxable: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

const CreateClaimSchema = z.object({
  employeeId: z.string().uuid(),
  categoryId: z.string().uuid(),
  claimDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountCents: z.number().int().min(1),
  description: z.string().max(2000).optional().or(z.literal("")),
  receiptRef: z.string().max(2000).optional().or(z.literal("")),
  disbursementMethod: z.enum(["direct", "payroll"]).default("direct"),
});

const UpdateClaimSchema = CreateClaimSchema.partial();

const ApproveSchema = z.object({});

const ApprovePaySchema = z.object({
  paymentAccountId: z.string().uuid(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentReference: z.string().max(64).optional().or(z.literal("")),
});

const RejectSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});

const VoidSchema = z.object({
  reason: z.string().max(2000).optional().or(z.literal("")),
});

export const expenseCategoriesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /expense-categories
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.expenseCategories)
        .where(
          and(
            eq(schema.expenseCategories.tenantId, ctx.tenantId),
            isNull(schema.expenseCategories.deletedAt),
          ),
        )
        .orderBy(schema.expenseCategories.name),
    );
    return reply.send({ categories: rows });
  });

  // POST /expense-categories
  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CreateCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const d = parsed.data;

    try {
      const rows = await withTenant(ctx.tenantId, async (tx) =>
        tx
          .insert(schema.expenseCategories)
          .values({
            tenantId: ctx.tenantId,
            code: d.code,
            name: d.name,
            description: d.description || null,
            expenseAccountId: d.expenseAccountId ?? null,
            isTaxable: d.isTaxable,
            isActive: d.isActive,
            isSystem: false,
            createdByUserId: ctx.userId,
          })
          .returning(),
      );
      return reply.status(201).send({ category: rows[0] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("expense_categories_code_unique")) {
        return reply.status(409).send({ error: { code: "CODE_TAKEN", message: "A category with that code already exists." } });
      }
      throw err;
    }
  });

  // PATCH /expense-categories/:id
  fastify.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CreateCategorySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const d = parsed.data;

    const updated = await withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx
        .update(schema.expenseCategories)
        .set({
          ...(d.name !== undefined && { name: d.name }),
          ...(d.description !== undefined && { description: d.description || null }),
          ...(d.expenseAccountId !== undefined && { expenseAccountId: d.expenseAccountId ?? null }),
          ...(d.isTaxable !== undefined && { isTaxable: d.isTaxable }),
          ...(d.isActive !== undefined && { isActive: d.isActive }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.expenseCategories.tenantId, ctx.tenantId),
            eq(schema.expenseCategories.id, req.params.id),
            isNull(schema.expenseCategories.deletedAt),
          ),
        )
        .returning();
      return row;
    });
    if (!updated) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send({ category: updated });
  });

  // DELETE /expense-categories/:id — soft delete system categories rejected
  fastify.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [cat] = await tx
        .select()
        .from(schema.expenseCategories)
        .where(
          and(
            eq(schema.expenseCategories.tenantId, ctx.tenantId),
            eq(schema.expenseCategories.id, req.params.id),
            isNull(schema.expenseCategories.deletedAt),
          ),
        )
        .limit(1);
      if (!cat) return { error: "NOT_FOUND" as const };
      if (cat.isSystem) return { error: "SYSTEM_CATEGORY" as const };

      // Check references
      const [usage] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.expenseClaims)
        .where(
          and(
            eq(schema.expenseClaims.tenantId, ctx.tenantId),
            eq(schema.expenseClaims.categoryId, cat.id),
            isNull(schema.expenseClaims.deletedAt),
          ),
        );
      if ((usage?.count ?? 0) > 0) return { error: "IN_USE" as const };

      await tx
        .update(schema.expenseCategories)
        .set({ deletedAt: new Date() })
        .where(eq(schema.expenseCategories.id, cat.id));
      return { ok: true as const };
    });

    if ("error" in result) {
      const status = result.error === "NOT_FOUND" ? 404 : 409;
      return reply.status(status).send({ error: { code: result.error } });
    }
    return reply.send({ ok: true });
  });
};

export const expenseClaimsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /expense-claims — list with employee + category name
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select({
          claim: schema.expenseClaims,
          employeeName: schema.employees.fullName,
          employeeCode: schema.employees.employeeCode,
        })
        .from(schema.expenseClaims)
        .innerJoin(schema.employees, eq(schema.employees.id, schema.expenseClaims.employeeId))
        .where(
          and(
            eq(schema.expenseClaims.tenantId, ctx.tenantId),
            isNull(schema.expenseClaims.deletedAt),
          ),
        )
        .orderBy(desc(schema.expenseClaims.createdAt))
        .limit(300),
    );
    return reply.send({
      claims: rows.map((r) => ({
        ...r.claim,
        employeeName: r.employeeName,
        employeeCode: r.employeeCode,
      })),
    });
  });

  // GET /expense-claims/:id
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const row = await withTenant(ctx.tenantId, async (tx) => {
      const rows = await tx
        .select({
          claim: schema.expenseClaims,
          employeeName: schema.employees.fullName,
          employeeCode: schema.employees.employeeCode,
        })
        .from(schema.expenseClaims)
        .innerJoin(schema.employees, eq(schema.employees.id, schema.expenseClaims.employeeId))
        .where(
          and(
            eq(schema.expenseClaims.tenantId, ctx.tenantId),
            eq(schema.expenseClaims.id, req.params.id),
            isNull(schema.expenseClaims.deletedAt),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    });
    if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send({
      claim: {
        ...row.claim,
        employeeName: row.employeeName,
        employeeCode: row.employeeCode,
      },
    });
  });

  // POST /expense-claims — create draft
  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CreateClaimSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const d = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [emp] = await tx
        .select()
        .from(schema.employees)
        .where(
          and(
            eq(schema.employees.tenantId, ctx.tenantId),
            eq(schema.employees.id, d.employeeId),
            isNull(schema.employees.deletedAt),
          ),
        )
        .limit(1);
      if (!emp) return { error: "EMPLOYEE_NOT_FOUND" as const };

      const [cat] = await tx
        .select()
        .from(schema.expenseCategories)
        .where(
          and(
            eq(schema.expenseCategories.tenantId, ctx.tenantId),
            eq(schema.expenseCategories.id, d.categoryId),
            isNull(schema.expenseCategories.deletedAt),
          ),
        )
        .limit(1);
      if (!cat) return { error: "CATEGORY_NOT_FOUND" as const };
      if (!cat.isActive) return { error: "CATEGORY_INACTIVE" as const };

      const [claim] = await tx
        .insert(schema.expenseClaims)
        .values({
          tenantId: ctx.tenantId,
          employeeId: emp.id,
          categoryId: cat.id,
          categoryName: cat.name,
          expenseAccountId: cat.expenseAccountId,
          claimDate: d.claimDate,
          amountCents: d.amountCents,
          description: d.description || null,
          receiptRef: d.receiptRef || null,
          disbursementMethod: d.disbursementMethod,
          isTaxable: cat.isTaxable,
          createdByUserId: ctx.userId,
        })
        .returning();
      return { ok: true as const, claim };
    });

    if ("error" in result && result.error) {
      const status = result.error.endsWith("NOT_FOUND") ? 404 : 400;
      return reply.status(status).send({ error: { code: result.error } });
    }
    return reply.status(201).send({ claim: result.claim });
  });

  // PATCH /expense-claims/:id — edit draft or rejected-reopened
  fastify.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = UpdateClaimSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const d = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [claim] = await tx
        .select()
        .from(schema.expenseClaims)
        .where(
          and(
            eq(schema.expenseClaims.tenantId, ctx.tenantId),
            eq(schema.expenseClaims.id, req.params.id),
            isNull(schema.expenseClaims.deletedAt),
          ),
        )
        .limit(1);
      if (!claim) return { error: "NOT_FOUND" as const };
      if (!["draft", "rejected"].includes(claim.status)) {
        return { error: "NOT_EDITABLE" as const, status: claim.status };
      }

      // If category changes, refresh the account + taxable snapshot
      let categoryUpdate: {
        categoryId?: string;
        categoryName?: string | null;
        expenseAccountId?: string | null;
        isTaxable?: boolean;
      } = {};
      if (d.categoryId && d.categoryId !== claim.categoryId) {
        const [cat] = await tx
          .select()
          .from(schema.expenseCategories)
          .where(
            and(
              eq(schema.expenseCategories.tenantId, ctx.tenantId),
              eq(schema.expenseCategories.id, d.categoryId),
              isNull(schema.expenseCategories.deletedAt),
            ),
          )
          .limit(1);
        if (!cat) return { error: "CATEGORY_NOT_FOUND" as const };
        categoryUpdate = {
          categoryId: cat.id,
          categoryName: cat.name,
          expenseAccountId: cat.expenseAccountId,
          isTaxable: cat.isTaxable,
        };
      }

      // Editing a rejected claim bumps it back to draft so the submitter
      // can re-submit cleanly (prevents a rejected → paid skip).
      const resetStatus = claim.status === "rejected" ? { status: "draft" as const } : {};

      const [updated] = await tx
        .update(schema.expenseClaims)
        .set({
          ...(d.employeeId && { employeeId: d.employeeId }),
          ...(d.claimDate && { claimDate: d.claimDate }),
          ...(d.amountCents !== undefined && { amountCents: d.amountCents }),
          ...(d.description !== undefined && { description: d.description || null }),
          ...(d.receiptRef !== undefined && { receiptRef: d.receiptRef || null }),
          ...(d.disbursementMethod && { disbursementMethod: d.disbursementMethod }),
          ...categoryUpdate,
          ...resetStatus,
          updatedAt: new Date(),
        })
        .where(eq(schema.expenseClaims.id, claim.id))
        .returning();
      return { ok: true as const, claim: updated };
    });

    if ("error" in result) {
      const status =
        result.error === "NOT_FOUND" || result.error === "CATEGORY_NOT_FOUND" ? 404 : 409;
      return reply.status(status).send({ error: result });
    }
    return reply.send({ claim: result.claim });
  });

  // POST /expense-claims/:id/submit — draft → submitted
  fastify.post<{ Params: { id: string } }>("/:id/submit", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [claim] = await tx
        .select()
        .from(schema.expenseClaims)
        .where(
          and(
            eq(schema.expenseClaims.tenantId, ctx.tenantId),
            eq(schema.expenseClaims.id, req.params.id),
            isNull(schema.expenseClaims.deletedAt),
          ),
        )
        .limit(1);
      if (!claim) return { error: "NOT_FOUND" as const };
      if (claim.status !== "draft") return { error: "NOT_DRAFT" as const, status: claim.status };

      // Allocate claim number on first submit
      let claimNumber = claim.claimNumber;
      if (!claimNumber) {
        claimNumber = await nextDocumentNumber(tx, "expense_claim");
      }

      // Approval engine hook (roadmap #43a). Two paths coexist:
      //
      //   · Engine path: if a `document_type='expense_claim'` policy
      //     matches the submission's (amount, submitter), snapshot its
      //     steps into an approval_request and park the claim with
      //     `approval_request_id`. The claim stays `status='submitted'`;
      //     the engine drives the decision via /approvals/:id/approve.
      //     When the final step approves, finaliseApprovedDocument in
      //     apps/api/src/modules/admin/approvals.ts flips this claim
      //     to `status='approved'`.
      //
      //   · Legacy path: no policy matches → claim just transitions to
      //     `submitted` and the existing /approve, /approve-and-pay,
      //     /reject routes handle it with the submitter-≠-approver SOD
      //     check.
      const policy = await resolveApplicablePolicy(tx, {
        documentType: "expense_claim",
        amountCents: claim.amountCents,
        submitterUserId: ctx.userId,
      });

      let approvalRequestId: string | null = null;
      if (policy) {
        const request = await createApprovalRequest(tx, {
          tenantId: ctx.tenantId,
          documentType: "expense_claim",
          documentId: claim.id,
          amountCents: claim.amountCents,
          policyId: policy.policyId,
          steps: policy.steps,
          submitterUserId: ctx.userId,
        });
        approvalRequestId = request.id;

        // Notify first-step approvers. Mirrors the JE pattern in
        // accounting/journal-entries.ts — expand roles → user ids and
        // emit one bell per approver, skipping the submitter.
        const firstStep = policy.steps[0];
        if (firstStep) {
          const userIds = new Set<string>();
          const roleIds: string[] = [];
          for (const a of firstStep.approvers) {
            if (a.kind === "user") userIds.add(a.id);
            else roleIds.push(a.id);
          }
          if (roleIds.length > 0) {
            const res = (await tx.execute(sql`
              SELECT DISTINCT user_id
              FROM user_roles
              WHERE tenant_id = current_tenant_id()
                AND role_id IN (${sql.raw(
                  roleIds.map((id) => `'${id}'::uuid`).join(","),
                )})
            `)) as unknown as Array<{ user_id: string }>;
            for (const r of res) userIds.add(r.user_id);
          }
          for (const userId of userIds) {
            if (userId === ctx.userId) continue;
            await emitNotification(tx, {
              tenantId: ctx.tenantId,
              userId,
              kind: "approval_pending",
              title: `Approval needed · expense claim · ${(claim.amountCents / 100).toFixed(2)}`,
              body: claim.description ?? claim.categoryName ?? `Claim ${claimNumber}`,
              refType: "approval_request",
              refId: request.id,
            });
          }
        }
      }

      const [updated] = await tx
        .update(schema.expenseClaims)
        .set({
          status: "submitted",
          claimNumber,
          submittedAt: new Date(),
          submittedByUserId: ctx.userId,
          ...(approvalRequestId ? { approvalRequestId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.expenseClaims.id, claim.id))
        .returning();
      return { ok: true as const, claim: updated };
    });

    if ("error" in result) {
      const status = result.error === "NOT_FOUND" ? 404 : 409;
      return reply.status(status).send({ error: result });
    }
    return reply.send({ claim: result.claim });
  });

  // POST /expense-claims/:id/approve — submitted → approved (payroll-method only)
  fastify.post<{ Params: { id: string } }>("/:id/approve", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = ApproveSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [claim] = await tx
        .select()
        .from(schema.expenseClaims)
        .where(
          and(
            eq(schema.expenseClaims.tenantId, ctx.tenantId),
            eq(schema.expenseClaims.id, req.params.id),
            isNull(schema.expenseClaims.deletedAt),
          ),
        )
        .limit(1);
      if (!claim) return { error: "NOT_FOUND" as const };
      if (claim.status !== "submitted") return { error: "NOT_SUBMITTED" as const, status: claim.status };
      if (claim.disbursementMethod !== "payroll") {
        return { error: "USE_APPROVE_AND_PAY" as const };
      }
      // Engine-owned claims must be decided via /approvals/:id/approve
      // so the approval_request + step rows stay in lock-step with the
      // claim. Mirrors the JE draft pattern in journal-entries.ts.
      if (claim.approvalRequestId) return { error: "ENGINE_OWNED" as const };
      if (claim.submittedByUserId && claim.submittedByUserId === ctx.userId) {
        return { error: "SELF_APPROVAL" as const };
      }

      const [updated] = await tx
        .update(schema.expenseClaims)
        .set({
          status: "approved",
          approvedAt: new Date(),
          approvedByUserId: ctx.userId,
          updatedAt: new Date(),
        })
        .where(eq(schema.expenseClaims.id, claim.id))
        .returning();
      return { ok: true as const, claim: updated };
    });

    if ("error" in result) {
      let status = 500;
      let message = "";
      switch (result.error) {
        case "NOT_FOUND": status = 404; break;
        case "NOT_SUBMITTED": status = 409; message = "Claim is not in submitted status."; break;
        case "USE_APPROVE_AND_PAY":
          status = 409;
          message = "Direct-pay claims must use /approve-and-pay (needs a payment account).";
          break;
        case "ENGINE_OWNED":
          status = 409;
          message = "This claim is managed by the approval engine. Decide it from the Approvals queue instead.";
          break;
        case "SELF_APPROVAL":
          status = 403;
          message = "A submitter can't approve their own claim. Ask another admin to approve.";
          break;
      }
      return reply.status(status).send({ error: { code: result.error, message } });
    }
    return reply.send({ claim: result.claim });
  });

  // POST /expense-claims/:id/approve-and-pay — direct disbursement
  fastify.post<{ Params: { id: string } }>("/:id/approve-and-pay", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = ApprovePaySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const d = parsed.data;

    try {
      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [claim] = await tx
          .select()
          .from(schema.expenseClaims)
          .where(
            and(
              eq(schema.expenseClaims.tenantId, ctx.tenantId),
              eq(schema.expenseClaims.id, req.params.id),
              isNull(schema.expenseClaims.deletedAt),
            ),
          )
          .limit(1);
        if (!claim) return { error: "NOT_FOUND" as const };
        // approve-and-pay handles two entry conditions:
        //   · legacy (no approval engine in play): status='submitted' —
        //     this call approves + pays in one step.
        //   · engine-owned: status='approved' already, because the
        //     engine drove the approval via /approvals/:id/approve. This
        //     call then only executes the payment (no re-stamp of
        //     approvedAt/approvedByUserId).
        // Anything else is the wrong state for this route.
        const isEnginePay = !!claim.approvalRequestId;
        if (isEnginePay && claim.status !== "approved") {
          return { error: "NOT_APPROVED" as const, status: claim.status };
        }
        if (!isEnginePay && claim.status !== "submitted") {
          return { error: "NOT_SUBMITTED" as const, status: claim.status };
        }
        if (claim.disbursementMethod !== "direct") {
          return { error: "NOT_DIRECT_METHOD" as const };
        }
        // SOD: the submitter can never be the payer, regardless of
        // whether the engine already handled the approve step.
        if (claim.submittedByUserId && claim.submittedByUserId === ctx.userId) {
          return { error: "SELF_APPROVAL" as const };
        }

        if (!claim.expenseAccountId) return { error: "MISSING_EXPENSE_ACCOUNT" as const };

        const [bank] = await tx
          .select()
          .from(schema.chartOfAccounts)
          .where(
            and(
              eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
              eq(schema.chartOfAccounts.id, d.paymentAccountId),
              isNull(schema.chartOfAccounts.deletedAt),
            ),
          )
          .limit(1);
        if (!bank) return { error: "INVALID_PAYMENT_ACCOUNT" as const };
        if (!["bank", "cash"].includes(bank.accountSubtype ?? "")) {
          return { error: "INVALID_PAYMENT_ACCOUNT" as const };
        }

        // Resolve employee for JE memo
        const [emp] = await tx
          .select({ name: schema.employees.fullName, code: schema.employees.employeeCode })
          .from(schema.employees)
          .where(eq(schema.employees.id, claim.employeeId))
          .limit(1);

        const memo = `Expense reimbursement ${claim.claimNumber ?? ""} · ${emp?.name ?? "employee"} · ${claim.categoryName ?? ""}`;

        const { entryId } = await postJournal(tx, {
          tenantId: ctx.tenantId,
          entryDate: d.paymentDate,
          memo,
          sourceType: "expense_claim",
          sourceId: claim.id,
          postedByUserId: ctx.userId,
          lines: [
            { accountId: claim.expenseAccountId, drCents: claim.amountCents, description: claim.description ?? claim.categoryName ?? "Expense reimbursement" },
            { accountId: bank.id, crCents: claim.amountCents, description: memo },
          ],
        });

        const now = new Date();
        const [updated] = await tx
          .update(schema.expenseClaims)
          .set({
            status: "paid",
            // Don't overwrite the engine's approval metadata when the
            // engine already stamped it — only set approvedAt/approvedByUserId
            // on the legacy path where this call is the approval.
            ...(isEnginePay
              ? {}
              : {
                  approvedAt: now,
                  approvedByUserId: ctx.userId,
                }),
            paidAt: now,
            paidByUserId: ctx.userId,
            paymentAccountId: bank.id,
            paymentJournalId: entryId,
            paymentDate: d.paymentDate,
            paymentReference: d.paymentReference || null,
            updatedAt: now,
          })
          .where(eq(schema.expenseClaims.id, claim.id))
          .returning();
        return { ok: true as const, claim: updated, entryId };
      });

      if ("error" in result) {
        let status = 500;
        let message = "";
        switch (result.error) {
          case "NOT_FOUND": status = 404; break;
          case "NOT_SUBMITTED": status = 409; message = "Claim must be submitted before approve-and-pay."; break;
          case "NOT_APPROVED": status = 409; message = "Engine-managed claim must be approved via the Approvals queue before paying."; break;
          case "NOT_DIRECT_METHOD": status = 409; message = "Only direct-method claims support approve-and-pay."; break;
          case "SELF_APPROVAL": status = 403; message = "A submitter can't approve their own claim."; break;
          case "MISSING_EXPENSE_ACCOUNT": status = 409; message = "The category has no expense account configured."; break;
          case "INVALID_PAYMENT_ACCOUNT": status = 400; message = "Payment account must be a bank or cash account."; break;
        }
        return reply.status(status).send({ error: { code: result.error, message } });
      }
      return reply.send({ claim: result.claim });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("PERIOD_LOCKED")) {
        return reply.status(409).send({ error: { code: "PERIOD_LOCKED", message: "The period for the payment date is locked. Unlock it before paying." } });
      }
      throw err;
    }
  });

  // POST /expense-claims/:id/reject
  fastify.post<{ Params: { id: string } }>("/:id/reject", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = RejectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const d = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [claim] = await tx
        .select()
        .from(schema.expenseClaims)
        .where(
          and(
            eq(schema.expenseClaims.tenantId, ctx.tenantId),
            eq(schema.expenseClaims.id, req.params.id),
            isNull(schema.expenseClaims.deletedAt),
          ),
        )
        .limit(1);
      if (!claim) return { error: "NOT_FOUND" as const };
      if (claim.status !== "submitted") return { error: "NOT_SUBMITTED" as const, status: claim.status };
      // Engine-owned claims must be rejected via /approvals/:id/reject.
      if (claim.approvalRequestId) return { error: "ENGINE_OWNED" as const };
      if (claim.submittedByUserId && claim.submittedByUserId === ctx.userId) {
        return { error: "SELF_REJECTION" as const };
      }

      const [updated] = await tx
        .update(schema.expenseClaims)
        .set({
          status: "rejected",
          rejectedAt: new Date(),
          rejectedByUserId: ctx.userId,
          rejectionReason: d.reason,
          updatedAt: new Date(),
        })
        .where(eq(schema.expenseClaims.id, claim.id))
        .returning();
      return { ok: true as const, claim: updated };
    });

    if ("error" in result) {
      let status = 500;
      let message = "";
      switch (result.error) {
        case "NOT_FOUND": status = 404; break;
        case "NOT_SUBMITTED": status = 409; message = "Only submitted claims can be rejected."; break;
        case "ENGINE_OWNED":
          status = 409;
          message = "This claim is managed by the approval engine. Decide it from the Approvals queue instead.";
          break;
        case "SELF_REJECTION": status = 403; message = "A submitter can't reject their own claim."; break;
      }
      return reply.status(status).send({ error: { code: result.error, message } });
    }
    return reply.send({ claim: result.claim });
  });

  // POST /expense-claims/:id/void — drop any non-terminal claim
  fastify.post<{ Params: { id: string } }>("/:id/void", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = VoidSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const d = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [claim] = await tx
        .select()
        .from(schema.expenseClaims)
        .where(
          and(
            eq(schema.expenseClaims.tenantId, ctx.tenantId),
            eq(schema.expenseClaims.id, req.params.id),
            isNull(schema.expenseClaims.deletedAt),
          ),
        )
        .limit(1);
      if (!claim) return { error: "NOT_FOUND" as const };
      if (["paid", "void"].includes(claim.status)) {
        return { error: "TERMINAL" as const, status: claim.status };
      }

      // If there's a live approval request attached, cancel it so the
      // /approvals queue doesn't keep asking for a decision on a
      // voided claim. No-op if the request already terminated.
      if (claim.approvalRequestId) {
        await cancelApprovalRequest(tx, {
          tenantId: ctx.tenantId,
          requestId: claim.approvalRequestId,
          reason: d.reason || "Claim voided",
        });
      }

      const [updated] = await tx
        .update(schema.expenseClaims)
        .set({
          status: "void",
          voidAt: new Date(),
          voidReason: d.reason || null,
          updatedAt: new Date(),
        })
        .where(eq(schema.expenseClaims.id, claim.id))
        .returning();
      return { ok: true as const, claim: updated };
    });

    if ("error" in result) {
      const status = result.error === "NOT_FOUND" ? 404 : 409;
      return reply.status(status).send({ error: result });
    }
    return reply.send({ claim: result.claim });
  });

  // GET /expense-claims/by-employee/:employeeId — per-employee history with YTD
  fastify.get<{ Params: { employeeId: string } }>(
    "/by-employee/:employeeId",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const data = await withTenant(ctx.tenantId, async (tx) => {
        const claims = await tx
          .select()
          .from(schema.expenseClaims)
          .where(
            and(
              eq(schema.expenseClaims.tenantId, ctx.tenantId),
              eq(schema.expenseClaims.employeeId, req.params.employeeId),
              isNull(schema.expenseClaims.deletedAt),
            ),
          )
          .orderBy(desc(schema.expenseClaims.claimDate));

        const year = new Date().getUTCFullYear();
        const ytdCents = claims
          .filter(
            (c) =>
              (c.status === "paid" || c.status === "approved") &&
              c.claimDate.startsWith(`${year}-`),
          )
          .reduce((s, c) => s + c.amountCents, 0);

        return { claims, ytdCents, year };
      });
      return reply.send(data);
    },
  );
};
