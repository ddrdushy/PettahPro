"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Field } from "@/components/auth/field";
import {
  api,
  ApiError,
  type Item,
  type ItemCategoryNode,
  type TaxCode,
} from "@/lib/api";

export function ItemForm({
  taxCodes,
  categories = [],
  onCreated,
}: {
  taxCodes: TaxCode[];
  categories?: ItemCategoryNode[];
  onCreated: (i: Item) => void;
}) {
  const [itemType, setItemType] = useState<"product" | "service" | "bundle">("product");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      });
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
