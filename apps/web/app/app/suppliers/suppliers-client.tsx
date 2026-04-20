"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus, Search, UsersRound } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { Drawer } from "@/components/app/drawer";
import { SupplierForm } from "./supplier-form";
import { initials } from "@/lib/format";
import type { Supplier, TaxCode } from "@/lib/api";

export function SuppliersClient({
  suppliers,
  whtCodes,
}: {
  suppliers: Supplier[];
  whtCodes: TaxCode[];
}) {
  const [rows, setRows] = useState<Supplier[]>(suppliers);
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.email ?? "").toLowerCase().includes(q) ||
        (s.city ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const columns: Column<Supplier>[] = [
    {
      header: "Supplier",
      accessor: (s) => (
        <Link href={`/app/suppliers/${s.id}`} className="group flex items-center gap-3">
          <div className="grid h-8 w-8 flex-none place-items-center rounded-full bg-mint-surface text-caption font-medium text-mint-dark">
            {initials(s.name)}
          </div>
          <div>
            <p className="font-medium text-charcoal group-hover:underline">{s.name}</p>
            {s.code && <p className="text-caption text-text-tertiary">{s.code}</p>}
          </div>
        </Link>
      ),
    },
    {
      header: "Contact",
      accessor: (s) => (
        <div>
          {s.email && <p className="text-small">{s.email}</p>}
          {s.phone && <p className="text-caption text-text-tertiary">{s.phone}</p>}
          {!s.email && !s.phone && <span className="text-text-tertiary">—</span>}
        </div>
      ),
    },
    {
      header: "City",
      accessor: (s) => s.city ?? <span className="text-text-tertiary">—</span>,
    },
    {
      header: "Terms",
      align: "right",
      accessor: (s) => (s.paymentTermsDays === 0 ? "Immediate" : `Net ${s.paymentTermsDays}d`),
    },
    {
      header: "Bank",
      accessor: (s) =>
        s.bankName ? (
          <div>
            <p className="text-small">{s.bankName}</p>
            {s.bankAccountNo && <p className="text-caption text-text-tertiary">{s.bankAccountNo}</p>}
          </div>
        ) : (
          <span className="text-text-tertiary">—</span>
        ),
    },
    {
      header: "Status",
      align: "center",
      accessor: (s) => (
        <span
          className={`rounded-full px-2.5 py-0.5 text-caption ${
            s.isActive ? "bg-mint-surface text-mint-dark" : "bg-surface-recessed text-text-tertiary"
          }`}
        >
          {s.isActive ? "Active" : "Inactive"}
        </span>
      ),
    },
  ];

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Buy"
        title="Suppliers"
        description="Your supplier master. WHT defaults, bank details, and payment terms ready for bills and SLIPS exports."
        action={
          <button type="button" onClick={() => setDrawerOpen(true)} className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            New supplier
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
            placeholder="Search by name, email, or city…"
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
                <UsersRound className="h-5 w-5" />
              </div>
              <p className="text-body text-charcoal">No suppliers yet.</p>
              <p className="text-small">Add suppliers before you record bills or purchase orders.</p>
              <button type="button" onClick={() => setDrawerOpen(true)} className="btn-primary mt-2">
                <Plus className="h-4 w-4" aria-hidden />
                New supplier
              </button>
            </div>
          }
        />
      </div>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="New supplier"
        description="Only the name is required. WHT defaults make bill entry quicker later."
      >
        <SupplierForm
          whtCodes={whtCodes}
          onCreated={(s) => {
            setRows((r) => [s, ...r]);
            setDrawerOpen(false);
          }}
        />
      </Drawer>
    </main>
  );
}
