"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Check, Loader2, Pencil, X } from "lucide-react";
import {
  api,
  ApiError,
  type BonusRunLine,
  type BonusRunRow,
  type BonusRunStatus,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

const statusStyles: Record<BonusRunStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  pending_approval: "bg-warning-bg text-warning",
  posted: "bg-mint-surface text-mint-dark",
  void: "bg-danger-bg/60 text-danger",
};

const statusLabels: Record<BonusRunStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  posted: "Posted",
  void: "Void",
};

export function BonusRunDetailClient({
  run: initialRun,
  lines: initialLines,
}: {
  run: BonusRunRow;
  lines: BonusRunLine[];
}) {
  const router = useRouter();
  const [run, setRun] = useState(initialRun);
  const [lines, setLines] = useState(initialLines);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("0");
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  const isDraft = run.status === "draft";

  async function refresh() {
    const res = await api.getBonusRun(run.id);
    setRun(res.run);
    setLines(res.lines);
  }

  function startEdit(line: BonusRunLine) {
    setEditingId(line.id);
    setEditValue((line.bonusGrossCents / 100).toString());
    setError(null);
  }

  async function saveEdit(line: BonusRunLine) {
    setBusy(true);
    setError(null);
    try {
      const cents = Math.round(Number(editValue || "0") * 100);
      await api.adjustBonusRunLine(run.id, line.id, { bonusGrossCents: cents });
      await refresh();
      setEditingId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  async function post() {
    if (!confirm(`Post ${run.label}? This books the journal and marks the run posted.`))
      return;
    setBusy(true);
    setError(null);
    try {
      await api.postBonusRun(run.id);
      await refresh();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't post.");
    } finally {
      setBusy(false);
    }
  }

  async function submitVoid() {
    if (!voidReason.trim()) {
      setError("Reason is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.voidBonusRun(run.id, { reason: voidReason.trim() });
      await refresh();
      setVoidOpen(false);
      setVoidReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't void.");
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!confirm("Discard this draft bonus run?")) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteBonusRun(run.id);
      router.push("/app/bonus-runs");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete.");
      setBusy(false);
    }
  }

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="HR"
        title={run.label}
        description={`${run.runNumber ?? "—"} · ${run.schemeName ?? ""} (${run.schemeCode ?? ""}) · Pay date ${formatDate(run.payDate)}`}
        action={
          <Link href="/app/bonus-runs" className="btn-secondary">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back
          </Link>
        }
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[run.status]}`}
        >
          {statusLabels[run.status]}
        </span>
        {run.postedAt && (
          <span className="text-caption text-text-tertiary">
            Posted {formatDate(run.postedAt.slice(0, 10))}
          </span>
        )}
        {run.voidAt && (
          <span className="text-caption text-text-tertiary">
            Voided {formatDate(run.voidAt.slice(0, 10))}
          </span>
        )}
      </div>

      {run.status === "pending_approval" && (
        <section className="mt-6 rounded-card border-hairline border-warning/40 bg-warning-bg p-5">
          <p className="text-caption uppercase tracking-wide text-warning">
            Awaiting approval
          </p>
          <p className="mt-1 text-small text-charcoal">
            A bonus approval policy matched this run. The JE posts and payslips
            become visible once the approver signs off.
          </p>
          <Link
            href="/app/approvals"
            className="btn-link mt-2 inline-flex text-small"
          >
            Open approvals queue →
          </Link>
        </section>
      )}

      {/* Totals */}
      <section className="mt-6 grid gap-3 md:grid-cols-4">
        <StatCard label="Employees" value={`${run.employeeCount}`} />
        <StatCard label="Gross" value={formatLKR(run.grossCents)} emphasis />
        <StatCard
          label="Statutory"
          value={formatLKR(
            run.epfEmployeeCents + run.epfEmployerCents + run.etfEmployerCents + run.payeCents,
          )}
          sub={`EPF ${formatLKR(run.epfEmployeeCents + run.epfEmployerCents)} · ETF ${formatLKR(run.etfEmployerCents)} · PAYE ${formatLKR(run.payeCents)}`}
        />
        <StatCard label="Net pay" value={formatLKR(run.netPayCents)} emphasis />
      </section>

      {/* Actions */}
      {isDraft && (
        <section className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={post}
            disabled={busy || run.employeeCount === 0 || run.grossCents === 0}
            className="btn-primary disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Post
          </button>
          <button
            type="button"
            onClick={discard}
            disabled={busy}
            className="btn-secondary disabled:opacity-50"
          >
            Discard draft
          </button>
          {error && <span className="text-small text-danger">{error}</span>}
        </section>
      )}

      {run.status === "posted" && (
        <section className="mt-6 flex flex-wrap items-center gap-3">
          {run.journalEntryId && (
            <Link
              href={`/app/journals/${run.journalEntryId}`}
              className="text-small text-mint-dark underline-offset-4 hover:underline"
            >
              View journal entry →
            </Link>
          )}
          <button
            type="button"
            onClick={() => setVoidOpen((v) => !v)}
            disabled={busy}
            className="btn-secondary disabled:opacity-50"
          >
            {voidOpen ? "Cancel" : "Void run"}
          </button>
          {error && <span className="text-small text-danger">{error}</span>}
        </section>
      )}

      {voidOpen && (
        <section className="mt-4 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">
            Void reason
          </label>
          <textarea
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            rows={3}
            placeholder="Why is this run being voided?"
            className="input mt-1.5"
          />
          <div className="mt-3 flex justify-end gap-3">
            <button
              type="button"
              onClick={submitVoid}
              disabled={busy}
              className="btn-danger disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Confirm void
            </button>
          </div>
        </section>
      )}

      {run.status === "void" && run.voidReason && (
        <section className="mt-6 rounded-card border-hairline border-danger-bg bg-danger-bg/20 p-4">
          <p className="text-caption uppercase tracking-wide text-danger">Void reason</p>
          <p className="mt-1 text-small text-text-primary">{run.voidReason}</p>
        </section>
      )}

      {/* Lines */}
      <section className="mt-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <table className="w-full text-small">
          <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="px-4 py-3 text-left">Employee</th>
              <th className="w-28 px-4 py-3 text-right">Basic</th>
              <th className="w-32 px-4 py-3 text-right">Bonus gross</th>
              <th className="w-24 px-4 py-3 text-right">EPF (ee)</th>
              <th className="w-24 px-4 py-3 text-right">ETF (er)</th>
              <th className="w-24 px-4 py-3 text-right">PAYE</th>
              <th className="w-28 px-4 py-3 text-right">Net</th>
              {isDraft && <th className="w-20 px-4 py-3 text-center">Adjust</th>}
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            {lines.map((l) => {
              const editing = editingId === l.id;
              return (
                <tr key={l.id}>
                  <td className="px-4 py-3 text-text-primary">
                    {l.employeeFullName}
                    {l.employeeCode && (
                      <span className="ml-2 text-caption text-text-tertiary">
                        {l.employeeCode}
                      </span>
                    )}
                    {l.designation && (
                      <p className="text-caption text-text-tertiary">{l.designation}</p>
                    )}
                    {l.wasManuallyAdjusted && (
                      <span className="mt-1 inline-block rounded-full bg-warning-bg/60 px-1.5 py-0.5 text-caption text-warning">
                        Adjusted
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {formatLKR(l.basicAtRunCents)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {editing ? (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="input w-28 text-right tabular-nums"
                      />
                    ) : (
                      <span className="font-medium text-charcoal">{formatLKR(l.bonusGrossCents)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {l.wasEpfApplied ? formatLKR(l.epfEmployeeCents) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {l.wasEtfApplied ? formatLKR(l.etfEmployerCents) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {l.wasPayeApplied ? formatLKR(l.payeCents) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                    {formatLKR(l.netPayCents)}
                  </td>
                  {isDraft && (
                    <td className="px-4 py-3 text-center">
                      {editing ? (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => saveEdit(l)}
                            disabled={busy}
                            className="rounded-full bg-mint-surface p-1 text-mint-dark hover:bg-mint disabled:opacity-50"
                            aria-label="Save"
                          >
                            <Check className="h-3.5 w-3.5" aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            disabled={busy}
                            className="rounded-full bg-surface-recessed p-1 text-text-secondary hover:bg-warning-bg disabled:opacity-50"
                            aria-label="Cancel"
                          >
                            <X className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(l)}
                          className="rounded-full bg-surface-recessed p-1.5 text-text-secondary transition hover:bg-mint-surface hover:text-mint-dark"
                          aria-label="Adjust"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {run.notes && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-4">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Notes</p>
          <p className="mt-1 text-small text-text-primary whitespace-pre-wrap">{run.notes}</p>
        </section>
      )}
    </main>
  );
}

function StatCard({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-card border-hairline p-5 ${
        emphasis ? "border-charcoal/20 bg-mint-surface/40" : "border-border bg-surface-elevated"
      }`}
    >
      <p className="text-caption uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className="tabular-nums mt-2 text-h3 text-charcoal">{value}</p>
      {sub && <p className="mt-1 text-caption text-text-secondary">{sub}</p>}
    </div>
  );
}
