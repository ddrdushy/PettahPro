import type { BillStatus, InvoiceStatus } from "@/lib/api";

// Accept either InvoiceStatus or BillStatus. BillStatus adds
// `pending_approval` (roadmap #43b) for engine-owned bills awaiting
// approval; everything else is shared with invoices.
type BadgeStatus = InvoiceStatus | BillStatus;

const styles: Record<BadgeStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  pending_approval: "bg-warning-bg text-warning",
  posted: "bg-mint-surface text-mint-dark",
  partially_paid: "bg-warning-bg text-warning",
  paid: "bg-mint text-mint-dark",
  void: "bg-danger-bg/60 text-danger",
  written_off: "bg-amber-50 text-amber-800",
};

const labels: Record<BadgeStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  posted: "Posted",
  partially_paid: "Partial",
  paid: "Paid",
  void: "Void",
  written_off: "Written off",
};

export function StatusBadge({ status }: { status: BadgeStatus }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}
