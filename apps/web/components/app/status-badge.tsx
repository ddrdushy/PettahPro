import type { InvoiceStatus } from "@/lib/api";

const styles: Record<InvoiceStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  posted: "bg-mint-surface text-mint-dark",
  partially_paid: "bg-warning-bg text-warning",
  paid: "bg-mint text-mint-dark",
  void: "bg-danger-bg/60 text-danger",
  written_off: "bg-amber-50 text-amber-800",
};

const labels: Record<InvoiceStatus, string> = {
  draft: "Draft",
  posted: "Posted",
  partially_paid: "Partial",
  paid: "Paid",
  void: "Void",
  written_off: "Written off",
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}
