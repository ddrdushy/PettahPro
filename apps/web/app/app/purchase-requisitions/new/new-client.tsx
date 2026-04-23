"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import {
  api,
  ApiError,
  type Supplier,
  type Item,
  type Branch,
  type CreatePurchaseRequisitionLine,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR } from "@/lib/format";

interface LineDraft {
  id: string;
  itemId: string;
  description: string;
  quantity: string;
  estimatedUnitPrice: string;
}

function emptyLine(): LineDraft {
  return {
    id: crypto.randomUUID(),
    itemId: "",
    description: "",
    quantity: "1",
    estimatedUnitPrice: "",
  };
}

function toCents(s: string): number | undefined {
  if (!s.trim()) return undefined;
  const v = Number(s);
  if (!Number.isFinite(v) || v < 0) return undefined;
  return Math.round(v * 100);
}

function toNum(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

export function NewPurchaseRequisitionClient({
  suppliers,
  items,
  branches,
}: {
  suppliers: Supplier[];
  items: Item[];
  branches: Branch[];
}) {
  const router = useRouter();
  const [branchId, setBranchId] = useState("");
  const [preferredSupplierId, setPreferredSupplierId] = useState("");
  const [neededByDate, setNeededByDate] = useState("");
  const [purpose, setPurpose] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const estimatedTotal = useMemo(() => {
    return lines.reduce((sum, l) => {
      const qty = toNum(l.quantity);
      const unit = toCents(l.estimatedUnitPrice) ?? 0;
      return sum + Math.round(qty * unit);
    }, 0);
  }, [lines]);

  function updateLine(id: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(id: string) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.id !== id)));
  }

  function onItemPicked(lineId: string, pickedItemId: string) {
    const it = items.find((i) => i.id === pickedItemId);
    updateLine(lineId, {
      itemId: pickedItemId,
      description: it?.name ?? "",
      estimatedUnitPrice: it ? String(it.buyPriceCents / 100) : "",
    });
  }

  async function submit() {
    setError(null);
    const apiLines: CreatePurchaseRequisitionLine[] = [];
    for (const l of lines) {
      const qty = toNum(l.quantity);
      if (qty <= 0) continue;
      if (!l.description.trim()) {
        setError("Every line needs a description.");
        return;
      }
      const line: CreatePurchaseRequisitionLine = {
        description: l.description.trim(),
        quantity: qty,
      };
      if (l.itemId) line.itemId = l.itemId;
      const unit = toCents(l.estimatedUnitPrice);
      if (unit !== undefined) line.estimatedUnitPriceCents = unit;
      apiLines.push(line);
    }
    if (apiLines.length === 0) {
      setError("Enter at least one line with a quantity above zero.");
      return;
    }

    setBusy(true);
    try {
      const res = await api.createPurchaseRequisition({
        branchId: branchId || undefined,
        preferredSupplierId: preferredSupplierId || undefined,
        neededByDate: neededByDate || undefined,
        purpose: purpose.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: apiLines,
      });
      router.push(`/app/purchase-requisitions/${res.purchaseRequisition.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/purchase-requisitions" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to purchase requisitions
        </Link>
      </div>

      <PageHeader
        eyebrow="Buy"
        title="New purchase requisition"
        description="Draft an internal request to buy. Submit for approval, and once approved convert it into a Purchase Order for the supplier."
      />

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="branch" className="block text-caption uppercase tracking-wide text-text-tertiary">
            Branch (optional)
          </label>
          <select
            id="branch"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="input mt-1.5"
          >
            <option value="">No branch</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="supplier" className="block text-caption uppercase tracking-wide text-text-tertiary">
            Preferred supplier (optional)
          </label>
          <select
            id="supplier"
            value={preferredSupplierId}
            onChange={(e) => setPreferredSupplierId(e.target.value)}
            className="input mt-1.5"
          >
            <option value="">No preference</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="needed" className="block text-caption uppercase tracking-wide text-text-tertiary">
            Needed by (optional)
          </label>
          <input
            id="needed"
            type="date"
            value={neededByDate}
            onChange={(e) => setNeededByDate(e.target.value)}
            className="input mt-1.5"
          />
        </div>
        <div>
          <label htmlFor="purpose" className="block text-caption uppercase tracking-wide text-text-tertiary">
            Purpose (optional)
          </label>
          <input
            id="purpose"
            type="text"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="Why you're buying this"
            className="input mt-1.5"
          />
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <table className="w-full text-small">
          <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="w-10 px-3 py-3 text-center">#</th>
              <th className="w-48 px-3 py-3 text-left">Item</th>
              <th className="px-3 py-3 text-left">Description</th>
              <th className="w-20 px-3 py-3 text-right">Qty</th>
              <th className="w-32 px-3 py-3 text-right">Est. unit price</th>
              <th className="w-32 px-3 py-3 text-right">Line total</th>
              <th className="w-10 px-2 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            {lines.map((l, idx) => {
              const qty = toNum(l.quantity);
              const unit = toCents(l.estimatedUnitPrice) ?? 0;
              const lineTotal = Math.round(qty * unit);
              return (
                <tr key={l.id}>
                  <td className="px-3 py-2 text-center tabular-nums text-text-tertiary">{idx + 1}</td>
                  <td className="px-3 py-2">
                    <select
                      value={l.itemId}
                      onChange={(e) => onItemPicked(l.id, e.target.value)}
                      className="input text-small"
                    >
                      <option value="">No item (free text)</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={l.description}
                      onChange={(e) => updateLine(l.id, { description: e.target.value })}
                      placeholder="What you need"
                      className="input text-small"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={l.quantity}
                      onChange={(e) => updateLine(l.id, { quantity: e.target.value })}
                      className="input text-right tabular-nums text-small"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={l.estimatedUnitPrice}
                      onChange={(e) => updateLine(l.id, { estimatedUnitPrice: e.target.value })}
                      placeholder="Optional"
                      className="input text-right tabular-nums text-small"
                    />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-charcoal">
                    {l.estimatedUnitPrice.trim() ? (
                      formatLKR(lineTotal)
                    ) : (
                      <span className="text-text-tertiary">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeLine(l.id)}
                      disabled={lines.length <= 1}
                      className="rounded p-1 text-text-tertiary transition-colors hover:text-danger disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label="Remove line"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-surface-recessed/50">
            <tr>
              <td colSpan={5} className="px-3 py-3">
                <button type="button" onClick={addLine} className="btn-link text-small">
                  <Plus className="h-3.5 w-3.5" aria-hidden /> Add line
                </button>
              </td>
              <td className="px-3 py-3 text-right tabular-nums font-medium text-charcoal" colSpan={2}>
                Estimated total {formatLKR(estimatedTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="mt-6">
        <label htmlFor="notes" className="block text-caption uppercase tracking-wide text-text-tertiary">
          Notes (optional)
        </label>
        <textarea
          id="notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any extra context for the approver"
          className="input mt-1.5"
        />
      </section>

      <section className="mt-6 flex items-center justify-between gap-4">
        <p className="text-small text-text-secondary">
          Saved as a draft. Submit for approval from the next screen — a PR number is allocated at submission.
        </p>
        <div className="flex items-center gap-3">
          {error && <span className="text-small text-danger">{error}</span>}
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Save draft
          </button>
        </div>
      </section>
    </main>
  );
}
