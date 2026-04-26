"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, Check, Loader2, Plus, Trash2 } from "lucide-react";
import {
  api,
  ApiError,
  type Account,
  type CostCenter,
  type Customer,
  type Supplier,
  type CreateJournalEntryLine,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR } from "@/lib/format";

interface LineDraft {
  id: string;
  accountId: string;
  description: string;
  drAmount: string;
  crAmount: string;
  partyKind: "" | "customer" | "supplier";
  partyId: string;
}

function emptyLine(): LineDraft {
  return {
    id: crypto.randomUUID(),
    accountId: "",
    description: "",
    drAmount: "",
    crAmount: "",
    partyKind: "",
    partyId: "",
  };
}

function toCents(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : 0;
}

const typeOrder: Record<Account["accountType"], number> = {
  asset: 1,
  liability: 2,
  equity: 3,
  income: 4,
  expense: 5,
};

const typeLabel: Record<Account["accountType"], string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  income: "Income",
  expense: "Expenses",
};

export function NewJournalClient({
  accounts,
  customers,
  suppliers,
  costCenters,
}: {
  accounts: Account[];
  customers: Customer[];
  suppliers: Supplier[];
  costCenters: CostCenter[];
}) {
  const router = useRouter();
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(), emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeAccounts = useMemo(() => accounts.filter((a) => a.isActive), [accounts]);
  const accountGroups = useMemo(() => {
    const g = new Map<Account["accountType"], Account[]>();
    for (const a of activeAccounts) {
      const arr = g.get(a.accountType) ?? [];
      arr.push(a);
      g.set(a.accountType, arr);
    }
    return Array.from(g.entries()).sort((a, b) => typeOrder[a[0]] - typeOrder[b[0]]);
  }, [activeAccounts]);

  const totals = useMemo(() => {
    let dr = 0;
    let cr = 0;
    for (const l of lines) {
      dr += toCents(l.drAmount);
      cr += toCents(l.crAmount);
    }
    return { dr, cr, diff: dr - cr };
  }, [lines]);

  const balanced = totals.dr > 0 && totals.dr === totals.cr;

  function updateLine(id: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function setDr(id: string, val: string) {
    updateLine(id, { drAmount: val, crAmount: val ? "" : lines.find((l) => l.id === id)?.crAmount ?? "" });
  }

  function setCr(id: string, val: string) {
    updateLine(id, { crAmount: val, drAmount: val ? "" : lines.find((l) => l.id === id)?.drAmount ?? "" });
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(id: string) {
    setLines((prev) => (prev.length <= 2 ? prev : prev.filter((l) => l.id !== id)));
  }

  async function submit() {
    setError(null);
    if (!balanced) {
      setError("Debits and credits must balance and be greater than zero.");
      return;
    }
    const apiLines: CreateJournalEntryLine[] = [];
    for (const l of lines) {
      const dr = toCents(l.drAmount);
      const cr = toCents(l.crAmount);
      if (!l.accountId) {
        setError("Every line needs an account.");
        return;
      }
      if (dr === 0 && cr === 0) continue; // skip blank rows
      apiLines.push({
        accountId: l.accountId,
        drCents: dr,
        crCents: cr,
        description: l.description.trim() || undefined,
        customerId: l.partyKind === "customer" && l.partyId ? l.partyId : undefined,
        supplierId: l.partyKind === "supplier" && l.partyId ? l.partyId : undefined,
      });
    }
    if (apiLines.length < 2) {
      setError("Enter at least two lines.");
      return;
    }

    setBusy(true);
    try {
      const res = await api.createJournalEntry({
        entryDate,
        memo: memo.trim() || undefined,
        costCenterId: costCenterId || undefined,
        lines: apiLines,
      });
      if (res.status === "pending_approval") {
        alert(
          `Entry queued for approval (total LKR ${(res.totalCents / 100).toFixed(2)} ≥ threshold LKR ${(res.thresholdCents / 100).toFixed(2)}). It won't post to the GL until someone else approves it.`,
        );
        router.push("/app/journals/approvals");
      } else {
        router.push(`/app/journals/${res.entryId}`);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Couldn't post entry. Try again.");
      }
      setBusy(false);
    }
  }

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/journals" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to journals
        </Link>
      </div>

      <PageHeader
        eyebrow="Accounting"
        title="Manual journal entry"
        description="Record an adjusting entry — accruals, prepayments, opening balances, or corrections. Debits must equal credits."
      />

      <section className="mt-6 grid gap-4 sm:grid-cols-[160px_1fr]">
        <div>
          <label htmlFor="entry-date" className="block text-caption uppercase tracking-wide text-text-tertiary">
            Date
          </label>
          <input
            id="entry-date"
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="memo" className="block text-caption uppercase tracking-wide text-text-tertiary">
            Memo
          </label>
          <input
            id="memo"
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="e.g. Depreciation for April 2026"
            className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
          />
        </div>
        {costCenters.length > 0 && (
          <div>
            <label
              htmlFor="cost-center"
              className="block text-caption uppercase tracking-wide text-text-tertiary"
            >
              Cost center{" "}
              <span className="text-caption text-text-tertiary">
                (header tag — applied to every line)
              </span>
            </label>
            <select
              id="cost-center"
              value={costCenterId}
              onChange={(e) => setCostCenterId(e.target.value)}
              className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
            >
              <option value="">— Unassigned —</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      <section className="mt-6 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <table className="w-full text-small">
          <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="w-10 px-3 py-3 text-center">#</th>
              <th className="px-3 py-3 text-left">Account</th>
              <th className="px-3 py-3 text-left">Description</th>
              <th className="w-56 px-3 py-3 text-left">Party (optional)</th>
              <th className="w-32 px-3 py-3 text-right">Debit</th>
              <th className="w-32 px-3 py-3 text-right">Credit</th>
              <th className="w-10 px-2 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            {lines.map((l, idx) => (
              <tr key={l.id}>
                <td className="px-3 py-2 text-center tabular-nums text-text-tertiary">{idx + 1}</td>
                <td className="px-3 py-2">
                  <select
                    value={l.accountId}
                    onChange={(e) => updateLine(l.id, { accountId: e.target.value })}
                    className="w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-2 py-1.5 text-small text-charcoal focus:border-charcoal focus:outline-none"
                  >
                    <option value="">Pick an account…</option>
                    {accountGroups.map(([type, rows]) => (
                      <optgroup key={type} label={typeLabel[type]}>
                        {rows.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} · {a.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={l.description}
                    onChange={(e) => updateLine(l.id, { description: e.target.value })}
                    placeholder="Line memo"
                    className="w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-2 py-1.5 text-small text-charcoal focus:border-charcoal focus:outline-none"
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <select
                      value={l.partyKind}
                      onChange={(e) =>
                        updateLine(l.id, {
                          partyKind: e.target.value as LineDraft["partyKind"],
                          partyId: "",
                        })
                      }
                      className="w-24 rounded-md border-hairline border-border-emphasis bg-surface-elevated px-2 py-1.5 text-small text-charcoal focus:border-charcoal focus:outline-none"
                    >
                      <option value="">—</option>
                      <option value="customer">Customer</option>
                      <option value="supplier">Supplier</option>
                    </select>
                    {l.partyKind && (
                      <select
                        value={l.partyId}
                        onChange={(e) => updateLine(l.id, { partyId: e.target.value })}
                        className="flex-1 rounded-md border-hairline border-border-emphasis bg-surface-elevated px-2 py-1.5 text-small text-charcoal focus:border-charcoal focus:outline-none"
                      >
                        <option value="">Pick one…</option>
                        {(l.partyKind === "customer" ? customers : suppliers).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={l.drAmount}
                    onChange={(e) => setDr(l.id, e.target.value)}
                    className="w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-2 py-1.5 text-right tabular-nums text-small text-charcoal focus:border-charcoal focus:outline-none"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={l.crAmount}
                    onChange={(e) => setCr(l.id, e.target.value)}
                    className="w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-2 py-1.5 text-right tabular-nums text-small text-charcoal focus:border-charcoal focus:outline-none"
                  />
                </td>
                <td className="px-2 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => removeLine(l.id)}
                    disabled={lines.length <= 2}
                    className="rounded p-1 text-text-tertiary transition-colors hover:text-danger disabled:cursor-not-allowed disabled:opacity-30"
                    aria-label="Remove line"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-surface-recessed/50">
            <tr>
              <td colSpan={4} className="px-3 py-3">
                <button type="button" onClick={addLine} className="btn-link text-small">
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  Add line
                </button>
              </td>
              <td className="px-3 py-3 text-right tabular-nums font-medium text-charcoal">
                {formatLKR(totals.dr)}
              </td>
              <td className="px-3 py-3 text-right tabular-nums font-medium text-charcoal">
                {formatLKR(totals.cr)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="mt-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-small">
          {totals.dr === 0 ? (
            <span className="text-text-tertiary">Enter amounts to balance this entry.</span>
          ) : balanced ? (
            <>
              <span className="grid h-6 w-6 place-items-center rounded-full bg-mint text-mint-dark">
                <Check className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span className="text-charcoal">Balanced · {formatLKR(totals.dr)}</span>
            </>
          ) : (
            <>
              <AlertCircle className="h-4 w-4 text-warning-accent" aria-hidden />
              <span className="text-charcoal">
                Out of balance by {formatLKR(Math.abs(totals.diff))}{" "}
                <span className="text-text-tertiary">
                  ({totals.diff > 0 ? "debits exceed credits" : "credits exceed debits"})
                </span>
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {error && <span className="text-small text-danger">{error}</span>}
          <button
            type="button"
            onClick={submit}
            disabled={busy || !balanced}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Post entry
          </button>
        </div>
      </section>
    </main>
  );
}
