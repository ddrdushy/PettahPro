"use client";

import { useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react";
import { Field } from "@/components/auth/field";
import {
  api,
  ApiError,
  type Item,
  type ItemCategoryNode,
  type TaxCode,
} from "@/lib/api";

// Draft row for the bundle component editor. Held in local state as
// the user adds / removes rows; a successful create flushes the rows
// to the server via `replaceItemComponents` right after the item is
// created.
interface ComponentDraft {
  key: string;
  componentItemId: string;
  quantity: string; // kept as string so we don't clobber partial input
}

export function ItemForm({
  taxCodes,
  categories = [],
  allItems = [],
  onCreated,
}: {
  taxCodes: TaxCode[];
  categories?: ItemCategoryNode[];
  // Used to power the bundle component picker. Kept optional for
  // callers that don't care (e.g. the drawer is closed for a
  // non-bundle tenant).
  allItems?: Item[];
  onCreated: (i: Item) => void;
}) {
  const [itemType, setItemType] = useState<"product" | "service" | "bundle">(
    "product",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [components, setComponents] = useState<ComponentDraft[]>([]);

  // Non-bundle items are eligible components. Filter out soft-deleted
  // rows defensively even though the API list excludes them.
  const componentCandidates = useMemo(
    () => allItems.filter((i) => i.itemType !== "bundle" && i.isActive),
    [allItems],
  );

  function addComponentRow() {
    setComponents((rows) => [
      ...rows,
      {
        key: `${Date.now()}-${rows.length}`,
        componentItemId: "",
        quantity: "1",
      },
    ]);
  }

  function updateComponentRow(key: string, patch: Partial<ComponentDraft>) {
    setComponents((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  }

  function removeComponentRow(key: string) {
    setComponents((rows) => rows.filter((r) => r.key !== key));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);

    const sellLKR = Number(f.get("sellPrice") ?? 0);
    const buyLKR = Number(f.get("buyPrice") ?? 0);
    const reorder = Number(f.get("reorderPoint") ?? 0);
    const taxCodeId = String(f.get("taxCodeId") ?? "");
    const categoryId = String(f.get("categoryId") ?? "");

    // Bundle validation before the round-trip. Consolidate duplicate
    // componentItemIds: if the user picked the same item in two rows,
    // collapse their quantities rather than letting the API 400.
    const bundleComponents: Array<{ componentItemId: string; quantity: number }> = [];
    if (itemType === "bundle") {
      const byId = new Map<string, number>();
      for (const row of components) {
        if (!row.componentItemId) continue;
        const qty = Number(row.quantity);
        if (!(qty > 0)) {
          setError("Every component row needs a positive quantity.");
          setBusy(false);
          return;
        }
        byId.set(
          row.componentItemId,
          (byId.get(row.componentItemId) ?? 0) + qty,
        );
      }
      for (const [componentItemId, quantity] of byId) {
        bundleComponents.push({ componentItemId, quantity });
      }
    }

    try {
      const { item } = await api.createItem({
        sku: String(f.get("sku") ?? "").trim() || undefined,
        name: String(f.get("name") ?? "").trim(),
        description: String(f.get("description") ?? "").trim() || undefined,
        itemType,
        unit: String(f.get("unit") ?? "unit").trim() || "unit",
        sellPriceCents: Math.round(sellLKR * 100),
        buyPriceCents: Math.round(buyLKR * 100),
        reorderPoint: reorder > 0 ? Math.round(reorder) : undefined,
        taxCodeId: taxCodeId || undefined,
        categoryId: categoryId || null,
        // Bundles don't carry stock. The API enforces this too, but
        // being explicit here keeps the wire payload matching the UI.
        trackInventory: itemType === "bundle" ? false : undefined,
      });

      // Flush bundle components after the parent item exists. If this
      // fails the item itself is still created (user can retry from
      // the detail page) — we surface the error rather than rolling
      // back the item.
      if (itemType === "bundle" && bundleComponents.length > 0) {
        try {
          await api.replaceItemComponents(item.id, bundleComponents);
        } catch (err) {
          const msg =
            err instanceof ApiError
              ? err.message
              : "Couldn't save bundle components. Open the bundle and try again.";
          setError(msg);
          // Still fire onCreated so the parent list refreshes — the
          // item exists even if components didn't save.
          onCreated(item);
          setBusy(false);
          return;
        }
      }
      onCreated(item);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.code === "DUPLICATE_SKU"
            ? "An item with this SKU already exists."
            : err.message
          : "Couldn't create the item. Try again.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <section className="space-y-4">
        <SectionTitle>Type</SectionTitle>
        <div className="grid grid-cols-3 gap-2">
          {(["product", "service", "bundle"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setItemType(t)}
              className={`rounded-md border-hairline py-2 text-small capitalize transition ${
                itemType === t
                  ? "border-charcoal bg-charcoal text-offwhite"
                  : "border-border bg-surface-elevated text-text-secondary hover:border-charcoal hover:text-charcoal"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        {itemType === "bundle" && (
          <p className="text-caption text-text-tertiary">
            Bundle items are virtual — they never carry stock themselves.
            Selling a bundle relieves each component&rsquo;s stock using its
            weighted-average cost.
          </p>
        )}
      </section>

      <section className="space-y-4">
        <SectionTitle>Identity</SectionTitle>
        <Field label="Name" name="name" required placeholder="Cement 50kg bag" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="SKU" name="sku" placeholder="CEM-50" />
          <Field label="Unit" name="unit" defaultValue="unit" placeholder="bag · kg · unit · hour" />
        </div>
        <Field label="Description" name="description" />
        {categories.length > 0 && (
          <div>
            <label
              htmlFor="categoryId"
              className="block text-small font-medium text-charcoal"
            >
              Category
            </label>
            <select
              id="categoryId"
              name="categoryId"
              defaultValue=""
              className="mt-1.5 block w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {"\u00A0\u00A0".repeat(c.depth)}
                  {c.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-caption text-text-tertiary">
              Inherits valuation, tax code, and GL accounts from the category.
            </p>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <SectionTitle>Pricing (LKR)</SectionTitle>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Buy price"
            name="buyPrice"
            type="number"
            min={0}
            step="0.01"
            defaultValue={0}
          />
          <Field
            label="Sell price"
            name="sellPrice"
            type="number"
            min={0}
            step="0.01"
            defaultValue={0}
          />
        </div>

        <div>
          <label htmlFor="taxCodeId" className="block text-small font-medium text-charcoal">
            Default tax code
          </label>
          <select
            id="taxCodeId"
            name="taxCodeId"
            defaultValue=""
            className="mt-1.5 block w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
          >
            <option value="">No tax</option>
            {taxCodes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.code} — {t.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      {itemType === "product" && (
        <section className="space-y-4">
          <SectionTitle>Stock</SectionTitle>
          <Field
            label="Reorder point"
            name="reorderPoint"
            type="number"
            min={0}
            hint="Alert when stock drops below this quantity"
          />
        </section>
      )}

      {itemType === "bundle" && (
        <section className="space-y-4">
          <SectionTitle>Components</SectionTitle>
          <p className="text-caption text-text-tertiary">
            Each unit of this bundle consumes the listed quantities from its
            components&rsquo; stock at invoice post time. Weighted-average cost
            rolls up into COGS.
          </p>
          <div className="space-y-2">
            {components.length === 0 ? (
              <div className="rounded-md border-hairline border-amber-400/50 bg-amber-50/60 p-3 text-small text-amber-900 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-none" aria-hidden />
                <span>
                  No components yet. Selling an empty bundle books revenue
                  with zero COGS — add components below, or leave empty if
                  that&rsquo;s intentional (e.g. hand-assembled placeholder).
                </span>
              </div>
            ) : (
              components.map((row) => (
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
                        updateComponentRow(row.key, {
                          componentItemId: e.target.value,
                        })
                      }
                      className="mt-1 block w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
                    >
                      <option value="">Choose an item…</option>
                      {componentCandidates.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                          {i.sku ? ` · ${i.sku}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-caption text-text-tertiary">
                      Qty
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.quantity}
                      onChange={(e) =>
                        updateComponentRow(row.key, { quantity: e.target.value })
                      }
                      className="mt-1 block w-24 rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeComponentRow(row.key)}
                    className="mb-1 rounded-md border-hairline border-border px-2 py-2 text-text-tertiary hover:border-danger hover:text-danger"
                    aria-label="Remove component"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              ))
            )}
          </div>
          <button
            type="button"
            onClick={addComponentRow}
            className="inline-flex items-center gap-2 rounded-md border-hairline border-border px-3 py-2 text-small text-charcoal hover:border-charcoal"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add component
          </button>
        </section>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-3 text-small text-danger"
        >
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Saving…
            </>
          ) : (
            "Create item"
          )}
        </button>
      </div>
    </form>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-caption font-medium uppercase tracking-wide text-text-tertiary">
      {children}
    </h3>
  );
}
