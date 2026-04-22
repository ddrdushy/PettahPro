"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import {
  api,
  ApiError,
  type Account,
  type Customer,
  type Supplier,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR } from "@/lib/format";

interface LineDraft {
  id: string;
  accountId: string;
  dr: string;
  cr: string;
  description: string;
  customerId: string;
  supplierId: string;
}

function emptyLine(): LineDraft {
  return {
    id: crypto.randomUUID(),
    accountId: "",
    dr: "0",
    cr: "0",
    description: "",
    customerId: "",
    supplierId: "",
  };
}

function toCents(n: string): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.round(v * 100)) : 0;
}

export function NewRecurringJournalClient({
  accounts,
  customers,
  suppliers,
}: {
  accounts: Account[];
  customers: Customer[];
  suppliers: Supplier[];
}) {
  const router = useRouter();
  const [scheduleName, setScheduleName] = useState("");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [autoPost, setAutoPost] = useState(false);
  const [memoTemplate, setMemoTemplate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(), emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totals = useMemo(() => {
    let dr = 0;
    let cr = 0;
    for (const l of lines) {
      dr += toCents(l.dr);
      cr += toCents(l.cr);
    }
    return { dr, cr, balanced: dr > 0 && dr === cr };
  }, [lines]);

  function updateLine(id: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  // When user types in DR, zero out CR (and vice versa) — a line is one-sided.
  function setDr(id: string, value: string) {
    updateLine(id, { dr: value, cr: "0" });
  }
  function setCr(id: string, value: string) {
    updateLine(id, { cr: value, dr: "0" });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!scheduleName.trim()) return setError("Give the schedule a name.");
    const doM = Number(dayOfMonth);
    if (!Number.isInteger(doM) || doM < 1 || doM > 28)
      return setError("Day of month must be between 1 and 28.");

    const cleaned = lines.filter((l) => l.accountId && (toCents(l.dr) > 0 || toCents(l.cr) > 0));
    if (cleaned.length < 2) return setError("Add at least two balanced lines.");

    let dr = 0;
    let cr = 0;
    for (const l of cleaned) {
      const ldr = toCents(l.dr);
      const lcr = toCents(l.cr);
      if (ldr > 0 && lcr > 0) return setError("A line can be a debit OR a credit, not both.");
      dr += ldr;
      cr += lcr;
    }
    if (dr === 0 || dr !== cr) return setError("Debits must equal credits and be greater than zero.");

    setBusy(true);
    try {
      await api.createRecurringJournal({
        scheduleName: scheduleName.trim(),
        frequency: "monthly",
        dayOfMonth: doM,
        startDate,
        endDate: endDate || undefined,
        autoPost,
        memoTemplate: memoTemplate.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: cleaned.map((l) => ({
          accountId: l.accountId,
          drCents: toCents(l.dr),
          crCents: toCents(l.cr),
          description: l.description.trim() || undefined,
          customerId: l.customerId || undefined,
          supplierId: l.supplierId || undefined,
        })),
      });
      router.push(`/app/recurring-journals`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/recurring-journals" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to recurring journals
        </Link>
      </div>

      <PageHeader
        eyebrow="Accounting"
        title="New recurring journal"
        description="Set up a template that generates a journal entry every month on the day you pick. Auto-post straight into the ledger, or drop into the approval queue for sign-off."
      />

      <form onSubmit={submit} className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <section className="rounded-card border-hairline border-border bg-surface-elevated p-5">
            <h2 className="text-body font-medium text-charcoal">Schedule</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="name">Name</Label>
                <input
                  id="name"
                  value={scheduleName}
                  onChange={(e) => setScheduleName(e.target.value)}
                  placeholder="e.g. Monthly rent accrual — Colombo office"
                  className="input mt-1.5 w-full"
                />
              </div>
              <div>
                <Label htmlFor="dayOfMonth">Day of month</Label>
                <input
                  id="dayOfMonth"
                  type="number"
                  min={1}
                  max={28}
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(e.target.value)}
                  className="input mt-1.5 w-full"
                />
                <p className="mt-1 text-caption text-text-tertiary">1–28 to avoid month-end edge cases.</p>
              </div>
              <div>
                <Label htmlFor="startDate">Start date</Label>
                <input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="input mt-1.5 w-full"
                />
              </div>
              <div>
                <Label htmlFor="endDate">End date (optional)</Label>
                <input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="input mt-1.5 w-full"
                />
              </div>
              <div>
                <Label htmlFor="autoPost">Posting mode</Label>
                <label className="mt-2 flex cursor-pointer items-start gap-2">
                  <input
                    id="autoPost"
                    type="checkbox"
                    checked={autoPost}
                    onChange={(e) => setAutoPost(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-small text-text-secondary">
                    <span className="font-medium text-charcoal">Auto-post</span> — fires straight into the ledger.
                    <span className="block text-caption text-text-tertiary">
                      Unchecked: drops into Journal approvals for sign-off.
                    </span>
                  </span>
                </label>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="memoTemplate">Memo template (optional)</Label>
                <input
                  id="memoTemplate"
                  value={memoTemplate}
                  onChange={(e) => setMemoTemplate(e.target.value)}
                  placeholder="e.g. Rent accrual — {MMM} {YYYY}"
                  className="input mt-1.5 w-full"
                />
                <p className="mt-1 text-caption text-text-tertiary">
                  Tokens: <code>{"{YYYY}"}</code> <code>{"{YY}"}</code> <code>{"{MM}"}</code>{" "}
                  <code>{"{MMM}"}</code> <code>{"{MONTH}"}</code>. Rendered at run-time using the entry date.
                </p>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="notes">Internal notes (optional)</Label>
                <textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="input mt-1.5 w-full"
                />
              </div>
            </div>
          </section>

          <section className="rounded-card border-hairline border-border bg-surface-elevated">
            <div className="flex items-center justify-between gap-2 px-5 py-4">
              <h2 className="text-body font-medium text-charcoal">Lines</h2>
              <button
                type="button"
                className="btn-ghost inline-flex items-center gap-1 text-caption"
                onClick={() => setLines((prev) => [...prev, emptyLine()])}
              >
                <Plus className="h-3.5 w-3.5" /> Add line
              </button>
            </div>
            <div className="divide-y-hairline divide-border">
              <div className="grid gap-3 px-5 py-2 text-caption uppercase tracking-wide text-text-tertiary md:grid-cols-[1.4fr_1fr_1fr_1.2fr_1fr_40px]">
                <div>Account</div>
                <div className="text-right">Debit</div>
                <div className="text-right">Credit</div>
                <div>Description</div>
                <div>Counterparty (optional)</div>
                <div />
              </div>
              {lines.map((l) => (
                <div
                  key={l.id}
                  className="grid gap-3 px-5 py-3 md:grid-cols-[1.4fr_1fr_1fr_1.2fr_1fr_40px]"
                >
                  <select
                    value={l.accountId}
                    onChange={(e) => updateLine(l.id, { accountId: e.target.value })}
                    className="input w-full"
                  >
                    <option value="">Select account…</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={l.dr}
                    onChange={(e) => setDr(l.id, e.target.value)}
                    className="input text-right tabular-nums"
                  />
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={l.cr}
                    onChange={(e) => setCr(l.id, e.target.value)}
                    className="input text-right tabular-nums"
                  />
                  <input
                    placeholder="Line memo"
                    value={l.description}
                    onChange={(e) => updateLine(l.id, { description: e.target.value })}
                    className="input"
                  />
                  <select
                    value={l.customerId || l.supplierId ? (l.customerId ? `c:${l.customerId}` : `s:${l.supplierId}`) : ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return updateLine(l.id, { customerId: "", supplierId: "" });
                      const [kind, id] = v.split(":");
                      if (kind === "c") updateLine(l.id, { customerId: id ?? "", supplierId: "" });
                      else updateLine(l.id, { customerId: "", supplierId: id ?? "" });
                    }}
                    className="input"
                  >
                    <option value="">—</option>
                    <optgroup label="Customers">
                      {customers.map((c) => (
                        <option key={c.id} value={`c:${c.id}`}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Suppliers">
                      {suppliers.map((s) => (
                        <option key={s.id} value={`s:${s.id}`}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  <button
                    type="button"
                    className="btn-ghost text-text-tertiary"
                    onClick={() => setLines((prev) => prev.filter((x) => x.id !== l.id))}
                    aria-label="Remove line"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-card border-hairline border-border bg-surface-elevated p-5">
            <h2 className="text-body font-medium text-charcoal">Per-run totals</h2>
            <dl className="mt-3 space-y-2 text-small">
              <Row label="Debits" value={formatLKR(totals.dr)} />
              <Row label="Credits" value={formatLKR(totals.cr)} />
              <div className="my-2 h-px bg-border" />
              <Row
                label={totals.balanced ? "Balanced" : "Out of balance"}
                value={formatLKR(totals.dr - totals.cr)}
                strong
                tone={totals.balanced ? "ok" : "warn"}
              />
            </dl>
            <p className="mt-3 text-caption text-text-tertiary">
              {autoPost
                ? "Entries post directly — balance check runs at generate-time too."
                : "Entries land in Journal approvals — reviewer sees the memo and lines before posting."}
            </p>
          </section>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy || !totals.balanced}
              className="btn-primary inline-flex items-center gap-2 text-small disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save schedule
            </button>
            {error && <span className="text-caption text-danger">{error}</span>}
          </div>
        </aside>
      </form>
    </main>
  );
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-caption uppercase tracking-wide text-text-tertiary">
      {children}
    </label>
  );
}

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "ok" | "warn";
}) {
  const valueCls =
    tone === "warn"
      ? "text-danger"
      : tone === "ok"
        ? "text-mint-dark"
        : strong
          ? "text-charcoal"
          : "text-charcoal";
  return (
    <div className="flex items-center justify-between">
      <dt className="text-small text-text-secondary">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-medium" : ""} ${valueCls}`}>{value}</dd>
    </div>
  );
}
