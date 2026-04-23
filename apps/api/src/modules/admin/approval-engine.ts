import { and, eq, sql, desc } from "drizzle-orm";
import type { Database } from "@pettahpro/db";
import { schema } from "@pettahpro/db";
import type {
  ApprovalRequest,
  ApprovalRequestStep,
  ApprovalStepApprover,
  ApprovalStepSnapshot,
} from "@pettahpro/db";

/**
 * Approval engine — roadmap #43 / PR #74.
 *
 * Generic runtime that consumes `approval_policies` (from #26) and
 * drives an individual submission through the ordered steps defined
 * there. Domain modules (JE first; expense claims / bills / POs / etc.
 * in follow-ups) call into this module on submit and on decide —
 * they never touch `approval_requests` / `approval_request_steps`
 * directly.
 *
 * Three ideas you'll see repeated:
 *
 *   1. **Snapshot on create.** The policy's `steps` JSON is cloned
 *      into `approval_request_steps` at request creation time. If an
 *      admin later loosens the policy to relax approvers, in-flight
 *      requests stay bound to the original rules. Essential audit
 *      property.
 *
 *   2. **SOD (segregation of duties).** The submitter can never
 *      approve their own request, regardless of what the policy's
 *      approver list says. Enforced explicitly in `recordDecision`.
 *
 *   3. **First-match policy resolution.** For a given
 *      (document_type, amount, submitter), we pick the most
 *      recently-updated active policy whose trigger matches. No
 *      policy → `null` returned → domain falls back to its pre-engine
 *      flow (e.g. JE flat threshold). This keeps the engine opt-in
 *      per document_type.
 */

export type ApprovalDocumentType =
  | "journal_entry"
  | "expense_claim"
  | "bill"
  | "purchase_order"
  | "payroll_run"
  | "bonus_run"
  | "final_settlement"
  | "invoice";

export interface PolicyTriggerRule {
  minAmountCents?: number;
  submitters?: string[];
}

export interface PolicyStep {
  approvers: ApprovalStepApprover[];
  anyOf?: boolean;
}

/**
 * Does the given policy's trigger_rule match this submission?
 *
 * Current v1 rules (all AND-composed — every declared key must pass):
 *   - minAmountCents: submission.amountCents must be ≥ this value.
 *     A policy that omits this matches any amount (useful for
 *     "always approve payroll run" policies).
 *   - submitters: if present and non-empty, submitter must be in the
 *     list. Omit for "applies to everyone".
 *
 * Empty rule `{}` matches every submission of the target document
 * type.
 */
export function evaluateTrigger(
  rule: PolicyTriggerRule,
  submission: { amountCents: number | null; submitterUserId: string },
): boolean {
  if (rule.minAmountCents != null) {
    if (submission.amountCents == null) return false;
    if (submission.amountCents < rule.minAmountCents) return false;
  }
  if (rule.submitters && rule.submitters.length > 0) {
    if (!rule.submitters.includes(submission.submitterUserId)) return false;
  }
  return true;
}

/**
 * Find the active policy to use for a submission.
 *
 * Strategy: scan all active, non-deleted policies matching the
 * document_type, most-recently-updated first, and return the first
 * whose trigger_rule evaluates true. Returns null if no policy
 * matches — domain caller falls back to its legacy flow.
 *
 * Why "most-recently-updated" rather than a priority column? In
 * practice tenants have a small number of policies per document
 * type (usually 1–3), and the recency ordering matches the intuitive
 * "I just edited it, so try mine first". If we later add explicit
 * priorities, switch this ordering.
 */
export async function resolveApplicablePolicy(
  tx: Database,
  input: {
    documentType: ApprovalDocumentType;
    amountCents: number | null;
    submitterUserId: string;
  },
): Promise<{
  policyId: string;
  steps: ApprovalStepSnapshot[];
} | null> {
  const rows = await tx
    .select({
      id: schema.approvalPolicies.id,
      triggerRule: schema.approvalPolicies.triggerRule,
      steps: schema.approvalPolicies.steps,
    })
    .from(schema.approvalPolicies)
    .where(
      and(
        eq(schema.approvalPolicies.documentType, input.documentType),
        eq(schema.approvalPolicies.isActive, true),
        sql`${schema.approvalPolicies.deletedAt} IS NULL`,
      ),
    )
    .orderBy(desc(schema.approvalPolicies.updatedAt));

  for (const row of rows) {
    const rule = (row.triggerRule ?? {}) as PolicyTriggerRule;
    if (
      evaluateTrigger(rule, {
        amountCents: input.amountCents,
        submitterUserId: input.submitterUserId,
      })
    ) {
      const steps = normaliseSteps(row.steps);
      if (steps.length === 0) continue; // empty-steps policy is a config error, skip it
      return { policyId: row.id, steps };
    }
  }
  return null;
}

