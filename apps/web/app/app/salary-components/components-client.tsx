"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, Lock, Pencil, ArrowUpRight, Loader2 } from "lucide-react";
import { Drawer } from "@/components/app/drawer";
import { Field } from "@/components/auth/field";
import { DataTable, type Column } from "@/components/app/data-table";
import { formatLKR } from "@/lib/format";
import {
  api,
  ApiError,
  type SalaryComponent,
  type SalaryCalculationBasis,
  type SalaryComponentKind,
} from "@/lib/api";

export function ComponentsClient({ initial }: { initial: SalaryComponent[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [open, setOpen] = useState<null | { mode: "create" } | { mode: "edit"; row: SalaryComponent }>(null);

  async function refresh() {
    const { components } = await api.listSalaryComponents();
    setRows(components);
    router.refresh();
  }

  const columns: Column<SalaryComponent>[] = [
    {
      header: "Code",
      accessor: (r) => (
        <div className="flex items-center gap-2">
          <span className="font-mono text-small font-medium text-charcoal">{r.code}</span>
          {r.isSystem && (
            <span title="System component" className="text-text-tertiary">
              <Lock className="h-3 w-3" aria-hidden />
            </span>
          )}
        </div>
      ),
    },
    {
      header: "Name",
      accessor: (r) => (
        <div>
          <p className="font-medium text-charcoal">{r.name}</p>
          <p className="text-caption text-text-tertiary">{basisLabel(r.calculationBasis)}</p>
        </div>
      ),
    },
    {
      header: "Kind",
      align: "center",
      accessor: (r) => (
        <span
          className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${
            r.kind === "earning"
              ? "bg-mint-surface text-mint-dark"
              : "bg-danger-bg/60 text-danger"
          }`}
        >
          {r.kind === "earning" ? "Earning" : "Deduction"}
        </span>
      ),
    },
    {
      header: "Default",
      align: "right",
      mono: true,
      accessor: (r) =>
        r.calculationBasis === "from_employee_basic"
          ? <span className="text-text-tertiary">—</span>
          : formatLKR(r.defaultAmountCents),
    },
    {
      header: "EPF",
      align: "center",
      accessor: (r) => <Flag on={r.countsForEpf} />,
    },
    {
      header: "ETF",
      align: "center",
      accessor: (r) => <Flag on={r.countsForEtf} />,
    },
    {
      header: "PAYE",
      align: "center",
      accessor: (r) => <Flag on={r.countsForPaye} />,
    },
    {
      header: "",
      align: "right",
      accessor: (r) => (
        <button
          type="button"
          onClick={() => setOpen({ mode: "edit", row: r })}
          className="btn-link inline-flex items-center gap-1 text-caption"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          Edit
        </button>
      ),
    },
  ];

  return (
    <>
      <div className="flex items-center justify-end pb-3">
        <button
          type="button"
          onClick={() => setOpen({ mode: "create" })}
          className="btn-primary"
        >
          <Plus className="h-4 w-4" aria-hidden />
          New component
        </button>
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        empty={
          <div className="flex flex-col items-center gap-2">
            <p className="text-body text-charcoal">No salary components yet.</p>
            <p className="text-small">Your first tenant seed should have populated the SL defaults.</p>
          </div>
        }
      />

      {open && (
        <ComponentDrawer
          mode={open.mode}
          row={open.mode === "edit" ? open.row : undefined}
          onClose={() => setOpen(null)}
          onSaved={async () => {
            setOpen(null);
            await refresh();
          }}
        />
      )}
    </>
  );
}

function basisLabel(b: SalaryCalculationBasis): string {
  if (b === "from_employee_basic") return "Pulls from employee's basic salary";
  if (b === "percent_of_basic") return "Percent of basic";
  return "Fixed amount per employee";
}

function Flag({ on }: { on: boolean }) {
  return on ? (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-mint-surface text-mint-dark">
      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  ) : (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface-recessed text-text-tertiary">
      <span className="h-0.5 w-2.5 bg-current" />
    </span>
  );
}

function ComponentDrawer({
  mode,
  row,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  row?: SalaryComponent;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<SalaryComponentKind>(row?.kind ?? "earning");
  const [basis, setBasis] = useState<SalaryCalculationBasis>(
    row?.calculationBasis ?? "fixed",
  );
  const [epf, setEpf] = useState(row?.countsForEpf ?? true);
  const [etf, setEtf] = useState(row?.countsForEtf ?? true);
  const [paye, setPaye] = useState(row?.countsForPaye ?? true);

  const locked = mode === "edit" && (row?.isSystem ?? false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const defaultLKR = Number(f.get("defaultAmount") ?? 0);
    const body = {
      code: String(f.get("code") ?? "").trim().toUpperCase(),
      name: String(f.get("name") ?? "").trim(),
      kind,
      calculationBasis: basis,
      defaultAmountCents: Number.isFinite(defaultLKR) ? Math.round(defaultLKR * 100) : 0,
      countsForEpf: epf,
      countsForEtf: etf,
      countsForPaye: paye,
      sortOrder: Number(f.get("sortOrder") ?? 500),
      notes: String(f.get("notes") ?? "").trim() || undefined,
    };

    try {
      if (mode === "create") {
        await api.createSalaryComponent(body);
      } else if (row) {
        // If row is system, API only accepts name/amount/flags — strip others.
        const patch = row.isSystem
          ? {
              name: body.name,
              defaultAmountCents: body.defaultAmountCents,
              countsForEpf: epf,
              countsForEtf: etf,
              countsForPaye: paye,
              sortOrder: body.sortOrder,
              notes: body.notes,
            }
          : body;
        await api.updateSalaryComponent(row.id, patch);
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the component.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={mode === "create" ? "New salary component" : `Edit · ${row?.code}`}
      description={
        locked
          ? "System component — code, kind and basis are locked. You can still rename it and edit its amount and statutory flags."
          : "Named line item that appears on a payslip. Flag which statutory bases it counts towards."
      }
    >
      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        <section className="grid grid-cols-2 gap-4">
          <Field
            label="Code"
            name="code"
            defaultValue={row?.code ?? ""}
            placeholder="ATT_BONUS"
            disabled={locked}
            required
            hint="Uppercase letters, digits, underscore"
          />
          <Field label="Name" name="name" defaultValue={row?.name ?? ""} required />
        </section>

        <section className="space-y-3">
          <h3 className="text-caption font-medium uppercase tracking-wide text-text-tertiary">Kind</h3>
          <div className="grid grid-cols-2 gap-2">
            {(["earning", "deduction"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => !locked && setKind(k)}
                disabled={locked}
                className={`rounded-md border-hairline py-2 text-small transition ${
                  kind === k
                    ? "border-charcoal bg-charcoal text-offwhite"
                    : "border-border bg-surface-elevated text-text-secondary hover:border-charcoal hover:text-charcoal disabled:opacity-60"
                }`}
              >
                {k === "earning" ? "Earning" : "Deduction"}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-caption font-medium uppercase tracking-wide text-text-tertiary">Calculation</h3>
          <div className="grid grid-cols-1 gap-2">
            {(
              [
                { value: "fixed", label: "Fixed amount", hint: "Per-employee LKR amount set in their structure" },
                { value: "percent_of_basic", label: "Percent of basic", hint: "Basis-point rate applied to basic salary" },
                { value: "from_employee_basic", label: "Pulls from employee basic", hint: "Reads employees.basic_salary — for the \"Basic\" row only" },
              ] as Array<{ value: SalaryCalculationBasis; label: string; hint: string }>
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => !locked && setBasis(opt.value)}
                disabled={locked}
                className={`flex flex-col items-start gap-0.5 rounded-md border-hairline px-3 py-2 text-left text-small transition ${
                  basis === opt.value
                    ? "border-charcoal bg-charcoal text-offwhite"
                    : "border-border bg-surface-elevated text-text-secondary hover:border-charcoal hover:text-charcoal disabled:opacity-60"
                }`}
              >
                <span className="font-medium">{opt.label}</span>
                <span className={`text-caption ${basis === opt.value ? "text-offwhite/80" : "text-text-tertiary"}`}>{opt.hint}</span>
              </button>
            ))}
          </div>
        </section>

        {basis === "fixed" && (
          <Field
            label="Default amount (LKR)"
            name="defaultAmount"
            type="number"
            min={0}
            step="100"
            defaultValue={row ? String(row.defaultAmountCents / 100) : "0"}
            hint="Pre-filled when assigning this component to an employee; they can override."
          />
        )}

        <section className="space-y-3">
          <h3 className="text-caption font-medium uppercase tracking-wide text-text-tertiary">
            Statutory basis
          </h3>
          <div className="grid grid-cols-3 gap-2">
            <Toggle label="EPF" checked={epf} onChange={setEpf} />
            <Toggle label="ETF" checked={etf} onChange={setEtf} />
            <Toggle label="PAYE" checked={paye} onChange={setPaye} />
          </div>
          <p className="text-caption text-text-tertiary">
            On an earning, these flags add to the basis. On a deduction (e.g.
            no-pay leave), they <em>reduce</em> the basis. A deduction with
            every flag off is a post-tax recovery — it just trims take-home.
          </p>
        </section>

        <Field
          label="Sort order"
          name="sortOrder"
          type="number"
          min={0}
          step="10"
          defaultValue={row ? String(row.sortOrder) : "500"}
          hint="Lower numbers appear first on payslips."
        />

        <div>
          <label htmlFor="notes" className="block text-small font-medium text-charcoal">
            Notes
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={2}
            defaultValue={row?.notes ?? ""}
            className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal placeholder:text-text-tertiary focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
          />
        </div>

        {error && (
          <div role="alert" className="rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-3 text-small text-danger">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-link">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Saving…
              </>
            ) : (
              mode === "create" ? "Create component" : "Save changes"
            )}
          </button>
        </div>
      </form>
    </Drawer>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={`rounded-md border-hairline py-2 text-small transition ${
        checked
          ? "border-charcoal bg-charcoal text-offwhite"
          : "border-border bg-surface-elevated text-text-secondary hover:border-charcoal hover:text-charcoal"
      }`}
    >
      {label}
    </button>
  );
}
