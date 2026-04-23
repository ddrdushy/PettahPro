"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import {
  api,
  ApiError,
  type Account,
  type CreateItemCategory,
  type ItemCategory,
  type ItemCategoryNode,
  type TaxCode,
} from "@/lib/api";

/**
 * Create + edit form for inventory categories (roadmap #36).
 *
 * A null on any default field is semantically "inherit from ancestor",
 * so we use a three-way select: "Inherit" / explicit value / (for
 * reorder point) a cleared number input. Submitting an explicit null
 * means the tenant is overriding the ancestor with "none at this level".
 *
 * We don't allow picking the node itself (or any of its descendants)
 * as a parent — that would trip the DB cycle trigger. The descendant
 * filter happens in `categories-client.tsx` before this form renders.
 */
export function CategoryForm({
  mode,
  initial,
  parentOptions,
  taxCodes,
  accounts,
  onSaved,
  onCancel,
}: {
  mode: "create" | "edit";
  initial?: ItemCategoryNode;
  /** Already filtered to exclude self + descendants in edit mode. */
  parentOptions: ItemCategoryNode[];
  taxCodes: TaxCode[];
  accounts: Account[];
  onSaved: (c: ItemCategory) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? "");
  const [parentId, setParentId] = useState<string>(initial?.parentId ?? "");
  const [codePrefix, setCodePrefix] = useState(initial?.codePrefix ?? "");
  const [valuation, setValuation] = useState<string>(
    initial?.defaultValuationMethod ?? "",
  );
  const [taxCodeId, setTaxCodeId] = useState<string>(
    initial?.defaultTaxCodeId ?? "",
  );
  const [incomeAccountId, setIncomeAccountId] = useState<string>(
    initial?.defaultIncomeAccountId ?? "",
  );
  const [expenseAccountId, setExpenseAccountId] = useState<string>(
    initial?.defaultExpenseAccountId ?? "",
  );
  const [assetAccountId, setAssetAccountId] = useState<string>(
    initial?.defaultAssetAccountId ?? "",
  );
  const [reorderPoint, setReorderPoint] = useState<string>(
    initial?.defaultReorderPoint != null ? String(initial.defaultReorderPoint) : "",
  );

  const incomeAccounts = accounts
    .filter((a) => a.isActive && a.accountType === "income")
    .sort((a, b) => a.code.localeCompare(b.code));
  const expenseAccounts = accounts
    .filter((a) => a.isActive && a.accountType === "expense")
    .sort((a, b) => a.code.localeCompare(b.code));
  const assetAccounts = accounts
    .filter((a) => a.isActive && a.accountType === "asset")
    .sort((a, b) => a.code.localeCompare(b.code));

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      setBusy(false);
      return;
    }

    const body: CreateItemCategory = {
      name: trimmed,
      parentId: parentId || null,
      codePrefix: codePrefix.trim() || null,
      defaultValuationMethod:
        valuation === ""
          ? null
          : (valuation as "fifo" | "weighted_avg" | "standard" | "specific"),
      defaultTaxCodeId: taxCodeId || null,
      defaultIncomeAccountId: incomeAccountId || null,
      defaultExpenseAccountId: expenseAccountId || null,
      defaultAssetAccountId: assetAccountId || null,
      defaultReorderPoint:
        reorderPoint.trim() === "" ? null : Math.max(0, Math.round(Number(reorderPoint))),
    };

    try {
      const res =
        mode === "create"
          ? await api.createItemCategory(body)
          : await api.updateItemCategory(initial!.id, body);
      onSaved(res.category);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.code === "DUPLICATE_NAME"
            ? "Another category at this level already uses that name."
            : err.code === "CYCLE"
              ? "Can't move a category into its own descendant."
              : err.code === "MAX_DEPTH"
                ? "Category hierarchy is too deep."
                : err.code === "INVALID_PARENT"
                  ? "Parent category not found."
                  : err.message
          : "Couldn't save the category. Try again.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <section className="space-y-4">
        <SectionTitle>Identity</SectionTitle>
        <div>
          <label htmlFor="cat-name" className="block text-small font-medium text-charcoal">
            Name
          </label>
          <input
            id="cat-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Cotton shirting"
            required
            maxLength={128}
            className="input mt-1.5"
          />
        </div>

        <div>
          <label htmlFor="cat-parent" className="block text-small font-medium text-charcoal">
            Parent
          </label>
          <select
            id="cat-parent"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="input mt-1.5"
          >
            <option value="">— Top level —</option>
            {parentOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {"\u00A0\u00A0".repeat(p.depth)}
                {p.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-caption text-text-tertiary">
            Leave at top level for a root category.
          </p>
        </div>

        <div>
          <label htmlFor="cat-code" className="block text-small font-medium text-charcoal">
            SKU prefix
          </label>
          <input
            id="cat-code"
            value={codePrefix}
            onChange={(e) => setCodePrefix(e.target.value)}
            placeholder="COT"
            maxLength={16}
            className="input mt-1.5"
          />
          <p className="mt-1 text-caption text-text-tertiary">
            Optional — shown as a hint when creating items in this category.
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <SectionTitle>Inherited defaults</SectionTitle>
        <p className="text-caption text-text-tertiary">
          Leave blank to inherit from an ancestor category. Items in this
          category use these values unless overridden on the item itself.
        </p>

        <div>
          <label
            htmlFor="cat-valuation"
            className="block text-small font-medium text-charcoal"
          >
            Valuation method
          </label>
          <select
            id="cat-valuation"
            value={valuation}
            onChange={(e) => setValuation(e.target.value)}
            className="input mt-1.5"
          >
            <option value="">Inherit</option>
            <option value="fifo">FIFO</option>
            <option value="weighted_avg">Weighted average</option>
            <option value="standard">Standard cost</option>
            <option value="specific">Specific identification</option>
          </select>
        </div>

        <div>
          <label htmlFor="cat-tax" className="block text-small font-medium text-charcoal">
            Default tax code
          </label>
          <select
            id="cat-tax"
            value={taxCodeId}
            onChange={(e) => setTaxCodeId(e.target.value)}
            className="input mt-1.5"
          >
            <option value="">Inherit</option>
            {taxCodes
              .filter((t) => t.isActive)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code} — {t.name}
                </option>
              ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="cat-income"
            className="block text-small font-medium text-charcoal"
          >
            Income account
          </label>
          <select
            id="cat-income"
            value={incomeAccountId}
            onChange={(e) => setIncomeAccountId(e.target.value)}
            className="input mt-1.5"
          >
            <option value="">Inherit</option>
            {incomeAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="cat-expense"
            className="block text-small font-medium text-charcoal"
          >
            COGS / expense account
          </label>
          <select
            id="cat-expense"
            value={expenseAccountId}
            onChange={(e) => setExpenseAccountId(e.target.value)}
            className="input mt-1.5"
          >
            <option value="">Inherit</option>
            {expenseAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="cat-asset"
            className="block text-small font-medium text-charcoal"
          >
            Inventory asset account
          </label>
          <select
            id="cat-asset"
            value={assetAccountId}
            onChange={(e) => setAssetAccountId(e.target.value)}
            className="input mt-1.5"
          >
            <option value="">Inherit</option>
            {assetAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="cat-reorder"
            className="block text-small font-medium text-charcoal"
          >
            Default reorder point
          </label>
          <input
            id="cat-reorder"
            type="number"
            min={0}
            value={reorderPoint}
            onChange={(e) => setReorderPoint(e.target.value)}
            placeholder="Inherit"
            className="input mt-1.5 tabular-nums"
          />
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className="rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-3 text-small text-danger"
        >
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border-hairline border-border bg-surface-elevated px-4 py-2 text-small text-charcoal hover:border-charcoal"
        >
          Cancel
        </button>
        <button type="submit" disabled={busy} className="btn-primary disabled:opacity-50">
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Saving…
            </>
          ) : mode === "create" ? (
            "Create category"
          ) : (
            "Save changes"
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
