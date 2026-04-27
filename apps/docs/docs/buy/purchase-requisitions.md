---
title: Purchase requisitions
sidebar_position: 7
---

# Purchase requisitions

## What it does

A purchase requisition is an **internal request** to buy something. Where a purchase order is what you send to a supplier ("please ship this"), a requisition is what your team sends to your purchasing function ("please buy this for me"). It's the step **before** the PO — the approval stage where someone with authority decides whether the request goes ahead.

For small businesses (one or two people doing all the buying), requisitions are overkill. For businesses where multiple departments request goods and a central purchasing function decides what gets ordered, requisitions are essential — they prevent maverick spend and give purchasing visibility into what's needed.

A requisition doesn't post to your books. It commits nothing. It's a workflow document — request → approval → conversion to a PO.

## Walkthrough

Open **Buy → Purchase requisitions → + New requisition**.

1. **Requested by** — defaults to the current user; can be overridden if you're filing on behalf of someone.
2. **Department / cost centre** — for tracking who's requesting.
3. **Required date** — when the requested goods or services need to be on hand.
4. **Add line items** — item, quantity, expected unit price, optional supplier preference, optional reason / justification.
5. **Save as draft** to keep editing, or **Submit** to send for approval.

Once submitted, the requisition routes through the approval matrix you've set up. Approvers see it in their queue, can approve / reject / comment. Once fully approved, it's ready to convert to a PO.

## Common tasks

### Submit a requisition

Fill it in, click **Submit**. PettahPro sends it to the approver(s) according to the matrix in **Settings → Approvals → Requisitions**. The submitter gets notified at each approval step.

### Approve / reject a requisition

Approvers see pending requisitions in **My approvals**. Open one, review the lines (and any attached documents — a quote from the supplier, a justification PDF), click **Approve** or **Reject** with a comment. Approval moves to the next step (if multi-step) or marks the requisition fully approved.

### Convert an approved requisition to a PO

The simple case: open the approved requisition → **Convert to PO** → pick the supplier → confirm. The PO inherits the lines and quantities; the link back to the requisition is preserved.

### Combine multiple requisitions into one PO

Useful when several departments have asked for things from the same supplier. Filter requisitions to that supplier (and Status = Approved), select multiple, click **Combine into PO**. One consolidated PO; each requisition stays linked.

### Reject with reason

Approvers should always include a reason when rejecting. Common reasons: "not in budget this quarter", "find a cheaper alternative", "duplicate request". The requester gets notified with the reason and can either revise and resubmit or abandon.

### Track requisitions through to delivery

The requisition list has a **Lifecycle** view per row: Draft → Submitted → Approved → PO created → GRN received → Bill posted → Paid. Useful for the requester to know "where's my thing?" without bothering purchasing.

### Set up the approval matrix

**Settings → Approvals → Requisitions**. Configure: who needs to approve at what value threshold, whether multi-step (e.g. department head, then finance), whether certain departments need extra approvers. Default: any user with `purchase.approve-requisition` can approve any requisition; for stricter control, layer thresholds and roles.

## What gets posted

**Nothing.** Requisitions are workflow documents, not transactions. No journal entry; no balance change; no stock movement.

What gets recorded:
- The requisition with full audit trail.
- Status (Draft / Submitted / Pending approval / Approved / Rejected / Converted / Cancelled).
- Each approval/rejection step with the approver, timestamp, and comment.
- The link to any PO it converts into.

## FAQ

**Do I need to use requisitions if I'm using POs?**
Only if you want pre-PO approval. POs themselves can have approval (in **Settings → Approvals → POs**), so for small businesses it's often enough to skip requisitions and just approve at the PO stage.

The case for requisitions: when many people across many departments request things, and a central function decides what to order. Without requisitions, you either let everyone create POs (chaotic) or have one purchasing person fielding endless verbal/email requests (also chaotic).

**Can a requisition request services?**
Yes — services and products both work. The requisition tracks "we need someone to do X" exactly like "we need to buy Y".

**Can I attach a quote to a requisition?**
Yes — attach files (PDF quotes from suppliers, technical specs, photos of the broken thing being replaced). They're visible to the approvers and stay with the requisition.

**A requisition was approved but the supplier we wanted is unavailable. Does the requisition still convert?**
Yes — when converting to PO, you pick the supplier at that step. The requisition specifies what's wanted, not necessarily who from. If the requester had a strong preference, they might note it on the requisition, but the actual supplier choice can be made by purchasing.

**What's the difference between a rejected requisition and a cancelled one?**
**Rejected** = approver said no. Submitter got the rejection reason; can revise and resubmit if the rejection was about specifics rather than the whole request.

**Cancelled** = the requester withdraws it (e.g. "we don't need this anymore"). No approval needed to cancel.

**Approval is stuck — the approver is on leave.**
**Settings → Approvals → Delegation** lets approvers nominate a delegate during their absence. If they didn't, an admin can reassign the approval to someone else.

## Related

- [Purchase orders](./purchase-orders.md) — what approved requisitions convert to.
- [GRNs](./grns.md) — receiving goods against the resulting PO.
- [Bills](./bills.md) — the supplier's bill against the PO.
- [Settings → Approvals](../settings/overview.md) — configuring the approval matrix.
