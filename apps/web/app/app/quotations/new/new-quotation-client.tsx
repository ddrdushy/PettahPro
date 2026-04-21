"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import {
  api,
  ApiError,
  type Customer,
  type Item,
  type TaxCode,
  type CreateQuotationLine,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR } from "@/lib/format";

interface LineDraft {
  id: string;
  itemId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPct: string;
  taxCodeId: string;
}

function emptyLine(): LineDraft {
  return {
    id: crypto.randomUUID(),
    itemId: "",
    description: "",
    quantity: "1",
    unitPrice: "0",
    discountPct: "0",
    taxCodeId: "",
  };
}

function toInt(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? Math.max(0, Math.round(v * 100)) : 0;
}

function toNum(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

function plusDaysISO(baseISO: string, days: number): string {
  return new Date(new Date(baseISO).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

export function NewQuotationClient({
  customers,
  items,
  taxCodes,
}: {
  customers: Customer[];
  items: Item[];
  taxCodes: TaxCode[];
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState("");
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState(() => plusDaysISO(new Date().toISOString().slice(0, 10), 30));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saleTaxCodes = useMemo(
    () => taxCodes.filter((t) => t.appliesTo === "sale" || t.appliesTo === "both"),
    [taxCodes],
  );

  const computed = useMemo(() => {
    let subtotal = 0;
    let discount = 0;
    let tax = 0;
    const perLine = lines.map((l) => {
      const qty = toNum(l.quantity);
      const unit = toInt(l.unitPrice);
      const lineSub = Math.round(qty * unit);
      const discPct = toNum(l.discountPct);
      const lineDiscount = Math.round((lineSub * discPct * 100) / 10_000);
      const taxable = lineSub - lineDiscount;
      const tc = taxCodes.find((t) => t.id === l.taxCodeId);
      const rate = tc?.rateBps ?? 0;
      const lineTax = Math.round((taxable * rate) / 10_000);
      subtotal += lineSub;
      discount += lineDiscount;
      tax += lineTax;
      return { lineSub, lineDiscount, lineTax, lineTotal: taxable + lineTax };
    });
    return { subtotal, discount, tax, total: subtotal - discount + tax, perLine };
  }, [lines, taxCodes]);

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
      unitPrice: it ? String(it.sellPriceCents / 100) : "0",
    });
  }

  async function submit() {
    setError(null);
    if (!customerId) {
      setError("Pick a customer.");
      return;
    }
    const apiLines: CreateQuotationLine[] = [];
    for (const l of lines) {
      const qty = toNum(l.quantity);
      const unit = toInt(l.unitPrice);
      if (qty <= 0 || unit < 0) continue;
      if (!l.description.trim()) {
        setError("Every line needs a description.");
        return;
      }
      apiLines.push({
        itemId: l.itemId || undefined,
        description: l.description.trim(),
        quantity: qty,
        unitPriceCents: unit,
        discountPctBps: Math.round(toNum(l.discountPct) * 100),
        taxCodeId: l.taxCodeId || undefined,
      });
    }
    if (apiLines.length === 0) {
      setError("Enter at least one line with quantity and unit price.");
      return;
    }

    setBusy(true);
    try {
      const res = await api.createQuotation({
        customerId,
        issueDate,
        validUntil,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        terms: terms.trim() || undefined,
        lines: apiLines,
      });
      router.push(`/app/quotations/${res.quotation.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/quotations" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to quotations
        </Link>
      </div>

      <PageHeader
        eyebrow="Sell"
        title="New quotation"
        description="Draft a quote for your customer. Save it as a draft first, then send when ready — a quotation number gets allocated at that point."
      />

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="customer" className="block text-caption uppercase tracking-wide text-text-tertiary">Customer</label>
          <select id="customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="input mt-1.5">
            <option value="">Pick a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ref" className="block text-caption uppercase tracking-wide text-text-tertiary">Reference (optional)</label>
          <input id="ref" type="text" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="RFQ-42, opportunity name" className="input mt-1.5" />
        </div>
        <div>
          <label htmlFor="issue" className="block text-caption uppercase tracking-wide text-text-tertiary">Issue date</label>
          <input id="issue" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="input mt-1.5" />
        </div>
        <div>
          <label htmlFor="valid" className="block text-caption uppercase tracking-wide text-text-tertiary">Valid until</label>
          <input id="valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="input mt-1.5" />
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
              <th className="w-28 px-3 py-3 text-right">Unit price</th>
              <th className="w-20 px-3 py-3 text-right">Disc %</th>
              <th className="w-40 px-3 py-3 text-left">Tax</th>
              <th className="w-28 px-3 py-3 text-right">Line total</th>
              <th className="w-10 px-2 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            {lines.map((l, idx) => {
              const lineTotal = computed.perLine[idx]?.lineTotal ?? 0;
              return (
                <tr key={l.id}>
                  <td className="px-3 py-2 text-center tabular-nums text-text-tertiary">{idx + 1}</td>
                  <td className="px-3 py-2">
                    <select value={l.itemId} onChange={(e) => onItemPicked(l.id, e.target.value)} className="input text-small">
                      <option value="">No item (free text)</option>
                      {items.map((it) => (<option key={it.id} value={it.id}>{it.name}</option>))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input type="text" value={l.description} onChange={(e) => updateLine(l.id, { description: e.target.value })} placeholder="What's being quoted" className="input text-small" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" step="0.01" min="0" value={l.quantity} onChange={(e) => updateLine(l.id, { quantity: e.target.value })} className="input text-right tabular-nums text-small" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" step="0.01" min="0" value={l.unitPrice} onChange={(e) => updateLine(l.id, { unitPrice: e.target.value })} className="input text-right tabular-nums text-small" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" step="0.01" min="0" max="100" value={l.discountPct} onChange={(e) => updateLine(l.id, { discountPct: e.target.value })} className="input text-right tabular-nums text-small" />
                  </td>
                  <td className="px-3 py-2">
                    <select value={l.taxCodeId} onChange={(e) => updateLine(l.id, { taxCodeId: e.target.value })} className="input text-small">
                      <option value="">No tax</option>
                      {saleTaxCodes.map((t) => (
                        <option key={t.id} value={t.id}>{t.code} ({(t.rateBps / 100).toFixed(2)}%)</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-charcoal">{formatLKR(lineTotal)}</td>
                  <td className="px-2 py-2 text-right">
                    <button type="button" onClick={() => removeLine(l.id)} disabled={lines.length <= 1} className="rounded p-1 text-text-tertiary transition-colors hover:text-danger disabled:cursor-not-allowed disabled:opacity-30" aria-label="Remove line">
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-surface-recessed/50">
            <tr>
              <td colSpan={7} className="px-3 py-3">
                <button type="button" onClick={addLine} className="btn-link text-small">
                  <Plus className="h-3.5 w-3.5" aria-hidden /> Add line
                </button>
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-text-secondary" colSpan={2}>
                Subtotal {formatLKR(computed.subtotal)}
                {computed.discount > 0 && <> · Discount {formatLKR(computed.discount)}</>}
              </td>
            </tr>
            {computed.tax > 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-2" />
                <td className="px-3 py-2 text-right tabular-nums text-text-secondary" colSpan={2}>
                  Tax {formatLKR(computed.tax)}
                </td>
              </tr>
            )}
            <tr>
              <td colSpan={7} className="px-3 py-3" />
              <td className="px-3 py-3 text-right tabular-nums font-medium text-charcoal" colSpan={2}>
                Total {formatLKR(computed.total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="notes" className="block text-caption uppercase tracking-wide text-text-tertiary">Notes</label>
          <textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal context — won't appear on the quote" className="input mt-1.5" />
        </div>
        <div>
          <label htmlFor="terms" className="block text-caption uppercase tracking-wide text-text-tertiary">Terms</label>
          <textarea id="terms" rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Delivery terms, payment terms, warranty — printed on the quote" className="input mt-1.5" />
        </div>
      </section>

      <section className="mt-6 flex items-center justify-between gap-4">
        <p className="text-small text-text-secondary">Saved as a draft. You can send, accept, reject, or convert from the next screen.</p>
        <div className="flex items-center gap-3">
          {error && <span className="text-small text-danger">{error}</span>}
          <button type="button" onClick={submit} disabled={busy} className="btn-primary disabled:cursor-not-allowed disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Save draft
          </button>
        </div>
      </section>
    </main>
  );
}
