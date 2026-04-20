import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangle, Boxes } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { formatLKR, formatDate } from "@/lib/format";
import type { StockBalanceRow } from "@/lib/api";

export const metadata: Metadata = { title: "Stock on hand" };

async function fetchStock(): Promise<{ balances: StockBalanceRow[]; totalValueCents: number }> {
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/stock`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return { balances: [], totalValueCents: 0 };
  return (await res.json()) as { balances: StockBalanceRow[]; totalValueCents: number };
}

export default async function StockPage() {
  const { balances, totalValueCents } = await fetchStock();

  const belowReorder = balances.filter(
    (b) => b.reorderPoint !== null && Number(b.quantityOnHand) <= b.reorderPoint,
  );

  const columns: Column<StockBalanceRow & { id: string }>[] = [
    {
      header: "Item",
      accessor: (b) => (
        <div>
          <p className="font-medium text-charcoal">{b.itemName}</p>
          {b.sku && <p className="text-caption text-text-tertiary">{b.sku}</p>}
        </div>
      ),
    },
    {
      header: "Warehouse",
      accessor: (b) => (
        <div>
          <p className="text-small text-charcoal">{b.warehouseCode}</p>
          <p className="text-caption text-text-tertiary">{b.warehouseName}</p>
        </div>
      ),
    },
    {
      header: "On hand",
      align: "right",
      mono: true,
      accessor: (b) => {
        const qty = Number(b.quantityOnHand);
        const below = b.reorderPoint !== null && qty <= b.reorderPoint;
        return (
          <div>
            <p className={below ? "font-medium text-warning" : "font-medium text-charcoal"}>
              {qty.toLocaleString("en-LK")} {b.unit}
            </p>
            {b.reorderPoint !== null && (
              <p className="text-caption text-text-tertiary">
                Reorder at {b.reorderPoint}
              </p>
            )}
          </div>
        );
      },
    },
    {
      header: "Avg cost",
      align: "right",
      mono: true,
      accessor: (b) => formatLKR(b.averageCostCents),
    },
    {
      header: "Total value",
      align: "right",
      mono: true,
      accessor: (b) => <span className="font-medium text-charcoal">{formatLKR(b.totalValueCents)}</span>,
    },
    {
      header: "Last movement",
      accessor: (b) =>
        b.lastMovementAt ? (
          formatDate(b.lastMovementAt)
        ) : (
          <span className="text-text-tertiary">—</span>
        ),
    },
  ];

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Stock"
        title="On hand"
        description="Current quantity and weighted-average value for every tracked item. Bills push stock in; invoices relieve it at the moving average."
        action={
          <Link href="/app/items" className="btn-secondary">
            Manage items
          </Link>
        }
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Kpi label="Items tracked" value={String(balances.length)} />
        <Kpi label="Total on-hand value" value={formatLKR(totalValueCents)} tone="mint" />
        <Kpi label="At or below reorder" value={String(belowReorder.length)} tone={belowReorder.length > 0 ? "warning" : undefined} />
      </div>

      {belowReorder.length > 0 && (
        <div className="mt-6 flex items-start gap-3 rounded-card border-hairline border-warning-accent/40 bg-warning-bg/60 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-warning-accent" aria-hidden />
          <div>
            <p className="text-small font-medium text-charcoal">
              {belowReorder.length} {belowReorder.length === 1 ? "item" : "items"} at or below reorder point
            </p>
            <p className="text-caption text-text-secondary">
              {belowReorder.map((b) => b.itemName).join(" · ")}
            </p>
          </div>
        </div>
      )}

      <div className="mt-6">
        <DataTable
          rows={balances.map((b) => ({ ...b, id: b.itemId + ":" + b.warehouseId }))}
          columns={columns}
          empty={
            <div className="flex flex-col items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
                <Boxes className="h-5 w-5" />
              </div>
              <p className="text-body text-charcoal">No stock movements yet.</p>
              <p className="text-small">Record a bill with a tracked item and the stock will appear here.</p>
              <Link href="/app/bills/new" className="btn-primary mt-2">
                New bill
              </Link>
            </div>
          }
        />
      </div>
    </main>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "mint" | "warning";
}) {
  const toneBg =
    tone === "mint"
      ? "bg-mint-surface text-mint-dark"
      : tone === "warning"
        ? "bg-warning-bg text-warning"
        : "bg-surface-recessed text-text-secondary";
  return (
    <div className="rounded-card border-hairline border-border bg-surface-elevated p-5">
      <div className="flex items-center justify-between">
        <p className="text-caption uppercase tracking-wide text-text-tertiary">{label}</p>
        <span className={`h-2 w-2 rounded-full ${toneBg}`} aria-hidden />
      </div>
      <p className="tabular-nums mt-2 text-h2 text-charcoal">{value}</p>
    </div>
  );
}
