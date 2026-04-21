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
  type PurchaseOrderListRow,
  type BillListRow,
  type CreateGrnLine,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatDate } from "@/lib/format";

interface LineDraft {
  id: string;
  itemId: string;
  description: string;
  quantityOrdered: string;
  quantityReceived: string;
  lineNotes: string;
}

function emptyLine(): LineDraft {
  return {
    id: crypto.randomUUID(),
    itemId: "",
    description: "",
    quantityOrdered: "",
    quantityReceived: "1",
    lineNotes: "",
  };
}

function toNum(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

export function NewGrnClient({
  suppliers,
  items,
  purchaseOrders,
  bills,
}: {
  suppliers: Supplier[];
  items: Item[];
  purchaseOrders: PurchaseOrderListRow[];
  bills: BillListRow[];
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState("");
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [billId, setBillId] = useState("");
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [supplierDeliveryNote, setSupplierDeliveryNote] = useState("");
  const [conditionNotes, setConditionNotes] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supplierPOs = useMemo(
    () => purchaseOrders.filter((po) => !supplierId || po.supplierId === supplierId),
    [purchaseOrders, supplierId],
  );
  const supplierBills = useMemo(
    () => bills.filter((b) => !supplierId || b.supplierId === supplierId),
    [bills, supplierId],
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
    if (!supplierId) { setError("Pick a supplier."); return; }
    const apiLines: CreateGrnLine[] = [];
    for (const l of lines) {
      const qtyRecv = toNum(l.quantityReceived);
      if (qtyRecv <= 0) continue;
      if (!l.description.trim()) { setError("Every line needs a description."); return; }
      apiLines.push({
        itemId: l.itemId || undefined,
        description: l.description.trim(),
        quantityOrdered: l.quantityOrdered ? toNum(l.quantityOrdered) : undefined,
        quantityReceived: qtyRecv,
        lineNotes: l.lineNotes.trim() || undefined,
      });
    }
    if (apiLines.length === 0) { setError("Enter at least one line with quantity received."); return; }

    setBusy(true);
    try {
      const res = await api.createGrn({
        supplierId,
        purchaseOrderId: purchaseOrderId || undefined,
        billId: billId || undefined,
        receiptDate,
        supplierDeliveryNote: supplierDeliveryNote.trim() || undefined,
        conditionNotes: conditionNotes.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: apiLines,
      });
      router.push(`/app/grns/${res.grn.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/grns" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to GRNs
        </Link>
      </div>

      <PageHeader
        eyebrow="Buy"
        title="New goods received note"
        description="Record what arrived, from whom, and in what condition. Mark received when the count is confirmed."
      />

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="supplier" className="block text-caption uppercase tracking-wide text-text-tertiary">Supplier</label>
          <select id="supplier" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setPurchaseOrderId(""); setBillId(""); }} className="input mt-1.5">
            <option value="">Pick a supplier…</option>
            {suppliers.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
        </div>
        <div>
          <label htmlFor="receipt-date" className="block text-caption uppercase tracking-wide text-text-tertiary">Receipt date</label>
          <input id="receipt-date" type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} className="input mt-1.5" />
        </div>
        <div>
          <label htmlFor="po" className="block text-caption uppercase tracking-wide text-text-tertiary">Purchase order (optional)</label>
          <select id="po" value={purchaseOrderId} onChange={(e) => setPurchaseOrderId(e.target.value)} disabled={!supplierId} className="input mt-1.5 disabled:opacity-50">
            <option value="">—</option>
            {supplierPOs.map((po) => (<option key={po.id} value={po.id}>{po.poNumber ?? po.id.slice(0, 8)} · {formatDate(po.orderDate)}</option>))}
          </select>
        </div>
        <div>
          <label htmlFor="bill" className="block text-caption uppercase tracking-wide text-text-tertiary">Bill (optional)</label>
          <select id="bill" value={billId} onChange={(e) => setBillId(e.target.value)} disabled={!supplierId} className="input mt-1.5 disabled:opacity-50">
            <option value="">—</option>
            {supplierBills.map((b) => (<option key={b.id} value={b.id}>{b.internalReference ?? b.supplierBillNumber ?? b.id.slice(0, 8)} · {formatDate(b.billDate)}</option>))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label htmlFor="sup-dn" className="block text-caption uppercase tracking-wide text-text-tertiary">Supplier's delivery note number</label>
          <input id="sup-dn" type="text" value={supplierDeliveryNote} onChange={(e) => setSupplierDeliveryNote(e.target.value)} placeholder="The DN number printed on their paperwork" className="input mt-1.5" />
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <table className="w-full text-small">
          <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="w-10 px-3 py-3 text-center">#</th>
              <th className="w-48 px-3 py-3 text-left">Item</th>
              <th className="px-3 py-3 text-left">Description</th>
              <th className="w-24 px-3 py-3 text-right">Ordered</th>
              <th className="w-24 px-3 py-3 text-right">Received</th>
              <th className="w-48 px-3 py-3 text-left">Line notes</th>
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
                  <input type="text" value={l.description} onChange={(e) => updateLine(l.id, { description: e.target.value })} placeholder="What arrived" className="input text-small" />
                </td>
                <td className="px-3 py-2">
                  <input type="number" step="0.01" min="0" value={l.quantityOrdered} onChange={(e) => updateLine(l.id, { quantityOrdered: e.target.value })} className="input text-right tabular-nums text-small" />
                </td>
                <td className="px-3 py-2">
                  <input type="number" step="0.01" min="0" value={l.quantityReceived} onChange={(e) => updateLine(l.id, { quantityReceived: e.target.value })} className="input text-right tabular-nums text-small" />
                </td>
                <td className="px-3 py-2">
                  <input type="text" value={l.lineNotes} onChange={(e) => updateLine(l.id, { lineNotes: e.target.value })} placeholder="damaged, short, etc." className="input text-small" />
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
              <td colSpan={7} className="px-3 py-3">
                <button type="button" onClick={addLine} className="btn-link text-small">
                  <Plus className="h-3.5 w-3.5" aria-hidden /> Add line
                </button>
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="condition" className="block text-caption uppercase tracking-wide text-text-tertiary">Condition notes</label>
          <textarea id="condition" rows={3} value={conditionNotes} onChange={(e) => setConditionNotes(e.target.value)} placeholder="Overall state of goods: damage, broken seals, etc." className="input mt-1.5" />
        </div>
        <div>
          <label htmlFor="notes" className="block text-caption uppercase tracking-wide text-text-tertiary">Notes</label>
          <textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal context" className="input mt-1.5" />
        </div>
      </section>

      <section className="mt-6 flex items-center justify-between gap-4">
        <p className="text-small text-text-secondary">Saved as a draft. Mark received when the count is confirmed.</p>
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
