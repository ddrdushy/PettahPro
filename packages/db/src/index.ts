export * from "./client.js";
export * from "./next-document-number.js";
export * as schema from "./schema/index.js";

// Selected schema-derived types re-exported at the root so consumers can
// do `import type { ApprovalRequest } from "@pettahpro/db"` without
// dipping into the schema namespace. Kept narrow — add entries here
// only when a non-trivial number of callers need them.
export type {
  ApprovalRequest,
  NewApprovalRequest,
  ApprovalRequestStep,
  NewApprovalRequestStep,
  ApprovalStepApprover,
  ApprovalStepSnapshot,
  ApprovalRequestStatus,
  ApprovalRequestStepStatus,
} from "./schema/approval-requests.js";