function normaliseSteps(raw: unknown): ApprovalStepSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const out: ApprovalStepSnapshot[] = [];
  for (const step of raw as PolicyStep[]) {
    if (!step || !Array.isArray(step.approvers) || step.approvers.length === 0) continue;
    out.push({
      approvers: step.approvers.map((a) => ({
        kind: a.kind,
        id: a.id,
        label: a.label,
      })),
      anyOf: step.anyOf !== false, // default true
    });
  }
  return out;
}

/**
 * Create an approval_request + one approval_request_steps row per
 * policy step. Returns the created request — caller is responsible
 * for linking it back to their domain row (e.g. setting
 * journal_entry_drafts.approval_request_id).
 *
 * Caller must pass `tenantId` explicitly (not read from
 * current_tenant_id()) so the insert survives even if tx context
 * briefly lacks a tenant_id setting. The RLS policy still enforces
 * the match.
 */
export async function createApprovalRequest(
  tx: Database,
  input: {
    tenantId: string;
    documentType: ApprovalDocumentType;
    documentId: string;
    amountCents: number | null;
    policyId: string;
    steps: ApprovalStepSnapshot[];
    submitterUserId: string;
  },
): Promise<ApprovalRequest> {
  if (input.steps.length === 0) {
    throw new Error("createApprovalRequest: steps must not be empty");
  }

  const [request] = await tx
    .insert(schema.approvalRequests)
    .values({
      tenantId: input.tenantId,
      documentType: input.documentType,
      documentId: input.documentId,
      amountCents: input.amountCents ?? null,
      policyId: input.policyId,
      submitterUserId: input.submitterUserId,
      stepsTotal: input.steps.length,
    })
    .returning();
  if (!request) throw new Error("createApprovalRequest: insert returned no row");

  // Snapshot steps in order. `anyOf` defaults to true on the policy
  // side and we preserve it here literally.
  await tx.insert(schema.approvalRequestSteps).values(
    input.steps.map((step, idx) => ({
      tenantId: input.tenantId,
      requestId: request.id,
      stepIdx: idx,
      approvers: step.approvers,
      anyOf: step.anyOf,
    })),
  );

  return request;
}

export interface DecisionResult {
  request: ApprovalRequest;
  advanced: boolean; // true if this decision moved the request one step forward
  finalised: "approved" | "rejected" | null; // set on the decision that terminates the request
}

/**
 * Record an approve or reject decision on the current step of a
 * pending request. Handles:
 *   - SOD check (approver ≠ submitter).
 *   - Approver membership check (user is in the step's approver list
 *     either directly or via a role the user holds).
 *   - Advancing current_step_idx on approve, or finalising on the
 *     last step.
 *   - Finalising on reject (no multi-step override — one reject kills
 *     the request).
 *
 * Throws (with structured error codes) rather than returning a
 * tagged union so that route-level error mapping can match on
 * `error.code`. Errors are:
 *   - NOT_FOUND
 *   - NOT_PENDING
 *   - SELF_APPROVAL
 *   - NOT_AUTHORISED
 *   - ALREADY_DECIDED
 */
export class ApprovalEngineError extends Error {
  constructor(
    public code:
      | "NOT_FOUND"
      | "NOT_PENDING"
      | "SELF_APPROVAL"
      | "NOT_AUTHORISED"
      | "ALREADY_DECIDED"
      | "STEP_OUT_OF_RANGE",
    message: string,
  ) {
    super(message);
    this.name = "ApprovalEngineError";
  }
}

