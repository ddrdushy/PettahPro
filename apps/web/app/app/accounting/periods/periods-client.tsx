"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Lock, Unlock, Loader2, AlertTriangle, Check } from "lucide-react";
import { api, ApiError, type Account, type FiscalPeriod, type PeriodStatus } from "@/lib/api";
import { formatDate, formatLKR } from "@/lib/format";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const STATUS_CLASS: Record<PeriodStatus, string> = {
  open: "bg-mint-surface/60 text-mint-dark border-mint/40",
  soft_closed: "bg-amber-50 text-amber-800 border-amber-200",
  closed: "bg-surface-recessed text-text-tertiary border-border",
};

const STATUS_LABEL: Record<PeriodStatus, string> = {
  open: "Open",
  soft_closed: "Soft-closed",
  closed: "Year-end closed",
};

export function PeriodsClient({
  initialPeriods,
  equityAccounts,
}: {
  initialPeriods: FiscalPeriod[];
  equityAccounts: Account[];
}) {
  const router = useRouter();
  const [periods, setPeriods] = useState<FiscalPeriod[]>(initialPeriods);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: "soft-close" | "reopen"; period: FiscalPeriod }
    | { kind: "close-year"; year: number; periods: FiscalPeriod[] }
    | null
  >(null);

  const byYear = useMemo(() => {
    const map = new Map<number, FiscalPeriod[]>();
    for (const p of periods) {
      const list = map.get(p.fiscalYear) ?? [];
      list.push(p);
      map.set(p.fiscalYear, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.periodNo - b.periodNo);
    return Array.from(map.entries()).sort((a, b) => b[0] - a[0]);
  }, [periods]);

  async function refresh() {
    const data = await api.listPeriods();
    setPeriods(data.periods);
    router.refresh();
  }

  return (
    <div className="mt-6 space-y-6">
      {error && (
        <div className="rounded-card border-hairline border-danger/40 bg-danger-bg/60 px-4 py-3 text-small text-danger">
          {error}
        </div>
      )}

      {byYear.map(([year, months]) => {
        const allOpen = months.every((m) => m.status === "open");
        const anyClosed = months.some((m) => m.status === "closed");
        const canCloseYear = months.length === 12 && !anyClosed;
        return (
          <section key={year} className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b-hairline border-border px-5 py-4">
              <div>
                <h2 className="text-body font-medium text-charcoal">FY {year}</h2>
                <p className="text-caption text-text-tertiary">
                  {months.length} {months.length === 1 ? "month" : "months"} · {allOpen ? "all open" : anyClosed ? "year closed" : "in progress"}
                </p>
              </div>
              {canCloseYear && (
                <button
                  type="button"
                  onClick={() => setDialog({ kind: "close-year", year, periods: months })}
                  className="btn-primary inline-flex items-center gap-2 text-small"
                >
                  <Lock className="h-3.5 w-3.5" aria-hidden />
                  Run year-end close
                </button>
              )}
            </header>

            <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {months.map((p) => (
                <PeriodCard
                  key={p.id}
                  period={p}
                  busy={busyId === p.id}
                  onSoftClose={() => setDialog({ kind: "soft-close", period: p })}
                  onReopen={() => setDialog({ kind: "reopen", period: p })}
                />
              ))}
            </div>
          </section>
        );
      })}

      {dialog?.kind === "soft-close" && (
        <ReasonDialog
          title={`Soft-close ${MONTHS[dialog.period.periodNo - 1]} ${dialog.period.fiscalYear}`}
          description="Blocks new postings to this month. Easy to reopen — no approval needed."
          confirmLabel="Soft-close"
          busy={busyId === dialog.period.id}
          onConfirm={async (reason) => {
            setError(null);
            setBusyId(dialog.period.id);
            try {
              await api.softClosePeriod(dialog.period.id, reason);
              await refresh();
              setDialog(null);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Couldn't soft-close.");
            } finally {
              setBusyId(null);
            }
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "reopen" && (
        <ReasonDialog
          title={`Reopen ${MONTHS[dialog.period.periodNo - 1]} ${dialog.period.fiscalYear}`}
          description={dialog.period.status === "closed"
            ? "This is a year-end closed period. Reopening is audit-logged and increments the reopened count. Think twice before undoing a hard close."
            : "Unlocks the period for new postings."}
          confirmLabel="Reopen"
          busy={busyId === dialog.period.id}
          onConfirm={async (reason) => {
            setError(null);
            setBusyId(dialog.period.id);
            try {
              await api.reopenPeriod(dialog.period.id, reason);
              await refresh();
              setDialog(null);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Couldn't reopen.");
            } finally {
              setBusyId(null);
            }
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "close-year" && (
        <CloseYearDialog
          year={dialog.year}
          periods={dialog.periods}
          equityAccounts={equityAccounts}
          busy={busyId === `year-${dialog.year}`}
          onConfirm={async (reason, retainedEarningsAccountId) => {
            setError(null);
            setBusyId(`year-${dialog.year}`);
            try {
              const res = await api.closeFiscalYear({
                fiscalYear: dialog.year,
                reason,
                retainedEarningsAccountId,
              });
              await refresh();
              setDialog(null);
              const msg = res.closingEntryNumber
                ? `Year closed. Entry ${res.closingEntryNumber} posted. Net ${res.netProfitCents >= 0 ? "profit" : "loss"} ${formatLKR(Math.abs(res.netProfitCents))}.`
                : "Year closed. No P&L activity to transfer.";
              alert(msg);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Couldn't close year.");
            } finally {
              setBusyId(null);
            }
          }}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function PeriodCard({
  period,
  busy,
  onSoftClose,
  onReopen,
}: {
  period: FiscalPeriod;
  busy: boolean;
  onSoftClose: () => void;
  onReopen: () => void;
}) {
  return (
    <div className="rounded-md border-hairline border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-body font-medium text-charcoal">
            {MONTHS[period.periodNo - 1]} {period.fiscalYear}
          </p>
          <p className="text-caption text-text-tertiary">
            {formatDate(period.startsOn)} — {formatDate(period.endsOn)}
          </p>
        </div>
        <span className={`inline-flex items-center rounded-full border-hairline px-2 py-0.5 text-caption font-medium ${STATUS_CLASS[period.status]}`}>
          {STATUS_LABEL[period.status]}
        </span>
      </div>

      <div className="mt-3 text-caption text-text-secondary">
        <span className="tabular-nums">{period.entryCount}</span> {period.entryCount === 1 ? "journal entry" : "journal entries"}
        {period.reopenedCount > 0 && (
          <span className="ml-2 text-amber-700">· reopened {period.reopenedCount}×</span>
        )}
      </div>

      {period.lastReason && period.status !== "open" && (
        <p className="mt-2 text-caption italic text-text-tertiary">&quot;{period.lastReason}&quot;</p>
      )}

      <div className="mt-4 flex items-center gap-2">
        {period.status === "open" && (
          <button
            type="button"
            onClick={onSoftClose}
            disabled={busy}
            className="btn-ghost inline-flex items-center gap-1 text-caption disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />}
            Soft-close
          </button>
        )}
        {period.status !== "open" && (
          <button
            type="button"
            onClick={onReopen}
            disabled={busy}
            className="btn-ghost inline-flex items-center gap-1 text-caption disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlock className="h-3 w-3" />}
            Reopen
          </button>
        )}
        {period.closingJournalEntryId && (
          <Link
            href={`/app/journals/${period.closingJournalEntryId}`}
            className="btn-link text-caption"
          >
            Closing entry →
          </Link>
        )}
      </div>
    </div>
  );
}

function ReasonDialog({
  title,
  description,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 px-4">
      <div className="w-full max-w-md rounded-card border-hairline border-border bg-surface-elevated p-6 shadow-lg">
        <h2 className="text-body font-medium text-charcoal">{title}</h2>
        <p className="mt-1 text-caption text-text-secondary">{description}</p>
        <label className="mt-4 block text-caption uppercase tracking-wide text-text-tertiary">
          Reason (audit trail)
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="e.g. Month-end review completed"
          className="input mt-1.5 w-full"
        />
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-ghost text-small">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim())}
            disabled={busy || !reason.trim()}
            className="btn-primary inline-flex items-center gap-2 text-small disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function CloseYearDialog({
  year,
  periods,
  equityAccounts,
  busy,
  onConfirm,
  onCancel,
}: {
  year: number;
  periods: FiscalPeriod[];
  equityAccounts: Account[];
  busy: boolean;
  onConfirm: (reason: string, retainedEarningsAccountId: string) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [reason, setReason] = useState("");
  const [accountId, setAccountId] = useState("");

  const checklistItems = [
    { label: "All invoices & bills for the year are posted", pass: true },
    { label: "Bank accounts reconciled through December", pass: true },
    { label: "Depreciation run for all 12 months", pass: true },
    { label: "Payroll posted for December", pass: true },
    { label: "No draft journal entries older than this year", pass: true },
  ];

  const totalEntries = periods.reduce((s, p) => s + p.entryCount, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 px-4">
      <div className="w-full max-w-2xl rounded-card border-hairline border-border bg-surface-elevated p-6 shadow-lg">
        <div className="flex items-center gap-2 text-caption uppercase tracking-wide text-text-tertiary">
          <span>Step {step} of 3</span>
        </div>
        <h2 className="mt-1 text-h4 font-medium text-charcoal">Year-end close · FY {year}</h2>

        {step === 1 && (
          <div className="mt-4">
            <p className="text-small text-text-secondary">
              Closing FY{year} will post a journal entry that zeros out every income and expense account into retained earnings, then hard-lock all 12 months. Reopening later requires a reason and is audit-logged.
            </p>
            <div className="mt-4 rounded-md border-hairline border-border bg-surface-recessed/40 p-4 text-small">
              <p className="font-medium text-charcoal">Pre-close checklist</p>
              <ul className="mt-2 space-y-1.5 text-text-secondary">
                {checklistItems.map((c) => (
                  <li key={c.label} className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-mint-dark" aria-hidden />
                    {c.label}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-caption text-text-tertiary">
                (Checklist is advisory — PettahPro doesn&apos;t block you on these; confirm with your bookkeeper.)
              </p>
            </div>
            <p className="mt-3 text-caption text-text-secondary">
              {totalEntries} journal entries recorded across the year.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={onCancel} className="btn-ghost text-small">Cancel</button>
              <button type="button" onClick={() => setStep(2)} className="btn-primary text-small">Continue</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="mt-4">
            <label className="block text-caption uppercase tracking-wide text-text-tertiary">
              Retained earnings account
            </label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="input mt-1.5 w-full"
            >
              <option value="">Select an equity account…</option>
              {equityAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
              ))}
            </select>
            <p className="mt-2 text-caption text-text-tertiary">
              Net profit/loss is posted here as the balancing side of the close entry.
            </p>

            <label className="mt-4 block text-caption uppercase tracking-wide text-text-tertiary">
              Reason (audit trail)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder={`FY${year} year-end close`}
              className="input mt-1.5 w-full"
            />
            <div className="mt-5 flex items-center justify-between">
              <button type="button" onClick={() => setStep(1)} className="btn-ghost text-small">Back</button>
              <div className="flex items-center gap-2">
                <button type="button" onClick={onCancel} className="btn-ghost text-small">Cancel</button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  disabled={!accountId || !reason.trim()}
                  className="btn-primary text-small disabled:opacity-50"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="mt-4">
            <div className="flex items-start gap-3 rounded-md border-hairline border-amber-200 bg-amber-50 p-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
              <div className="text-small text-amber-900">
                <p className="font-medium">This is a hard lock.</p>
                <p className="mt-1">No more postings accepted against FY{year} unless you explicitly reopen a month — which is audit-logged. Usually you won&apos;t reopen after this point.</p>
              </div>
            </div>
            <dl className="mt-4 space-y-2 text-small">
              <div className="flex justify-between"><dt className="text-text-secondary">Fiscal year</dt><dd className="text-charcoal">FY {year}</dd></div>
              <div className="flex justify-between"><dt className="text-text-secondary">Retained earnings account</dt><dd className="text-charcoal">{equityAccounts.find((a) => a.id === accountId)?.name ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-text-secondary">Closing entry date</dt><dd className="text-charcoal tabular-nums">{formatDate(periods[11]?.endsOn ?? "")}</dd></div>
            </dl>
            <div className="mt-5 flex items-center justify-between">
              <button type="button" onClick={() => setStep(2)} className="btn-ghost text-small">Back</button>
              <div className="flex items-center gap-2">
                <button type="button" onClick={onCancel} disabled={busy} className="btn-ghost text-small">Cancel</button>
                <button
                  type="button"
                  onClick={() => onConfirm(reason.trim(), accountId)}
                  disabled={busy}
                  className="btn-primary inline-flex items-center gap-2 text-small disabled:opacity-50"
                >
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Close year
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
