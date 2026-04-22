"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { api, ApiError, type Item, type WarehouseRow } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";

type ScopeType = "warehouse" | "items";

interface ItemPick {
  id: string;
  itemId: string;
}

function emptyPick(): ItemPick {
  return { id: crypto.randomUUID(), itemId: "" };
}

export function NewStockCountClient({
  warehouses,
  items,
}: {
  warehouses: WarehouseRow[];
  items: Item[];
}) {
  const router = useRouter();
  const activeWarehouses = warehouses.filter((w) => w.isActive);
  const defaultWh = activeWarehouses.find((w) => w.isDefault) ?? activeWarehouses[0];

  const [warehouseId, setWarehouseId] = useState(defaultWh?.id ?? "");
  const [countDate, setCountDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [scopeType, setScopeType] = useState<ScopeType>("warehouse");
  const [thresholdPct, setThresholdPct] = useState("1.0");
  const [notes, setNotes] = useState("");
  const [picks, setPicks] = useState<ItemPick[]>([emptyPick()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trackedItems = items.filter((i) => i.trackInventory);

  function updatePick(id: string, itemId: string) {
    setPicks((prev) => prev.map((p) => (p.id === id ? { ...p, itemId } : p)));
  }

  async function submit() {
    setError(null);
    if (!warehouseId) return setError("Pick a warehouse.");

    const pct = Number(thresholdPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return setError("Variance threshold must be between 0 and 100 %.");
    }
    const bps = Math.round(pct * 100);

    let lines: Array<{ itemId: string }> | undefined;
    if (scopeType === "items") {
      const chosen = picks.map((p) => p.itemId).filter(Boolean);
      if (chosen.length === 0) return setError("Pick at least one item for a targeted count.");
      if (new Set(chosen).size !== chosen.length) return setError("An item was picked twice.");
      lines = chosen.map((itemId) => ({ itemId }));
    }

    setBusy(true);
    try {
      const res = await api.createStockCount({
        warehouseId,
        countDate,
        scopeType,
        lines,
        notes: notes.trim() || undefined,
        varianceThresholdBps: bps,
      });
      router.push(`/app/stock/counts/${res.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "EMPTY_SCOPE") {
        setError("This warehouse has no items with balance rows. Receive stock into it first, or pick a targeted item count.");
      } else {
        setError(err instanceof ApiError ? err.message : "Couldn't create the count.");
      }
      setBusy(false);
    }
  }

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/stock/counts" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to counts
        </Link>
      </div>

      <PageHeader
        eyebrow="Stock"
        title="New stock count"
        description="Creating the count snapshots the current on-hand qty and average cost for every item in scope. Those snapshots are what variance is measured against, even if bills or invoices post during the count."
      />

      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">Warehouse</label>
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            className="input mt-1.5 w-full"
          >
            <option value="">Select…</option>
            {activeWarehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">Count date</label>
          <input
            type="date"
            value={countDate}
            onChange={(e) => setCountDate(e.target.value)}
            className="input mt-1.5 w-full"
          />
        </div>
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">
            Variance threshold (%)
          </label>
          <input
            type="number"
            step="0.1"
            min={0}
            max={100}
            value={thresholdPct}
            onChange={(e) => setThresholdPct(e.target.value)}
            className="input mt-1.5 w-full"
          />
          <p className="mt-1 text-caption text-text-tertiary">
            Counts exceeding this require a different user to approve before posting.
          </p>
        </div>
      </section>

      <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
        <h2 className="text-body font-medium text-charcoal">Scope</h2>
        <div className="mt-3 space-y-2">
          <label className="flex items-start gap-3">
            <input
              type="radio"
              name="scope"
              value="warehouse"
              checked={scopeType === "warehouse"}
              onChange={() => setScopeType("warehouse")}
              className="mt-1"
            />
            <div>
              <div className="text-small font-medium">Full warehouse</div>
              <p className="text-caption text-text-tertiary">
                Snapshot every item with a balance row in the selected warehouse. Best for monthly physical counts.
              </p>
            </div>
          </label>
          <label className="flex items-start gap-3">
            <input
              type="radio"
              name="scope"
              value="items"
              checked={scopeType === "items"}
              onChange={() => setScopeType("items")}
              className="mt-1"
            />
            <div>
              <div className="text-small font-medium">Targeted items (cycle count)</div>
              <p className="text-caption text-text-tertiary">
                Only the items you pick below. Useful for focused re-counts or high-value SKUs on a rolling schedule.
              </p>
            </div>
          </label>
        </div>
      </section>

      {scopeType === "items" && (
        <section className="mt-4 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <header className="flex items-center justify-between border-b-hairline border-border px-5 py-3">
            <h2 className="text-body font-medium text-charcoal">Items</h2>
            <button
              type="button"
              onClick={() => setPicks((p) => [...p, emptyPick()])}
              className="btn-ghost inline-flex items-center gap-1 text-caption"
            >
              <Plus className="h-3 w-3" /> Add item
            </button>
          </header>
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="px-4 py-2 text-left">Item</th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {picks.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2">
                    <select
                      value={p.itemId}
                      onChange={(e) => updatePick(p.id, e.target.value)}
                      className="input w-full"
                    >
                      <option value="">Select item…</option>
                      {trackedItems.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                          {i.sku ? ` · ${i.sku}` : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        setPicks((prev) => (prev.length <= 1 ? prev : prev.filter((x) => x.id !== p.id)))
                      }
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
      )}

      <section className="mt-4">
        <label className="block text-caption uppercase tracking-wide text-text-tertiary">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="(optional — e.g. 'April month-end count')"
          className="input mt-1.5 w-full"
        />
      </section>

      {error && <p className="mt-3 text-caption text-danger">{error}</p>}

      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="btn-primary inline-flex items-center gap-2 text-small disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Start count
        </button>
      </div>
    </main>
  );
}
