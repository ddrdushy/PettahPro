"use client";

import { useMemo, useState } from "react";
import { Package, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { Drawer } from "@/components/app/drawer";
import { ItemForm } from "./item-form";
import { formatLKR } from "@/lib/format";
import type { Item, TaxCode } from "@/lib/api";

export function ItemsClient({
  initial,
  taxCodes,
}: {
  initial: Item[];
  taxCodes: TaxCode[];
}) {
  const [rows, setRows] = useState<Item[]>(initial);
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (i) => i.name.toLowerCase().includes(q) || (i.sku ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const columns: Column<Item>[] = [
    {
      header: "Item",
      accessor: (i) => (
        <div>
          <p className="font-medium text-charcoal">{i.name}</p>
          {i.sku && <p className="text-caption text-text-tertiary">{i.sku}</p>}
        </div>
      ),
    },
    {
      header: "Type",
      accessor: (i) => (
        <span className="capitalize text-small">{i.itemType}</span>
      ),
    },
    {
      header: "Unit",
      accessor: (i) => <span className="text-small">{i.unit}</span>,
    },
    {
      header: "Buy price",
      align: "right",
      mono: true,
      accessor: (i) =>
        i.buyPriceCents > 0 ? formatLKR(i.buyPriceCents) : <span className="text-text-tertiary">—</span>,
    },
    {
      header: "Sell price",
      align: "right",
      mono: true,
      accessor: (i) =>
        i.sellPriceCents > 0 ? formatLKR(i.sellPriceCents) : <span className="text-text-tertiary">—</span>,
    },
    {
      header: "Inventory",
      align: "center",
      accessor: (i) =>
        i.trackInventory ? (
          <span className="rounded-full bg-mint-surface px-2.5 py-0.5 text-caption text-mint-dark">Tracked</span>
        ) : (
          <span className="text-caption text-text-tertiary">—</span>
        ),
    },
  ];

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Stock"
        title="Items"
        description="Products and services you sell and buy. Attach tax codes so invoices and bills post correctly."
        action={
          <button type="button" onClick={() => setDrawerOpen(true)} className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            New item
          </button>
        }
      />

      <div className="mt-6 flex items-center gap-3">
        <label className="relative block flex-1 max-w-sm">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or SKU…"
            className="w-full rounded-md border-hairline border-border bg-surface-elevated py-2 pl-9 pr-3 text-small placeholder:text-text-tertiary focus:border-charcoal focus:outline-none"
          />
        </label>
        <span className="text-small text-text-tertiary">
          {filtered.length} of {rows.length}
        </span>
      </div>

      <div className="mt-6">
        <DataTable
          rows={filtered}
          columns={columns}
          empty={
            <div className="flex flex-col items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
                <Package className="h-5 w-5" />
              </div>
              <p className="text-body text-charcoal">No items yet.</p>
              <p className="text-small">Add one product or service to get started.</p>
              <button type="button" onClick={() => setDrawerOpen(true)} className="btn-primary mt-2">
                <Plus className="h-4 w-4" aria-hidden />
                New item
              </button>
            </div>
          }
        />
      </div>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="New item"
        description="Products are stocked; services aren't."
      >
        <ItemForm
          taxCodes={taxCodes}
          onCreated={(i) => {
            setRows((r) => [i, ...r]);
            setDrawerOpen(false);
          }}
        />
      </Drawer>
    </main>
  );
}