export async function recordDecision(
  tx: Database,
  input: {
    tenantId: string;
    requestId: string;
    deciderUserId: string;
    deciderRoleIds: string[]; // role ids held by the decider
    decision: "approve" | "reject";
    reason?: string | null;
  },
): Promise<DecisionResult> {
  const [request] = await tx
    .select()
    .from(schema.approvalRequests)
    .where(
      and(
        eq(schema.approvalRequests.tenantId, input.tenantId),
        eq(schema.approvalRequests.id, input.requestId),
      ),
    );
  if (!request) {
    throw new ApprovalEngineError("NOT_FOUND", "Approval request not found.");
  }
  if (request.status !== "pending") {
    throw new ApprovalEngineError(
      "NOT_PENDING",
      `Request is already ${request.status}.`,
    );
  }
  if (request.submitterUserId === input.deciderUserId) {
    throw new ApprovalEngineError(
      "SELF_APPROVAL",
      "Submitter cannot decide their own request.",
    );
  }

  const [step] = await tx
    .select()
    .from(schema.approvalRequestSteps)
    .where(
      and(
        eq(schema.approvalRequestSteps.tenantId, input.tenantId),
        eq(schema.approvalRequestSteps.requestId, request.id),
        eq(schema.approvalRequestSteps.stepIdx, request.currentStepIdx),
      ),
    );
  if (!step) {
    throw new ApprovalEngineError(
      "STEP_OUT_OF_RANGE",
      "Current step missing — request state corrupt.",
    );
  }
  if (step.status !== "pending") {
    throw new ApprovalEngineError(
      "ALREADY_DECIDED",
      "Current step has already been decided.",
    );
  }

  if (!isUserAuthorisedForStep(step, input.deciderUserId, input.deciderRoleIds)) {
    throw new ApprovalEngineError(
      "NOT_AUTHORISED",
      "You are not an approver for this step.",
    );
  }

  const now = new Date();

  // Stamp this step.
  await tx
    .update(schema.approvalRequestSteps)
    .set({
      status: input.decision === "approve" ? "approved" : "rejected",
      decision: input.decision,
      decidedAt: now,
      decidedByUserId: input.deciderUserId,
      decisionReason: input.reason ?? null,
    })
    .where(
      and(
        eq(schema.approvalRequestSteps.tenantId, input.tenantId),
        eq(schema.approvalRequestSteps.id, step.id),
      ),
    );

  // Advance or terminate.
  if (input.decision === "reject") {
    // Any reject terminates. Skip remaining steps.
    await tx
      .update(schema.approvalRequestSteps)
      .set({ status: "skipped" })
      .where(
        and(
          eq(schema.approvalRequestSteps.tenantId, input.tenantId),
          eq(schema.approvalRequestSteps.requestId, request.id),
          eq(schema.approvalRequestSteps.status, "pending"),
        ),
      );
    const [updated] = await tx
      .update(schema.approvalRequests)
      .set({
        status: "rejected",
        decidedAt: now,
        decidedByUserId: input.deciderUserId,
        decisionReason: input.reason ?? null,
      })
      .where(
        and(
          eq(schema.approvalRequests.tenantId, input.tenantId),
          eq(schema.approvalRequests.id, request.id),
        ),
      )
      .returning();
    return { request: updated!, advanced: false, finalised: "rejected" };
  }

  // approve path
  const nextIdx = request.currentStepIdx + 1;
  const isLast = nextIdx >= request.stepsTotal;
  const [updated] = await tx
    .update(schema.approvalRequests)
    .set({
      currentStepIdx: nextIdx,
      ...(isLast
        ? {
            status: "approved" as const,
            decidedAt: now,
            decidedByUserId: input.deciderUserId,
            decisionReason: input.reason ?? null,
          }
        : {}),
    })
    .where(
      and(
        eq(schema.approvalRequests.tenantId, input.tenantId),
        eq(schema.approvalRequests.id, request.id),
      ),
    )
    .returning();

  return {
    request: updated!,
    advanced: true,
    finalised: isLast ? "approved" : null,
  };
}

/**
 * Is the given user allowed to decide this step?
 *
 * Two match kinds:
 *   - Direct user: one of the step's approvers has kind="user" and
 *     id=userId.
 *   - Role: one of the step's approvers has kind="role" and the
 *     user holds that role id.
 *
 * This function is deliberately sync + side-effect-free. The caller
 * looks up the user's roles once per request and passes them in,
 * avoiding an extra round-trip inside the tx.
 */
export function isUserAuthorisedForStep(
  step: ApprovalRequestStep,
  userId: string,
  userRoleIds: string[],
): boolean {
  const roleSet = new Set(userRoleIds);
  for (const a of step.approvers) {
    if (a.kind === "user" && a.id === userId) return true;
    if (a.kind === "role" && roleSet.has(a.id)) return true;
  }
  return false;
}

/**
 * Load the role ids held by a user, for use in the authorisation
 * check. Must be called inside `withTenant(tenantId, ...)`.
 */
export async function loadUserRoleIds(tx: Database, userId: string): Promise<string[]> {
  const rows = (await tx.execute(sql`
    SELECT role_id FROM user_roles
    WHERE user_id = ${userId} AND tenant_id = current_tenant_id()
  `)) as unknown as Array<{ role_id: string }>;
  return rows.map((r) => r.role_id);
}

/**
 * Cancel a pending request. Used when the submitter withdraws the
 * document before a decision lands (e.g. JE draft deleted while
 * pending). Safe to call on non-pending requests — just a no-op.
 */
export async function cancelApprovalRequest(
  tx: Database,
  input: { tenantId: string; requestId: string; reason?: string | null },
): Promise<void> {
  await tx
    .update(schema.approvalRequests)
    .set({
      status: "cancelled",
      decidedAt: new Date(),
      decisionReason: input.reason ?? null,
    })
    .where(
      and(
        eq(schema.approvalRequests.tenantId, input.tenantId),
        eq(schema.approvalRequests.id, input.requestId),
        eq(schema.approvalRequests.status, "pending"),
      ),
    );
  await tx
    .update(schema.approvalRequestSteps)
    .set({ status: "skipped" })
    .where(
      and(
        eq(schema.approvalRequestSteps.tenantId, input.tenantId),
        eq(schema.approvalRequestSteps.requestId, input.requestId),
        eq(schema.approvalRequestSteps.status, "pending"),
      ),
    );
}
