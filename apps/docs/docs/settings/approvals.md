---
title: Approvals
sidebar_position: 6
---

# Approvals

## What it does

Approvals are optional review steps you can put in front of certain documents — invoices over a threshold, bills, payments, manual journals, payroll runs, expense claims, purchase orders, requisitions. Out of the box, approvals are off — anyone with permission to post can post. Turning approvals on adds a "needs sign-off before it commits" step.

For small teams where everyone's responsible, approvals are usually overkill. As businesses grow and more people post documents, approvals are how you catch errors and prevent unauthorised commitments before they hit the books.

## How approvals work

When approvals are on for a document type, posting changes to a two-step flow:

1. **Submit** (instead of post) — the user fills out the document and submits.
2. **Approve** — the configured approver reviews and either approves (which posts the document) or rejects (which sends it back to the submitter).

The approver sees pending items in their **My approvals** queue. Each approval is logged: who approved, when, with what comment.

Multi-step approval is supported — a high-value bill might need manager approval, then finance head, then CEO. PettahPro routes through each step in sequence.

## Setting up approvals

Open **Settings → Approvals**. The list shows every approval rule, organised by document type:

- **Invoices** — over a chosen value, need approval.
- **Bills** — over a chosen value.
- **Payments** (outbound) — over a chosen value.
- **Manual journals** — over a chosen value.
- **Payroll runs** — every run needs approval (typical).
- **Expense claims** — over a chosen value (and per-category caps).
- **Purchase orders** — over a chosen value.
- **Purchase requisitions** — typically all need approval.
- **Staff loans** — typically all need approval.

For each, configure:

- **Enable / disable** — turn the approval on for this document type.
- **Threshold** — value above which approval is required. Below the threshold, the document posts without approval.
- **Approver(s)** — which role or specific user can approve. Multiple steps for multi-step.
- **Auto-route** — if the document originates with a specific cost centre or department, route to that department's approver.

### Multi-step approval

Some document types benefit from multi-step. Example for a high-value bill:

- Step 1: Department head (any spend in their dept).
- Step 2: Finance head (above 100k).
- Step 3: CEO (above 1m).

Each step adds a sequential approval requirement; the document only commits when all steps approve.

### Self-approval

By default, the submitter cannot approve their own document — even if they have the approver role. **Settings → Approvals → Allow self-approval** can be toggled if you want (e.g. for very small teams where the same person plays multiple roles), but it's a control weakening.

## Walkthrough

### Submitting for approval

User fills out the document, clicks **Submit for approval** (instead of "Post"). The document is in a **Pending approval** state. PettahPro routes to the configured approver.

### Approving

Approver opens **My approvals** in the header. Each pending item shows:

- The document and its content.
- Who submitted, when.
- Why approval is needed (e.g. "above 100k threshold").

Three actions:

- **Approve** — the document posts. Audit log records who approved.
- **Reject** — the document goes back to the submitter with the rejection reason. They can revise and resubmit.
- **Send back** — for "needs more info" cases. Submitter can edit and resubmit without it being a formal rejection.

### Approval comments

Always include a comment when rejecting. "We need to check with the supplier first" is much more useful than just rejecting silently. Comments appear on the audit trail and on the submitter's notification.

## Common tasks

### Set up basic invoice approval

Invoices over 1m need finance head approval. **Settings → Approvals → Invoices → Enable**. Threshold: 1,000,000. Approver: Finance head. Save. Now invoices ≤ 1m post without approval; invoices > 1m need finance head's sign-off first.

### Approval rules per cost centre

Different branches have different approvers. **Settings → Approvals → Routing rules** lets you say "if cost centre = Branch A, route to Branch A's manager". Each branch's transactions go to their own approver.

### Out-of-office delegation

Approver going on leave. **Settings → Approvals → Delegation** lets them nominate a delegate during the absence. Pending approvals route to the delegate; on return, the original approver can see what was approved on their behalf.

### Escalation

If an approval sits in a queue for too long, it should escalate. **Settings → Approvals → SLA → Escalation rules**. E.g. "If not actioned in 48 hours, alert the manager's manager". Stops things stalling indefinitely.

### Bulk approve

Approver faces a queue of small invoices. **My approvals → Multi-select → Approve all**. Saves time on review-by-review-by-review. Use carefully — bulk-approving is faster but easier to miss something.

### Audit a specific approval

Open the document → **Approval history** tab. Shows every step: who submitted, who approved at each step, when, with what comments. The full chain on one screen.

### Disable an approval temporarily

End-of-month rush, you want to temporarily lift the approval requirement. **Settings → Approvals → \[rule\] → Disable**. Re-enable after the rush. Remember to re-enable.

## What gets posted

Approvals don't post themselves — they're a workflow gate. What posts is the underlying document, after approval succeeds.

**Audit log** records every approval action with full context.

## FAQ

**The approver isn't seeing approvals in their queue.**
Check: (a) is the approval rule actually enabled? (b) is the threshold met? (c) is this user actually configured as the approver for this type/route? (d) is their session refreshed (logout / login)? Most "missing approval" cases are misconfigured rules.

**A document was approved but I want to revoke it before it commits.**
PettahPro commits at approval — there's no "revocation window". Once approved, it's posted. To undo: reverse the document (e.g. credit note for an invoice). Don't try to bypass the approval flow.

**Do approvals work in the API too?**
Yes. API submissions go through the same approval flow. The API call returns "pending approval" status; the actual posting happens when human approval completes.

**What if there's no human approver available (all approvers on leave)?**
Pending items wait. If escalation is configured, they escalate after the SLA. If no escalation, they sit. For critical urgency, an admin can manually approve via override (logged).

**Can I have an approval rule that only requires approval below a threshold?**
That's unusual but supported — you'd configure "below threshold X needs approval". Useful when high-value transactions are routine and pre-vetted, but small payments need scrutiny (e.g. unusual category combinations).

**Can I see how often each approver approves vs rejects?**
**Reports → HR → Approver activity** shows per-approver action counts. Useful for understanding bottlenecks and review patterns.

## Related

- [Roles](./roles.md) — defines who can be an approver.
- [Notifications](./notifications.md) — alerts approvers of pending items.
- Any document type with approval-supported configuration (Invoices / Bills / Payments / etc.).
