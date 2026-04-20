"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { Drawer } from "@/components/app/drawer";
import { Field } from "@/components/auth/field";
import {
  api,
  ApiError,
  type EmployeeListRow,
  type SalaryComponent,
  type EmployeeStructureRow,
} from "@/lib/api";
import { formatLKR } from "@/lib/format";

type DraftRow = {
  key: string;
  componentId: string;
  amountCents: number;
};

export function SalaryStructureDrawer({
  employee,
  library,
  onClose,
  onSaved,
}: {
  employee: EmployeeListRow;
  library: SalaryComponent[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [structure, setStructure] = useState<EmployeeStructureRow[]>([]);
  const [draft, setDraft] = useState<DraftRow[]>([]);
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { structure } = await api.getSalaryStructure(employee.id);
        if (cancelled) return;
        setStructure(structure);
        // Pre-fill draft from the current structure. If none exist, seed Basic
        // from the employee's basic_salary so the first-save lands cleanly.
        if (structure.length === 0) {
          const basic = library.find((c) => c.code === "BASIC");
          if (basic) {
            setDraft([
              {
                key: crypto.randomUUID(),
                componentId: basic.id,
                amountCents: employee.basicSalaryCents,
              },
            ]);
          }
        } else {
          setDraft(
            structure.map((s) => ({
              key: s.id,
              componentId: s.componentId,
              amountCents: s.amountCents,
            })),
          );
        }
      } catch {
        if (!cancelled) setError("Couldn't load the salary structure.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employee.id, employee.basicSalaryCents, library]);

  const usedIds = new Set(draft.map((d) => d.componentId));
  const availableComponents = library.filter((c) => c.isActive && !usedIds.has(c.id));

  // Live totals — compute a preview so the user can see gross/net before saving
  const preview = previewTotals(draft, library, employee.basicSalaryCents);

  function addRow(componentId: string) {
    const comp = library.find((c) => c.id === componentId);
    if (!comp) return;
    let amount = comp.defaultAmountCents;
    if (comp.calculationBasis === "from_employee_basic") amount = employee.basicSalaryCents;
    setDraft((d) => [...d, { key: crypto.randomUUID(), componentId, amountCents: amount }]);
  }

  function updateRow(key: string, patch: Partial<DraftRow>) {
    setDraft((d) => d.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeRow(key: string) {
    setDraft((d) => d.filter((r) => r.key !== key));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.putSalaryStructure(employee.id, {
        effectiveFrom,
        items: draft.map((d) => ({
          componentId: d.componentId,
          amountCents: d.amountCents,
        })),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the structure.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Salary structure · ${employee.fullName}`}
      description="Every component on this employee's payslip. The next payroll run reads from here."
    >
      {loading ? (
        <div className="flex items-center justify-center py-12 text-text-tertiary">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-6" noValidate>
          <section className="space-y-2">
            <h3 className="text-caption font-medium uppercase tracking-wide text-text-tertiary">
              Effective from
            </h3>
            <input
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              className="w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
              required
            />
            {structure.length > 0 && (
              <p className="text-caption text-text-tertiary">
                Previous structure will be closed out on {effectiveFrom} and archived for audit.
              </p>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-caption font-medium uppercase tracking-wide text-text-tertiary">
              Components
            </h3>
            {draft.length === 0 && (
              <p className="rounded-md border-hairline border-dashed border-border p-4 text-caption text-text-tertiary">
                No components yet. Add Basic first.
              </p>
            )}
            <div className="space-y-2">
              {draft.map((row) => {
                const comp = library.find((c) => c.id === row.componentId);
                if (!comp) return null;
                const readOnly = comp.calculationBasis === "from_employee_basic";
                return (
                  <div
                    key={row.key}
                    className="grid grid-cols-[1fr_auto_auto] items-start gap-3 rounded-md border-hairline border-border bg-surface-elevated p-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-charcoal">{comp.name}</span>
                        <span className="font-mono text-micro text-text-tertiary">{comp.code}</span>
                        <KindBadge kind={comp.kind} />
                      </div>
                      <p className="text-caption text-text-tertiary">
                        {basisHint(comp.calculationBasis, employee.basicSalaryCents)}
                        {" · "}
                        <StatutoryBasis comp={comp} />
                      </p>
                    </div>
                    <div>
                      <label className="block text-micro text-text-tertiary">
                        {readOnly ? "Reads from basic" : "LKR"}
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="100"
                        value={row.amountCents / 100}
                        disabled={readOnly}
                        onChange={(e) =>
                          updateRow(row.key, {
                            amountCents: Math.round(Number(e.target.value) * 100),
                          })
                        }
                        className="w-32 rounded-md border-hairline border-border-emphasis bg-surface px-2 py-1.5 text-right text-small tabular-nums text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal disabled:bg-surface-recessed disabled:text-text-tertiary"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      className="mt-4 text-text-tertiary hover:text-danger"
                      aria-label="Remove"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                );
              })}
            </div>

            {availableComponents.length > 0 && (
              <div className="pt-2">
                <label className="block text-caption font-medium uppercase tracking-wide text-text-tertiary">
                  Add component
                </label>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      addRow(e.target.value);
                      e.target.value = "";
                    }
                  }}
                  className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
                >
                  <option value="" disabled>
                    Pick from library…
                  </option>
                  <optgroup label="Earnings">
                    {availableComponents
                      .filter((c) => c.kind === "earning")
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.code})
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Deductions">
                    {availableComponents
                      .filter((c) => c.kind === "deduction")
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.code})
                        </option>
                      ))}
                  </optgroup>
                </select>
              </div>
            )}
          </section>

          <section className="rounded-md bg-mint-surface/60 p-3 text-small">
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Earnings</span>
              <span className="tabular-nums font-medium text-charcoal">{formatLKR(preview.earnings)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Deductions (pre-tax)</span>
              <span className="tabular-nums text-charcoal">-{formatLKR(preview.preTaxDeductions)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Est. EPF employee (8%)</span>
              <span className="tabular-nums text-charcoal">-{formatLKR(preview.epfEmployee)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Est. PAYE</span>
              <span className="tabular-nums text-charcoal">-{formatLKR(preview.paye)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Post-tax recoveries</span>
              <span className="tabular-nums text-charcoal">-{formatLKR(preview.postTaxDeductions)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t-hairline border-border pt-2 text-body">
              <span className="font-medium text-charcoal">Est. net take-home</span>
              <span className="tabular-nums font-medium text-mint-dark">{formatLKR(preview.net)}</span>
            </div>
            <p className="mt-2 text-micro text-text-tertiary">
              Preview only. The run uses the exact IRD slabs at compute time.
            </p>
          </section>

          {error && (
            <div role="alert" className="rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-3 text-small text-danger">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-link">
              Cancel
            </button>
            <button type="submit" disabled={busy || draft.length === 0} className="btn-primary">
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Saving…
                </>
              ) : (
                "Save structure"
              )}
            </button>
          </div>
        </form>
      )}
    </Drawer>
  );
}

function basisHint(basis: SalaryComponent["calculationBasis"], basicCents: number): string {
  if (basis === "from_employee_basic") return `Fixed at employee basic (${formatLKR(basicCents)})`;
  if (basis === "percent_of_basic") return "Percent of basic";
  return "Fixed amount";
}

function StatutoryBasis({ comp }: { comp: SalaryComponent }) {
  const flags: string[] = [];
  if (comp.countsForEpf) flags.push("EPF");
  if (comp.countsForEtf) flags.push("ETF");
  if (comp.countsForPaye) flags.push("PAYE");
  if (flags.length === 0) return <span className="text-text-tertiary">Off all statutory</span>;
  return <span>Counts for {flags.join(" · ")}</span>;
}

function KindBadge({ kind }: { kind: "earning" | "deduction" }) {
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-micro font-medium ${
        kind === "earning" ? "bg-mint-surface text-mint-dark" : "bg-danger-bg/60 text-danger"
      }`}
    >
      {kind === "earning" ? "earning" : "deduction"}
    </span>
  );
}

// ------------------------------------------------------------------------------
// Client-side preview — mirrors the server compute to keep the drawer honest.
// ------------------------------------------------------------------------------
function previewTotals(
  draft: DraftRow[],
  library: SalaryComponent[],
  employeeBasicCents: number,
) {
  let earnings = 0;
  let preTaxDed = 0;
  let postTaxDed = 0;
  let epfBasis = 0;
  let payeBasis = 0;

  for (const r of draft) {
    const c = library.find((x) => x.id === r.componentId);
    if (!c) continue;
    const amount =
      c.calculationBasis === "from_employee_basic" ? employeeBasicCents : r.amountCents;
    if (amount <= 0) continue;

    if (c.kind === "earning") {
      earnings += amount;
      if (c.countsForEpf) epfBasis += amount;
      if (c.countsForPaye) payeBasis += amount;
    } else {
      if (c.countsForEpf) {
        epfBasis -= amount;
        preTaxDed += amount;
      }
      if (c.countsForPaye) payeBasis -= amount;
      if (!c.countsForEpf && !c.countsForEtf && !c.countsForPaye) {
        postTaxDed += amount;
      }
    }
  }

  epfBasis = Math.max(0, epfBasis);
  payeBasis = Math.max(0, payeBasis);

  const epfEmployee = Math.round((epfBasis * 800) / 10000);
  const paye = computePayePreview(payeBasis);

  // Net = earnings − every deduction − EPF employee − PAYE
  let cashEarnings = earnings;
  for (const r of draft) {
    const c = library.find((x) => x.id === r.componentId);
    if (!c) continue;
    if (c.kind === "deduction") {
      const amount =
        c.calculationBasis === "from_employee_basic" ? employeeBasicCents : r.amountCents;
      cashEarnings -= Math.max(0, amount);
    }
  }
  const net = Math.max(0, cashEarnings - epfEmployee - paye);

  return {
    earnings,
    preTaxDeductions: preTaxDed,
    postTaxDeductions: postTaxDed,
    epfEmployee,
    paye,
    net,
  };
}

const PAYE_BRACKETS = [
  { from: 0, to: 10_000_000, bps: 0 },
  { from: 10_000_000, to: 14_166_700, bps: 600 },
  { from: 14_166_700, to: 18_333_400, bps: 1200 },
  { from: 18_333_400, to: 22_500_100, bps: 1800 },
  { from: 22_500_100, to: 26_666_800, bps: 2400 },
  { from: 26_666_800, to: 30_833_500, bps: 3000 },
  { from: 30_833_500, to: Number.MAX_SAFE_INTEGER, bps: 3600 },
];

function computePayePreview(basisCents: number): number {
  if (basisCents <= 0) return 0;
  let tax = 0;
  for (const b of PAYE_BRACKETS) {
    const inSlab = Math.max(0, Math.min(basisCents, b.to) - b.from);
    if (inSlab > 0) tax += Math.round((inSlab * b.bps) / 10000);
  }
  return tax;
}
