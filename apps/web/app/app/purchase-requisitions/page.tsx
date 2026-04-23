import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ClipboardCheck, Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { formatLKR, formatDate } from "@/lib/format";
import type {
  PurchaseRequisitionRow,
  PurchaseRequisitionStatus,
} from "@/lib/api";

export const metadata: Metadata = { title: "Purchase requisitions" };

const statusTone: Record<PurchaseRequisitionStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  pending_approval: "bg-warning-bg text-warning",
  approved: "bg-mint-surface text-mint-dark",
  rejected: "bg-danger-bg/60 text-danger",
  converted: "bg-mint text-mint-dark",
  cancelled: "bg-surface-recessed text-text-tertiary",
};

const statusLabel: Record<PurchaseRequisitionStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  converted: "Converted",
  cancelled: "Cancelled",
};

async function fetchAll(): Promise<PurchaseRequisitionRow[]> {
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const cookieHeader = cookies().toString();
  const res = await fetch(`${base}/purchase-requisitions`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    purchaseRequisitions: PurchaseRequisitionRow[];
  };
  return data.purchaseRequisitions;
}

export default async function PurchaseRequisitionsPage() {
  const rows = await fetchAll();

  const columns: Column<PurchaseRequisitionRow>[] = [
    {
      header: "PR",
      accessor: (pr) => (
        <Link href={`/app/purchase-requisitions/${pr.id}`} className="group block">
          <p className="font-medium text-charcoal group-hover:underline">
            {pr.prNumber ?? (
              <span className="italic text-text-tertiary">Draft</span>
            )}
          </p>
          {pr.purpose && (
            <p className="text-caption text-text-tertiary line-clamp-1">
              {pr.purpose}
            </p>
          )}
        </Link>
      ),
    },
    {
      header: "Needed by",
      accessor: (pr) =>
        pr.neededByDate ? (
          formatDate(pr.neededByDate)
        ) : (
          <span className="text-text-tertiary">—</span>
        ),
    },
    {
      header: "Estimated",
      align: "right",
      mono: true,
      accessor: (pr) => formatLKR(pr.estimatedTotalCents),
    },
    {
      header: "Created",
      accessor: (pr) => formatDate(pr.createdAt),
    },
    {
      header: "Status",
      align: "center",
      accessor: (pr) => (
        <span
          className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusTone[pr.status]}`}
        >
          {statusLabel[pr.status]}
        </span>
      ),
    },
  ];

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Buy"
        title="Purchase requisitions"
        description="Internal requests to buy. Route through approval, then convert the approved PR into a Purchase Order for the supplier."
        action={
          <Link
            href="/app/purchase-requisitions/new"
            className="btn-primary inline-flex items-center gap-2 text-small"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New requisition
          </Link>
        }
      />

      <div className="mt-6">
        <DataTable
          rows={rows}
          columns={columns}
          empty={
            <div className="flex flex-col items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
                <ClipboardCheck className="h-5 w-5" />
              </div>
              <p className="text-body text-charcoal">No purchase requisitions yet.</p>
              <p className="text-small">
                Raise a requisition so an approver can sign off before you commit spend.
              </p>
            </div>
          }
        />
      </div>
    </main>
  );
}
