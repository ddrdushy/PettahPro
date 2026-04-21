"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { api, ApiError, type Item, type WarehouseRow } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";

interface LineDraft {
  id: string;
  itemId: string;
  quantity: string;
  notes: string;
}

function emptyLine(): LineDraft {
  return { id: crypto.randomUUID(), itemId: "", quantity: "1", notes: "" };
}

export function NewTransferClient({
  warehouses,
  items,
}: {
  warehouses: WarehouseRow[];
  items: Item[];
}) {
  const router = useRouter();
  const activeWarehouses = warehouses.filter((w) => w.isActive);
  const defaultSource = activeWarehouses.find((w) => w.isDefault) ?? activeWarehouses[0];
  const nonSourceDefault = activeWarehouses.find((w) => w.id !== defaultSource?.id);

  const [sourceId, setSourceId] = useState(defaultSource?.id ?? "");
  const [destId, setDestId] = useState(nonSourceDefault?.id ?? "");
  const [requestedDate, setRequestedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateLine(id: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  async function submit() {
    setError(null);
    if (!sourceId) return setError("Pick a source warehouse.");
    if (!destId) return setError("Pick a destination warehouse.");
    if (sourceId === destId) return setError("Source and destination must be different.");
    const valid = lines
      .filter((l) => l.itemId && Number(l.quantity) > 0)
      .map((l) => ({
        itemId: l.itemId,
        quantityRequested: Number(l.quantity),
        notes: l.notes.trim() || undefined,
      }));
    if (valid.length === 0) return setError("Add at least one line with an item and qty.");

    setBusy(true);
    try {
      const res = await api.createStockTransfer({
        sourceWarehouseId: sourceId,
        destinationWarehouseId: destId,
        requestedDate,
        notes: notes.trim() || undefined,
        lines: valid,
      });
      router.push(`/app/stock/transfers/${res.transfer.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create transfer.");
      setBusy(false);
    }
  }

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/stock/transfers" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to transfers
        </Link>
      </div>

      <PageHeader
        eyebrow="Stock"
        title="New stock transfer"
        description="Draft the transfer first. Stock moves only when you click Dispatch — the receiver confirms on arrival."
      />

      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">From warehouse</label>
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="input mt-1.5 w-full">
            <option value="">Select…</option>
            {activeWarehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">To warehouse</label>
          <select value={destId} onChange={(e) => setDestId(e.target.value)} className="input mt-1.5 w-full">
            <option value="">Select…</option>
            {activeWarehouses.filter((w) => w.id !== sourceId).map((w) => (
              <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">Requested date</label>
          <input type="date" value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} className="input mt-1.5 w-full" />
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <header className="flex items-center justify-between border-b-hairline border-border px-5 py-3">
          <h2 className="text-body font-medium text-charcoal">Lines</h2>
          <button type="button" onClick={() => setLines((p) => [...p, emptyLine()])} className="btn-ghost inline-flex items-center gap-1 text-caption">
            <Plus className="h-3 w-3" /> Add line
          </button>
        </header>
        <table className="w-full text-small">
          <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="px-4 py-2 text-left">Item</th>
              <th className="w-32 px-4 py-2 text-right">Quantity</th>
              <th className="px-4 py-2 text-left">Notes</th>
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2">
                  <select value={l.itemId} onChange={(e) => updateLine(l.id, { itemId: e.target.value })} className="input w-full">
                    <option value="">Select item…</option>
                    {items.filter((i) => i.trackInventory).map((i) => (
                      <option key={i.id} value={i.id}>{i.name}{i.sku ? ` · ${i.sku}` : ""}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={l.quantity}
                    onChange={(e) => updateLine(l.id, { quantity: e.target.value })}
                    className="input w-full text-right"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    value={l.notes}
                    onChange={(e) => updateLine(l.id, { notes: e.target.value })}
                    placeholder="(optional)"
                    className="input w-full"
                  />
                </td>
                <td className="px-2 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setLines((p) => (p.length <= 1 ? p : p.filter((x) => x.id !== l.id)))}
                    className="btn-ghost text-text-tertiary"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-4">
        <label className="block text-caption uppercase tracking-wide text-text-tertiary">Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="(optional)" className="input mt-1.5 w-full" />
      </section>

      {error && <p className="mt-3 text-caption text-danger">{error}</p>}

      <div className="mt-5 flex items-center justify-end gap-2">
        <button type="button" onClick={submit} disabled={busy} className="btn-primary inline-flex items-center gap-2 text-small disabled:opacity-50">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save draft
        </button>
      </div>
    </main>
  );
}
