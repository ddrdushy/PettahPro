import { sql } from "drizzle-orm";
import { pgTable, uuid, varchar, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

// Approval workflow designer (roadmap #26). v1 stores a linear chain
// of approval steps per document type with a JSON trigger rule.
//
// trigger_rule shapes:
//   { minAmountCents: 50000 }      — activate when total >= 50,000
//   { submitters: [userIdA, ...] } — activate when submitter is in list
//   { and: [rule, rule] }          — compose (future)
//
// steps shape: [{ approvers: [{ kind: "role" | "user", id: "uuid-or-name" }],
//                 anyOf: true }]
//   — `anyOf:true` means one approver in the group is enough; false
//     requires all.
//
// This v1 is designer + storage. Actual routing into domain transitions
// (journal_entries.status, expense_claims.status, etc.) is a follow-up
// — existing per-domain approval columns remain in use.
export const approvalPolicies = pgTable("approval_policies", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  documentType: varchar("document_type", { length: 64 }).notNull(),
  triggerRule: jsonb("trigger_rule").notNull().default(sql`'{}'::jsonb`),
  steps: jsonb("steps").notNull().default(sql`'[]'::jsonb`),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type ApprovalPolicy = typeof approvalPolicies.$inferSelect;
export type NewApprovalPolicy = typeof approvalPolicies.$inferInsert;
