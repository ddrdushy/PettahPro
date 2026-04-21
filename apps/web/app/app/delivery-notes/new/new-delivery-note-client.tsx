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
  type SalesOrderListRow,
  type InvoiceListRow,
  type CreateDeliveryNoteLine,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatDate } from "@/lib/format";

interface LineDraft {
  id: string;
  itemId: string;
  description: string;
  quantity: string;
}

function emptyLine(): LineDraft {
  return { id: crypto.randomUUID(), itemId: "", description: "", quantity: "1" };
}

function toNum(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

export function NewDeliveryNoteClient({
  customers,
  items,
  salesOrders,
  invoices,
}: {
  customers: Customer[];
  items: Item[];
  salesOrders: SalesOrderListRow[];
  invoices: InvoiceListRow[];
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState("");
  const [salesOrderId, setSalesOrderId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [shippingAddr1, setShippingAddr1] = useState("");
  const [shippingCity, setShippingCity] = useState("");
  const [carrier, setCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customerSOs = useMemo(
    () => salesOrders.filter((so) => !customerId || so.customerId === customerId),
    [salesOrders, customerId],
  );
  const customerInvoices = useMemo(
    () => invoices.filter((inv) => !customerId || inv.customerId === customerId),
    [invoices, customerId],
  );

  function updateLine(id: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function addLine() { setLines((prev) => [...prev, emptyLine()]); }
  function removeLine(id: string) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.id !== id)));
  }
  function onItemPicked(lineId: string, pickedItemId: string) {
    const it = items.find((i) => i.id === pickedItemId);
    updateLine(lineId, { itemId: pickedItemId, description: it?.name ?? "" });
  }

  async function submit() {
    setError(null);
    if (!customerId) { setError("Pick a customer."); return; }
    const apiLines: CreateDeliveryNoteLine[] = [];
    for (const l of lines) {
      const qty = toNum(l.quantity);
      if (qty <= 0) continue;
      if (!l.description.trim()) { setError("Every line needs a description."); return; }
      apiLines.push({
        itemId: l.itemId || undefined,
        description: l.description.trim(),
        quantity: qty,
      });
    }
    if (apiLines.length === 0) { setError("Enter at least one line."); return; }

    setBusy(true);
    try {
      const res = await api.createDeliveryNote({
        customerId,
        salesOrderId: salesOrderId || undefined,
        invoiceId: invoiceId || undefined,
        deliveryDate,
        shippingAddressLine1: shippingAddr1.trim() || undefined,
        shippingCity: shippingCity.trim() || undefined,
        carrier: carrier.trim() || undefined,
        trackingNumber: trackingNumber.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: apiLines,
      });
      router.push(`/app/delivery-notes/${res.deliveryNote.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/delivery-notes" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to delivery notes
        </Link>
      </div>

      <PageHeader
        eyebrow="Sell"
        title="New delivery note"
        description="Record what's being shipped and to whom. Mark delivered when the customer signs."
      />

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="customer" className="block text-caption uppercase tracking-wide text-text-tertiary">Customer</label>
          <select id="customer" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setSalesOrderId(""); setInvoiceId(""); }} className="input mt-1.5">
            <option value="">Pick a customer…</option>
            {customers.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
        </div>
        <div>
          <label htmlFor="delivery-date" className="block text-caption uppercase tracking-wide text-text-tertiary">Delivery date</label>
          <input id="delivery-date" type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className="input mt-1.5" />
        </div>
        <div>
          <label htmlFor="so" className="block text-caption uppercase tracking-wide text-text-tertiary">Sales order (optional)</label>
          <select id="so" value={salesOrderId} onChange={(e) => setSalesOrderId(e.target.value)} disabled={!customerId} className="input mt-1.5 disabled:opacity-50">
            <option value="">—</option>
            {customerSOs.map((so) => (<option key={so.id} value={so.id}>{so.soNumber ?? so.id.slice(0, 8)} · {formatDate(so.orderDate)}</option>))}
          </select>
        </div>
        <div>
          <label htmlFor="inv" className="block text-caption uppercase tracking-wide text-text-tertiary">Invoice (optional)</label>
          <select id="inv" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} disabled={!customerId} className="input mt-1.5 disabled:opacity-50">
            <option value="">—</option>
            {customerInvoices.map((inv) => (<option key={inv.id} value={inv.id}>{inv.invoiceNumber ?? inv.id.slice(0, 8)} · {formatDate(inv.issueDate)}</option>))}
          </select>
        </div>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="addr" className="block text-caption uppercase tracking-wide text-text-tertiary">Shipping address</label>
          <input id="addr" type="text" value={shippingAddr1} onChange={(e) => setShippingAddr1(e.target.value)} placeholder="Street address" className="input mt-1.5" />
        </div>
        <div>
          <label htmlFor="city" className="block text-caption uppercase tracking-wide text-text-tertiary">City</label>
          <input id="city" type="text" value={shippingCity} onChange={(e) => setShippingCity(e.target.value)} className="input mt-1.5" />
        </div>
        <div>
          <label htmlFor="carrier" className="block text-caption uppercase tracking-wide text-text-tertiary">Carrier</label>
          <input id="carrier" type="text" value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Own transport, Kapruka, DHL…" className="input mt-1.5" />
        </div>
        <div>
          <label htmlFor="tracking" className="block text-caption uppercase tracking-wide text-text-tertiary">Tracking #</label>
          <input id="tracking" type="text" value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} className="input mt-1.5 tabular-nums" />
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <table className="w-full text-small">
          <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="w-10 px-3 py-3 text-center">#</th>
              <th className="w-48 px-3 py-3 text-left">Item</th>
              <th className="px-3 py-3 text-left">Description</th>
              <th className="w-24 px-3 py-3 text-right">Qty</th>
              <th className="w-10 px-2 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            {lines.map((l, idx) => (
              <tr key={l.id}>
                <td className="px-3 py-2 text-center tabular-nums text-text-tertiary">{idx + 1}</td>
                <td className="px-3 py-2">
                  <select value={l.itemId} onChange={(e) => onItemPicked(l.id, e.target.value)} className="input text-small">
                    <option value="">No item (free text)</option>
                    {items.map((it) => (<option key={it.id} value={it.id}>{it.name}</option>))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input type="text" value={l.description} onChange={(e) => updateLine(l.id, { description: e.target.value })} placeholder="What's shipped" className="input text-small" />
                </td>
                <td className="px-3 py-2">
                  <input type="number" step="0.01" min="0" value={l.quantity} onChange={(e) => updateLine(l.id, { quantity: e.target.value })} className="input text-right tabular-nums text-small" />
                </td>
                <td className="px-2 py-2 text-right">
                  <button type="button" onClick={() => removeLine(l.id)} disabled={lines.length <= 1} className="rounded p-1 text-text-tertiary transition-colors hover:text-danger disabled:cursor-not-allowed disabled:opacity-30" aria-label="Remove line">
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-surface-recessed/50">
            <tr>
              <td colSpan={5} className="px-3 py-3">
                <button type="button" onClick={addLine} className="btn-link text-small">
                  <Plus className="h-3.5 w-3.5" aria-hidden /> Add line
                </button>
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="mt-6">
        <label htmlFor="notes" className="block text-caption uppercase tracking-wide text-text-tertiary">Notes</label>
        <textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Handling notes, special instructions" className="input mt-1.5" />
      </section>

      <section className="mt-6 flex items-center justify-between gap-4">
        <p className="text-small text-text-secondary">Saved as a draft. Mark delivered when the customer signs.</p>
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
