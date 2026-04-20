"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus, Search, Users } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { Drawer } from "@/components/app/drawer";
import { CustomerForm } from "./customer-form";
import { formatLKR, initials } from "@/lib/format";
import type { Customer } from "@/lib/api";

export function CustomersClient({ initial }: { initial: Customer[] }) {
  const [rows, setRows] = useState<Customer[]>(initial);
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.city ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const columns: Column<Customer>[] = [
    {
      header: "Customer",
      accessor: (c) => (
        <Link href={`/app/customers/${c.id}`} className="group flex items-center gap-3">
          <div className="grid h-8 w-8 flex-none place-items-center rounded-full bg-mint-surface text-caption font-medium text-mint-dark">
            {initials(c.name)}
          </div>
          <div>
            <p className="font-medium text-charcoal group-hover:underline">{c.name}</p>
            {c.code && <p className="text-caption text-text-tertiary">{c.code}</p>}
          </div>
        </Link>
      ),
    },
    {
      header: "Contact",
      accessor: (c) => (
        <div>
          {c.email && <p className="text-small">{c.email}</p>}
          {c.phone && <p className="text-caption text-text-tertiary">{c.phone}</p>}
          {!c.email && !c.phone && <span className="text-text-tertiary">—</span>}
        </div>
      ),
    },
    {
      header: "City",
      accessor: (c) => c.city ?? <span className="text-text-tertiary">—</span>,
    },
    {
      header: "Terms",
      align: "right",
      accessor: (c) => (c.paymentTermsDays === 0 ? "Immediate" : `Net ${c.paymentTermsDays}d`),
    },
    {
      header: "Credit limit",
      align: "right",
      mono: true,
      accessor: (c) =>
        c.creditLimitCents > 0 ? (
          formatLKR(c.creditLimitCents)
        ) : (
          <span className="text-text-tertiary">—</span>
        ),
    },
    {
      header: "Status",
      align: "center",
      accessor: (c) => (
        <span
          className={`rounded-full px-2.5 py-0.5 text-caption ${
            c.isActive ? "bg-mint-surface text-mint-dark" : "bg-surface-recessed text-text-tertiary"
          }`}
        >
          {c.isActive ? "Active" : "Inactive"}
        </span>
      ),
    },
  ];

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Sell"
        title="Customers"
        description="Your customer master list. Credit terms, VAT numbers, and contact details — ready for invoicing."
        action={
          <button type="button" onClick={() => setDrawerOpen(true)} className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            New customer
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
                <Users className="h-5 w-5" />
              </div>
              <p className="text-body text-charcoal">No customers yet.</p>
              <p className="text-small">Add your first customer — you'll need them for the first invoice.</p>
              <button type="button" onClick={() => setDrawerOpen(true)} className="btn-primary mt-2">
                <Plus className="h-4 w-4" aria-hidden />
                New customer
              </button>
            </div>
          }
        />
      </div>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="New customer"
        description="Name is the only required field. Everything else can wait."
      >
        <CustomerForm
          onCreated={(c) => {
            setRows((r) => [c, ...r]);
            setDrawerOpen(false);
          }}
        />
      </Drawer>
    </main>
  );
}
