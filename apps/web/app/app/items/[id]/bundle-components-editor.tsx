"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react";
import { api, ApiError, type BundleComponent, type Item } from "@/lib/api";

// Client-side editor for a bundle's component list. Mirrors the
// create-time form editor but persists via `PUT /items/:id/components`
// rather than a follow-up call after item creation. Replace-all
// semantics — the backend deletes and re-inserts in one transaction,
// so the UI doesn't need to diff.
interface Row {
  key: string;
  componentItemId: string;
  quantity: string;
}

export function BundleComponentsEditor({
  itemId,
  initial,
  allItems,
}: {
  itemId: string;
  initial: BundleComponent[];
  allItems: Item[];
}) {
  const [rows, setRows] = useState<Row[]>(
    initial.map((c, idx) => ({
      key: `${c.id}-${idx}`,
      componentItemId: c.componentItemId,
      quantity: String(c.quantity),
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const candidates = useMemo(() => allItems, [allItems]);

  function addRow() {
    setRows((r) => [
      ...r,
      {
        key: `new-${Date.now()}-${r.length}`,
        componentItemId: "",
        quantity: "1",
      },
    ]);
  }

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeRow(key: string) {
    setRows((all) => all.filter((r) => r.key !== key));
  }

  async function save() {
    setBusy(true);
    setError(null);

    // Consolidate duplicate componentItemIds — if the user added the
    // same item twice, collapse their quantities rather than 400'ing.
    const byId = new Map<string, number>();
    for (const r of rows) {
      if (!r.componentItemId) continue;
      const qty = Number(r.quantity);
      if (!(qty > 0)) {
        setError("Every component row needs a positive quantity.");
        setBusy(false);
        return;
      }
      byId.set(r.componentItemId, (byId.get(r.componentItemId) ?? 0) + qty);
    }
    const payload = Array.from(byId.entries()).map(
      ([componentItemId, quantity]) => ({ componentItemId, quantity }),
    );

    try {
      await api.replaceItemComponents(itemId, payload);
      setSavedAt(new Date());
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : "Couldn't save components. Try again.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      {rows.length === 0 && (
        <div className="rounded-md border-hairline border-amber-400/50 bg-amber-50/60 p-3 text-small text-amber-900 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-none" aria-hidden />
          <span>
            No components. Selling this bundle will book revenue with zero
            COGS — intentional for hand-assembly placeholders, otherwise add
            components below.
          </span>
        </div>
      )}
      {rows.map((row) => (
        <div
          key={row.key}
          className="grid grid-cols-[1fr_auto_auto] gap-2 items-end"
        >
          <div>
            <label className="block text-caption text-text-tertiary">
              Component
            </label>
            <select
              value={row.componentItemId}
              onChange={(e) =>
                updateRow(row.key, { componentItemId: e.target.value })
              }
              className="mt-1 block w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
            >
              <option value="">Choose an item…</option>
              {candidates.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                  {i.sku ? ` · ${i.sku}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-caption text-text-tertiary">Qty</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={row.quantity}
              onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
              className="mt-1 block w-24 rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => removeRow(row.key)}
            className="mb-1 rounded-md border-hairline border-border px-2 py-2 text-text-tertiary hover:border-danger hover:text-danger"
            aria-label="Remove component"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ))}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-2 rounded-md border-hairline border-border px-3 py-2 text-small text-charcoal hover:border-charcoal"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add component
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="btn-primary"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Saving…
            </>
          ) : (
            "Save components"
          )}
        </button>
        {savedAt && !busy && (
          <span className="text-caption text-text-tertiary">Saved.</span>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-3 text-small text-danger"
        >
          {error}
        </div>
      )}
    </div>
  );
}
