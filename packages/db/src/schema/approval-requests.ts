import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  bigint,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";
import { approvalPolicies } from "./approval-policies.js";

// Approval engine runtime tables (roadmap #43, PR #74). Policies live
// in approval_policies (#26); these tables track individual submissions
// walking through a policy's ordered steps.
//
// Design note: every request snapshots its policy's steps into
// approval_request_steps at creation time. Later edits to the policy
// do NOT retroactively change in-flight requests' approver lists —
// the rules in effect at submit time bind the request.

export const approvalRequestStatusValues = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
] as const;
export type ApprovalRequestStatus = (typeof approvalRequestStatusValues)[number];

export const approvalRequestStepStatusValues = [
  "pending",
  "approved",
  "rejected",
  "skipped",
] as const;
export type ApprovalRequestStepStatus = (typeof approvalRequestStepStatusValues)[number];

// Mirrors approval_policies.steps entry shape.
export interface ApprovalStepApprover {
  kind: "role" | "user";
  id: string;
  label?: string;
}

export interface ApprovalStepSnapshot {
  approvers: ApprovalStepApprover[];
  anyOf: boolean;
}

export const approvalRequests = pgTable("approval_requests", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),

  documentType: varchar("document_type", { length: 64 }).notNull(),
  documentId: uuid("document_id").notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }),

  policyId: uuid("policy_id").references(() => approvalPolicies.id, {
    onDelete: "set null",
  }),

  submitterUserId: uuid("submitter_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),

  status: varchar("status", { length: 16 }).notNull().default("pending"),
  currentStepIdx: integer("current_step_idx").notNull().default(0),
  stepsTotal: integer("steps_total").notNull(),

  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decidedByUserId: uuid("decided_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  decisionReason: text("decision_reason"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ApprovalRequest = typeof approvalRequests.$inferSelect;
export type NewApprovalRequest = typeof approvalRequests.$inferInsert;

export const approvalRequestSteps = pgTable("approval_request_steps", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  requestId: uuid("request_id")
    .notNull()
    .references(() => approvalRequests.id, { onDelete: "cascade" }),
  stepIdx: integer("step_idx").notNull(),
  approvers: jsonb("approvers").$type<ApprovalStepApprover[]>().notNull(),
  anyOf: boolean("any_of").notNull().default(true),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  decision: varchar("decision", { length: 16 }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decidedByUserId: uuid("decided_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  decisionReason: text("decision_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ApprovalRequestStep = typeof approvalRequestSteps.$inferSelect;
export type NewApprovalRequestStep = typeof approvalRequestSteps.$inferInsert;
