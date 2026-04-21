"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { api, ApiError, type Customer, type Item, type TaxCode } from "@/lib/api";
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

function toInt(cents: string): number {
  const v = Number(cents);
  return Number.isFinite(v) ? Math.max(0, Math.round(v * 100)) : 0;
}

function toNum(n: string): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

export function NewRecurringInvoiceClient({
  customers,
  items,
  taxCodes,
}: {
  customers: Customer[];
  items: Item[];
  taxCodes: TaxCode[];
}) {
  const router = useRouter();
  const [scheduleName, setScheduleName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [dueDays, setDueDays] = useState("30");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const computed = useMemo(() => {
    let subtotal = 0;
    let discount = 0;
    let tax = 0;
    for (const l of lines) {
      const qty = toNum(l.quantity);
      const unit = toInt(l.unitPrice);
      const sub = Math.round(qty * unit);
      const disc = Math.round((sub * toNum(l.discountPct) * 100) / 10_000);
      const taxable = sub - disc;
      const code = taxCodes.find((t) => t.id === l.taxCodeId);
      const taxAmt = Math.round((taxable * (code?.rateBps ?? 0)) / 10_000);
      subtotal += sub;
      discount += disc;
      tax += taxAmt;
    }
    return { subtotal, discount, tax, total: subtotal - discount + tax };
  }, [lines, taxCodes]);

  function updateLine(id: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function pickItem(lineId: string, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    updateLine(lineId, {
      itemId,
      description: item ? item.name : "",
      unitPrice: item ? (Number(item.sellPriceCents) / 100).toString() : "0",
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!scheduleName.trim()) return setError("Give the schedule a name.");
    if (!customerId) return setError("Pick a customer.");
    if (lines.length === 0) return setError("Add at least one line.");
    const doM = Number(dayOfMonth);
    if (!Number.isInteger(doM) || doM < 1 || doM > 28) return setError("Day of month must be between 1 and 28.");

    setBusy(true);
    try {
      const res = await api.createRecurringInvoice({
        customerId,
        scheduleName: scheduleName.trim(),
        frequency: "monthly",
        dayOfMonth: doM,
        startDate,
        endDate: endDate || undefined,
        dueDays: Number(dueDays) || 30,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: lines.map((l) => ({
          itemId: l.itemId || undefined,
          description: l.description.trim(),
          quantity: toNum(l.quantity),
          unitPriceCents: toInt(l.unitPrice),
          discountPctBps: Math.round(toNum(l.discountPct) * 100),
          taxCodeId: l.taxCodeId || undefined,
        })),
      });
      router.push(`/app/recurring-invoices`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/recurring-invoices" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to recurring invoices
        </Link>
      </div>

      <PageHeader
        eyebrow="Sell"
        title="New recurring invoice"
        description="Create a template that generates a draft invoice every month on the day you pick. You'll still review and post each draft — nothing posts automatically."
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
                  placeholder="e.g. Monthly retainer — ACME"
                  className="input mt-1.5 w-full"
                />
              </div>
              <div>
                <Label htmlFor="customer">Customer</Label>
                <select id="customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="input mt-1.5 w-full">
                  <option value="">Select a customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="dayOfMonth">Day of month</Label>
                <input id="dayOfMonth" type="number" min={1} max={28} value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} className="input mt-1.5 w-full" />
                <p className="mt-1 text-caption text-text-tertiary">1–28 to avoid month-end edge cases.</p>
              </div>
              <div>
                <Label htmlFor="startDate">Start date</Label>
                <input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input mt-1.5 w-full" />
              </div>
              <div>
                <Label htmlFor="endDate">End date (optional)</Label>
                <input id="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input mt-1.5 w-full" />
              </div>
              <div>
                <Label htmlFor="dueDays">Due within (days)</Label>
                <input id="dueDays" type="number" min={0} max={365} value={dueDays} onChange={(e) => setDueDays(e.target.value)} className="input mt-1.5 w-full" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="reference">Reference (optional)</Label>
                <input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} className="input mt-1.5 w-full" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="notes">Notes (optional)</Label>
                <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input mt-1.5 w-full" />
              </div>
            </div>
          </section>

          <section className="rounded-card border-hairline border-border bg-surface-elevated">
            <div className="flex items-center justify-between gap-2 px-5 py-4">
              <h2 className="text-body font-medium text-charcoal">Line items</h2>
              <button
                type="button"
                className="btn-ghost inline-flex items-center gap-1 text-caption"
                onClick={() => setLines((prev) => [...prev, emptyLine()])}
              >
                <Plus className="h-3.5 w-3.5" /> Add line
              </button>
            </div>
            <div className="divide-y-hairline divide-border">
              {lines.map((l) => (
                <div key={l.id} className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_1fr_90px_110px_70px_110px_40px]">
                  <div className="md:col-span-1">
                    <select value={l.itemId} onChange={(e) => pickItem(l.id, e.target.value)} className="input w-full">
                      <option value="">Free-form…</option>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>{i.name}</option>
                      ))}
                    </select>
                  </div>
                  <input placeholder="Description" value={l.description} onChange={(e) => updateLine(l.id, { description: e.target.value })} className="input" />
                  <input type="number" step="0.01" placeholder="Qty" value={l.quantity} onChange={(e) => updateLine(l.id, { quantity: e.target.value })} className="input text-right" />
                  <input type="number" step="0.01" placeholder="Unit" value={l.unitPrice} onChange={(e) => updateLine(l.id, { unitPrice: e.target.value })} className="input text-right" />
                  <input type="number" step="0.01" placeholder="Disc %" value={l.discountPct} onChange={(e) => updateLine(l.id, { discountPct: e.target.value })} className="input text-right" />
                  <select value={l.taxCodeId} onChange={(e) => updateLine(l.id, { taxCodeId: e.target.value })} className="input">
                    <option value="">No tax</option>
                    {taxCodes.map((t) => (
                      <option key={t.id} value={t.id}>{t.code}</option>
                    ))}
                  </select>
                  <button type="button" className="btn-ghost text-text-tertiary" onClick={() => setLines((prev) => prev.filter((x) => x.id !== l.id))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-card border-hairline border-border bg-surface-elevated p-5">
            <h2 className="text-body font-medium text-charcoal">Per-cycle totals</h2>
            <dl className="mt-3 space-y-2 text-small">
              <Row label="Subtotal" value={formatLKR(computed.subtotal)} />
              <Row label="Discounts" value={formatLKR(-computed.discount)} dim />
              <Row label="Tax" value={formatLKR(computed.tax)} dim />
              <div className="my-2 h-px bg-border" />
              <Row label="Total per run" value={formatLKR(computed.total)} strong />
            </dl>
            <p className="mt-3 text-caption text-text-tertiary">
              Tax rates are re-applied at generate-time, so VAT/SSCL changes flow through automatically on the next run.
            </p>
          </section>

          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy} className="btn-primary inline-flex items-center gap-2 text-small disabled:opacity-50">
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

function Row({ label, value, dim, strong }: { label: string; value: string; dim?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={`text-small ${dim ? "text-text-tertiary" : "text-text-secondary"}`}>{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-medium text-charcoal" : dim ? "text-text-tertiary" : "text-charcoal"}`}>{value}</dd>
    </div>
  );
}
