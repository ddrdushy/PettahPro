"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2, TrendingUp, TrendingDown, History } from "lucide-react";
import { Drawer } from "@/components/app/drawer";
import {
  api,
  ApiError,
  type EmployeeListRow,
  type SalaryRevision,
} from "@/lib/api";
import { formatLKR, formatDate } from "@/lib/format";

/**
 * Salary revisions — the paper trail of basic-salary changes.
 *
 * Saving a revision updates `employees.basic_salary_cents` immediately. If
 * the revision effective date is in a prior payroll period, the difference
 * for every intervening full month lands as an ARREARS earning line on the
 * next payroll run (counts for EPF/ETF/PAYE per spec §14.4).
 *
 * Back-dated revisions that land in a closed accounting period are blocked
 * server-side (423 PERIOD_LOCKED) — the user must reopen the period first.
 */
export function SalaryRevisionsDrawer({
  employee,
  onClose,
  onSaved,
}: {
  employee: EmployeeListRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<SalaryRevision[]>([]);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [effectiveDate, setEffectiveDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [newBasic, setNewBasic] = useState<number>(employee.basicSalaryCents);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { revisions } = await api.listSalaryRevisions(employee.id);
        if (!cancelled) setRevisions(revisions);
      } catch {
        if (!cancelled) setError("Couldn't load salary revision history.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employee.id]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { revision } = await api.createSalaryRevision(employee.id, {
        effectiveDate,
        newBasicSalaryCents: Math.round(newBasic),
        reason: reason.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setRevisions((r) => [revision, ...r]);
      setShowForm(false);
      setReason("");
      setNotes("");
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "PERIOD_LOCKED") {
          setError(
            "That effective date falls in a closed accounting period. Reopen the period (Accounting → Periods) before recording this revision.",
          );
        } else {
          setError(err.message);
        }
      } else {
        setError("Couldn't save the revision.");
      }
    } finally {
      setBusy(false);
    }
  }

  const currentBasic = employee.basicSalaryCents;
  const diff = Math.round(newBasic) - currentBasic;

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Salary revisions · ${employee.fullName}`}
      description="History of basic-salary changes. Back-dated revisions auto-arrears on the next payroll run."
    >
      <div className="space-y-6">
        {/* Current rate */}
        <section className="rounded-md border-hairline border-border bg-surface-elevated p-4">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">
            Current basic
          </p>
          <p className="tabular-nums mt-1 text-h2 text-charcoal">
            {formatLKR(currentBasic)}
          </p>
          <p className="mt-1 text-caption text-text-secondary">
            Used by every payroll run until a new revision is recorded.
          </p>
        </section>

        {/* New revision form */}
        {!showForm ? (
          <button
            type="button"
            onClick={() => {
              setShowForm(true);
              setNewBasic(currentBasic);
              setReason("");
              setNotes("");
            }}
            className="btn-primary w-full justify-center"
          >
            Record a revision
          </button>
        ) : (
          <form
            onSubmit={onSubmit}
            className="space-y-4 rounded-md border-hairline border-border bg-surface-elevated p-4"
            noValidate
          >
            <div>
              <label className="block text-caption font-medium uppercase tracking-wide text-text-tertiary">
                Effective from
              </label>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface px-3 py-2.5 text-body text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
                required
              />
              <p className="mt-1 text-caption text-text-tertiary">
                Back-dated? Arrears for the intervening full months land on the
                next payroll run automatically.
              </p>
            </div>

            <div>
              <label className="block text-caption font-medium uppercase tracking-wide text-text-tertiary">
                New basic (LKR)
              </label>
              <input
                type="number"
                min={0}
                step="100"
                value={newBasic / 100}
                onChange={(e) => setNewBasic(Math.round(Number(e.target.value) * 100))}
                className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface px-3 py-2.5 text-right text-body tabular-nums text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
                required
              />
              {diff !== 0 && (
                <p
                  className={`mt-1 text-caption ${
                    diff > 0 ? "text-mint-dark" : "text-danger"
                  }`}
                >
                  {diff > 0 ? "+" : "−"}
                  {formatLKR(Math.abs(diff))} vs. current (
                  {((diff / Math.max(1, currentBasic)) * 100).toFixed(1)}%)
                </p>
              )}
            </div>

            <div>
              <label className="block text-caption font-medium uppercase tracking-wide text-text-tertiary">
                Reason (optional)
              </label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={255}
                placeholder="e.g. Annual increment 2026"
                className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface px-3 py-2.5 text-body text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
              />
            </div>

            <div>
              <label className="block text-caption font-medium uppercase tracking-wide text-text-tertiary">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface px-3 py-2 text-body text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-3 text-small text-danger"
              >
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setError(null);
                }}
                className="btn-link"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || Math.round(newBasic) === currentBasic}
                className="btn-primary"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Saving…
                  </>
                ) : (
                  "Save revision"
                )}
              </button>
            </div>
          </form>
        )}

        {/* History */}
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-caption font-medium uppercase tracking-wide text-text-tertiary">
            <History className="h-3.5 w-3.5" aria-hidden />
            History
          </h3>
          {loading ? (
            <div className="flex items-center justify-center py-6 text-text-tertiary">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            </div>
          ) : revisions.length === 0 ? (
            <p className="rounded-md border-hairline border-dashed border-border p-4 text-caption text-text-tertiary">
              No revisions yet — this employee has always been at the current
              basic since hire.
            </p>
          ) : (
            <ol className="space-y-2">
              {revisions.map((r) => (
                <RevisionRow key={r.id} r={r} />
              ))}
            </ol>
          )}
        </section>
      </div>
    </Drawer>
  );
}

function RevisionRow({ r }: { r: SalaryRevision }) {
  const diff = r.newBasicSalaryCents - r.previousBasicSalaryCents;
  const up = diff >= 0;
  return (
    <li className="rounded-md border-hairline border-border bg-surface-elevated p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {up ? (
              <TrendingUp className="h-4 w-4 text-mint-dark" aria-hidden />
            ) : (
              <TrendingDown className="h-4 w-4 text-danger" aria-hidden />
            )}
            <p className="text-body font-medium text-charcoal">
              {formatLKR(r.previousBasicSalaryCents)} →{" "}
              {formatLKR(r.newBasicSalaryCents)}
            </p>
          </div>
          <p className="mt-1 text-caption text-text-secondary">
            Effective {formatDate(r.effectiveDate)}
            {r.reason && ` · ${r.reason}`}
          </p>
          {r.notes && (
            <p className="mt-1 text-caption text-text-tertiary">{r.notes}</p>
          )}
        </div>
        <div className="text-right">
          <span
            className={`rounded-full px-2 py-0.5 text-micro font-medium ${
              up ? "bg-mint-surface text-mint-dark" : "bg-danger-bg/60 text-danger"
            }`}
          >
            {up ? "+" : "−"}
            {formatLKR(Math.abs(diff))}
          </span>
          <p className="mt-1 text-micro text-text-tertiary">
            {r.appliedInRunId ? (
              <>
                Applied
                {r.arrearsCentsApplied !== null &&
                  r.arrearsCentsApplied !== 0 &&
                  ` · ${formatLKR(Math.abs(r.arrearsCentsApplied))} arrears`}
              </>
            ) : (
              "Pending arrears"
            )}
          </p>
        </div>
      </div>
    </li>
  );
}
