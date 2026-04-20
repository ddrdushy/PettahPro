"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, UserRound, Layers } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { Drawer } from "@/components/app/drawer";
import { EmployeeForm } from "./employee-form";
import { SalaryStructureDrawer } from "./salary-structure-drawer";
import { formatLKR, formatDate, initials } from "@/lib/format";
import type { EmployeeListRow, EmployeeStatus, SalaryComponent } from "@/lib/api";

const statusTone: Record<EmployeeStatus, string> = {
  active: "bg-mint-surface text-mint-dark",
  on_probation: "bg-warning-bg text-warning",
  confirmed: "bg-mint-surface text-mint-dark",
  suspended: "bg-warning-bg text-warning",
  resigned: "bg-surface-recessed text-text-tertiary",
  terminated: "bg-danger-bg/60 text-danger",
  retired: "bg-surface-recessed text-text-tertiary",
  deceased: "bg-surface-recessed text-text-tertiary",
};

const statusLabel: Record<EmployeeStatus, string> = {
  active: "Active",
  on_probation: "On probation",
  confirmed: "Confirmed",
  suspended: "Suspended",
  resigned: "Resigned",
  terminated: "Terminated",
  retired: "Retired",
  deceased: "Deceased",
};

export function EmployeesClient({
  initial,
  components,
}: {
  initial: EmployeeListRow[];
  components: SalaryComponent[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<EmployeeListRow[]>(initial);
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [salaryFor, setSalaryFor] = useState<EmployeeListRow | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (e) =>
        e.fullName.toLowerCase().includes(q) ||
        (e.employeeCode ?? "").toLowerCase().includes(q) ||
        (e.designation ?? "").toLowerCase().includes(q) ||
        (e.department ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const activeCount = rows.filter((e) => e.status === "active" || e.status === "confirmed").length;
  const payrollValueCents = rows
    .filter((e) => ["active", "confirmed", "on_probation"].includes(e.status))
    .reduce((s, e) => s + e.basicSalaryCents, 0);

  const columns: Column<EmployeeListRow>[] = [
    {
      header: "Employee",
      accessor: (e) => (
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 flex-none place-items-center rounded-full bg-mint-surface text-caption font-medium text-mint-dark">
            {initials(e.fullName)}
          </div>
          <div>
            <p className="font-medium text-charcoal">{e.fullName}</p>
            {e.employeeCode && (
              <p className="text-caption text-text-tertiary">{e.employeeCode}</p>
            )}
          </div>
        </div>
      ),
    },
    {
      header: "Role",
      accessor: (e) => (
        <div>
          {e.designation && <p className="text-small text-charcoal">{e.designation}</p>}
          {e.department && (
            <p className="text-caption text-text-tertiary">{e.department}</p>
          )}
          {!e.designation && !e.department && (
            <span className="text-text-tertiary">—</span>
          )}
        </div>
      ),
    },
    {
      header: "Type",
      accessor: (e) => <span className="text-small capitalize">{e.employmentType}</span>,
    },
    {
      header: "Hired",
      accessor: (e) => formatDate(e.hireDate),
    },
    {
      header: "NIC",
      accessor: (e) =>
        e.nic ? (
          <span className="tabular-nums text-small">{e.nic}</span>
        ) : (
          <span className="text-text-tertiary">—</span>
        ),
    },
    {
      header: "Basic salary",
      align: "right",
      mono: true,
      accessor: (e) =>
        e.basicSalaryCents > 0 ? (
          <span className="font-medium text-charcoal">{formatLKR(e.basicSalaryCents)}</span>
        ) : (
          <span className="text-text-tertiary">—</span>
        ),
    },
    {
      header: "Statutory",
      accessor: (e) => (
        <div className="flex gap-1">
          {e.epfEligible && (
            <span className="rounded-full bg-mint-surface px-1.5 py-0.5 text-micro text-mint-dark">EPF</span>
          )}
          {e.etfEligible && (
            <span className="rounded-full bg-mint-surface px-1.5 py-0.5 text-micro text-mint-dark">ETF</span>
          )}
          {e.payeApplicable && (
            <span className="rounded-full bg-mint-surface px-1.5 py-0.5 text-micro text-mint-dark">PAYE</span>
          )}
        </div>
      ),
    },
    {
      header: "Status",
      align: "center",
      accessor: (e) => (
        <span className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusTone[e.status]}`}>
          {statusLabel[e.status]}
        </span>
      ),
    },
    {
      header: "",
      align: "right",
      accessor: (e) => (
        <button
          type="button"
          onClick={() => setSalaryFor(e)}
          className="btn-link inline-flex items-center gap-1 text-caption"
        >
          <Layers className="h-3.5 w-3.5" aria-hidden />
          Salary
        </button>
      ),
    },
  ];

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="HR"
        title="Employees"
        description="Your team. NIC, EPF, ETF numbers and basic salary all in one place — the foundation every payroll run reads from."
        action={
          <button type="button" onClick={() => setDrawerOpen(true)} className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            New employee
          </button>
        }
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Kpi label="Active headcount" value={String(activeCount)} sub={`of ${rows.length} total`} tone="mint" />
        <Kpi label="Monthly basic salary" value={formatLKR(payrollValueCents)} sub="Sum of all active basics" />
        <Kpi label="EPF-liable" value={String(rows.filter((e) => e.epfEligible && e.status === "active").length)} sub="Contributes 12% employer + 8% employee" />
      </div>

      <div className="mt-6 flex items-center gap-3">
        <label className="relative block flex-1 max-w-sm">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, code, role, or department…"
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
                <UserRound className="h-5 w-5" />
              </div>
              <p className="text-body text-charcoal">No employees yet.</p>
              <p className="text-small">Add employees here before running your first payroll.</p>
              <button type="button" onClick={() => setDrawerOpen(true)} className="btn-primary mt-2">
                <Plus className="h-4 w-4" aria-hidden />
                New employee
              </button>
            </div>
          }
        />
      </div>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="New employee"
        description="Identity, hire date, and basic salary are the minimum. EPF/ETF details can come later."
      >
        <EmployeeForm
          onCreated={(e) => {
            setRows((r) => [e as EmployeeListRow, ...r]);
            setDrawerOpen(false);
          }}
        />
      </Drawer>

      {salaryFor && (
        <SalaryStructureDrawer
          employee={salaryFor}
          library={components}
          onClose={() => setSalaryFor(null)}
          onSaved={() => {
            setSalaryFor(null);
            router.refresh();
          }}
        />
      )}
    </main>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "mint";
}) {
  const dot = tone === "mint" ? "bg-mint" : "bg-text-tertiary";
  return (
    <div className="rounded-card border-hairline border-border bg-surface-elevated p-5">
      <div className="flex items-center justify-between">
        <p className="text-caption uppercase tracking-wide text-text-tertiary">{label}</p>
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
      </div>
      <p className="tabular-nums mt-2 text-h2 text-charcoal">{value}</p>
      {sub && <p className="mt-1 text-caption text-text-secondary">{sub}</p>}
    </div>
  );
}
