"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderTree,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Drawer } from "@/components/app/drawer";
import {
  api,
  ApiError,
  type Account,
  type ItemCategory,
  type ItemCategoryNode,
  type TaxCode,
} from "@/lib/api";
import { CategoryForm } from "./category-form";

/**
 * Inventory category hierarchy (roadmap #36).
 *
 * The API returns a flat list in depth-first order with `depth` +
 * `path` + `itemCount`. We keep it flat in state — converting to a
 * nested shape is overkill when rendering is indentation-based. On
 * mutate, we refetch the whole tree so depth/path/counts stay
 * consistent (reparenting a node changes both its and its
 * descendants' path strings).
 */
export function CategoriesClient({
  categories: initial,
  taxCodes,
  accounts,
}: {
  categories: ItemCategoryNode[];
  taxCodes: TaxCode[];
  accounts: Account[];
}) {
  const [categories, setCategories] = useState<ItemCategoryNode[]>(initial);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drawerMode, setDrawerMode] = useState<"closed" | "create" | "edit">(
    "closed",
  );
  const [editing, setEditing] = useState<ItemCategoryNode | null>(null);
  const [createParent, setCreateParent] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ItemCategoryNode | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const childrenOf = useMemo(() => {
    const m = new Map<string | null, ItemCategoryNode[]>();
    for (const c of categories) {
      const key = c.parentId;
      const arr = m.get(key) ?? [];
      arr.push(c);
      m.set(key, arr);
    }
    return m;
  }, [categories]);

  // A node is hidden if any ancestor is collapsed.
  const visibleIds = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    const hidden = new Set<string>();
    for (const c of categories) {
      let p = c.parentId;
      while (p) {
        if (collapsed.has(p)) {
          hidden.add(c.id);
          break;
        }
        p = byId.get(p)?.parentId ?? null;
      }
    }
    return new Set(categories.filter((c) => !hidden.has(c.id)).map((c) => c.id));
  }, [categories, collapsed]);

  function refresh() {
    api
      .listItemCategories()
      .then((res) => setCategories(res.categories))
      .catch(() => {
        /* stale list is better than nothing */
      });
  }

  function descendantIds(nodeId: string): Set<string> {
    const set = new Set<string>([nodeId]);
    const stack = [nodeId];
    while (stack.length) {
      const id = stack.pop()!;
      for (const child of childrenOf.get(id) ?? []) {
        if (!set.has(child.id)) {
          set.add(child.id);
          stack.push(child.id);
        }
      }
    }
    return set;
  }

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openCreate(parentId: string | null) {
    setCreateParent(parentId);
    setEditing(null);
    setDrawerMode("create");
  }

  function openEdit(c: ItemCategoryNode) {
    setEditing(c);
    setDrawerMode("edit");
  }

  function onSaved(_saved: ItemCategory) {
    setDrawerMode("closed");
    setEditing(null);
    setCreateParent(null);
    refresh();
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api.deleteItemCategory(deleting.id);
      setDeleting(null);
      refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setDeleteError(err.message);
      } else {
        setDeleteError("Couldn't delete the category.");
      }
    } finally {
      setDeleteBusy(false);
    }
  }

  // Build parent options for the form: exclude self + descendants in
  // edit mode, pass everything in create mode, and seed the initial
  // parentId for new-child flow via the initial prop.
  const parentOptions = useMemo(() => {
    if (drawerMode === "edit" && editing) {
      const excluded = descendantIds(editing.id);
      return categories.filter((c) => !excluded.has(c.id));
    }
    return categories;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerMode, editing, categories]);

  const formInitial = useMemo<ItemCategoryNode | undefined>(() => {
    if (drawerMode === "edit") return editing ?? undefined;
    if (drawerMode === "create" && createParent) {
      const p = categories.find((c) => c.id === createParent);
      if (!p) return undefined;
      return {
        id: "",
        parentId: createParent,
        name: "",
        codePrefix: null,
        defaultValuationMethod: null,
        defaultTaxCodeId: null,
        defaultIncomeAccountId: null,
        defaultExpenseAccountId: null,
        defaultAssetAccountId: null,
        defaultReorderPoint: null,
        sortOrder: 0,
        isActive: true,
        depth: p.depth + 1,
        path: "",
        itemCount: 0,
      };
    }
    return undefined;
  }, [drawerMode, editing, createParent, categories]);

  const visible = categories.filter((c) => visibleIds.has(c.id));

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Stock"
        title="Item categories"
        description="Group items into a hierarchy for reporting and to inherit defaults — valuation method, tax code, GL accounts, reorder point. Children override parents; items override everything."
        action={
          <button
            type="button"
            onClick={() => openCreate(null)}
            className="btn-primary"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New root category
          </button>
        }
      />

      {categories.length === 0 ? (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
            <FolderTree className="h-5 w-5" />
          </div>
          <p className="text-body text-charcoal">No categories yet.</p>
          <p className="mt-1 text-small text-text-secondary">
            Add a root category to start organising items.
          </p>
          <button
            type="button"
            onClick={() => openCreate(null)}
            className="btn-primary mt-4"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New root category
          </button>
        </div>
      ) : (
        <section className="mt-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="w-28 px-4 py-3 text-left">SKU prefix</th>
                <th className="w-24 px-4 py-3 text-right">Items</th>
                <th className="w-44 px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {visible.map((c) => {
                const hasChildren = (childrenOf.get(c.id) ?? []).length > 0;
                const isCollapsed = collapsed.has(c.id);
                return (
                  <tr key={c.id}>
                    <td className="px-4 py-3">
                      <div
                        className="flex items-center gap-1"
                        style={{ paddingLeft: `${c.depth * 20}px` }}
                      >
                        {hasChildren ? (
                          <button
                            type="button"
                            onClick={() => toggle(c.id)}
                            aria-label={isCollapsed ? "Expand" : "Collapse"}
                            className="grid h-5 w-5 place-items-center rounded-sm text-text-secondary hover:bg-mint-surface hover:text-charcoal"
                          >
                            {isCollapsed ? (
                              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                            )}
                          </button>
                        ) : (
                          <span className="inline-block h-5 w-5" aria-hidden />
                        )}
                        <span className="font-medium text-charcoal">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-text-secondary">
                      {c.codePrefix ?? <span className="text-text-tertiary">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                      {c.itemCount}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openCreate(c.id)}
                          title="Add subcategory"
                          aria-label={`Add subcategory under ${c.name}`}
                          className="grid h-8 w-8 place-items-center rounded-md text-text-secondary transition-colors hover:bg-mint-surface hover:text-charcoal"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(c)}
                          title="Edit"
                          aria-label={`Edit ${c.name}`}
                          className="grid h-8 w-8 place-items-center rounded-md text-text-secondary transition-colors hover:bg-mint-surface hover:text-charcoal"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleting(c);
                            setDeleteError(null);
                          }}
                          title="Delete"
                          aria-label={`Delete ${c.name}`}
                          className="grid h-8 w-8 place-items-center rounded-md text-text-secondary transition-colors hover:bg-danger-bg hover:text-danger"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <Drawer
        open={drawerMode !== "closed"}
        onClose={() => {
          setDrawerMode("closed");
          setEditing(null);
          setCreateParent(null);
        }}
        title={drawerMode === "edit" ? "Edit category" : "New category"}
        description={
          drawerMode === "edit"
            ? editing?.path
            : createParent
              ? `Under ${categories.find((c) => c.id === createParent)?.path ?? ""}`
              : "Top-level category"
        }
      >
        {drawerMode !== "closed" && (
          <CategoryForm
            mode={drawerMode}
            initial={formInitial}
            parentOptions={parentOptions}
            taxCodes={taxCodes}
            accounts={accounts}
            onSaved={onSaved}
            onCancel={() => {
              setDrawerMode("closed");
              setEditing(null);
              setCreateParent(null);
            }}
          />
        )}
      </Drawer>

      {deleting && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-charcoal/30 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-title"
        >
          <div className="w-full max-w-md rounded-card border-hairline border-border bg-offwhite p-6 shadow-xl">
            <h2 id="delete-title" className="text-h2 text-charcoal">
              Delete category?
            </h2>
            <p className="mt-2 text-small text-text-secondary">
              <span className="font-medium text-charcoal">{deleting.path}</span>{" "}
              will be removed. Items already assigned keep their current
              settings and can be reassigned later.
            </p>
            {deleteError && (
              <div
                role="alert"
                className="mt-4 rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-3 text-small text-danger"
              >
                {deleteError}
              </div>
            )}
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setDeleting(null);
                  setDeleteError(null);
                }}
                className="rounded-md border-hairline border-border bg-surface-elevated px-4 py-2 text-small text-charcoal hover:border-charcoal"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleteBusy}
                className="inline-flex items-center gap-2 rounded-md bg-danger px-4 py-2 text-small font-medium text-offwhite hover:bg-danger/90 disabled:opacity-50"
              >
                {deleteBusy && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                )}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
