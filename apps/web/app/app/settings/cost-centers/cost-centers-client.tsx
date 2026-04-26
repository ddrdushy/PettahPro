"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, api, type CostCenter } from "@/lib/api";

// Cost-centers settings UI (#129 / gaps B1). Inline create form +
// table list with edit + soft-delete. Deliberately bare — no modal,
// no chip nav. Tenant admins typically set up a handful of these
// once and forget; the picker on the invoice form is where the
// volume happens, and that's a separate component.

interface FormState {
  code: string;
  name: string;
  notes: string;
  isActive: boolean;
}

const EMPTY: FormState = { code: "", name: "", notes: "", isActive: true };

export function CostCentersClient({ initial }: { initial: CostCenter[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function refresh() {
    router.refresh();
    api
      .listCostCenters({ includeArchived: true })
      .then((r) => setItems(r.costCenters))
      .catch(() => {});
  }

  async function onSubmit() {
    setError(null);
    if (form.code.trim().length < 2) {
      setError("Code must be at least 2 characters.");
      return;
    }
    if (form.name.trim().length < 1) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        await api.updateCostCenter(editing, {
          name: form.name.trim(),
          notes: form.notes.trim() || null,
          isActive: form.isActive,
        });
      } else {
        await api.createCostCenter({
          code: form.code.trim().toUpperCase(),
          name: form.name.trim(),
          notes: form.notes.trim() || null,
          isActive: form.isActive,
        });
      }
      setForm(EMPTY);
      setEditing(null);
      refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message || "Save failed."
          : "Network error.",
      );
    } finally {
      setBusy(false);
    }
  }

  function startEdit(c: CostCenter) {
    setEditing(c.id);
    setForm({
      code: c.code,
      name: c.name,
      notes: c.notes ?? "",
      isActive: c.isActive,
    });
    setError(null);
  }

  function cancelEdit() {
    setEditing(null);
    setForm(EMPTY);
    setError(null);
  }

  async function onDelete(c: CostCenter) {
    if (
      !confirm(
        `Archive "${c.name}"? Existing journal lines tagged with this center stay tagged. The center disappears from new pickers.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await api.deleteCostCenter(c.id);
      refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message || "Archive failed."
          : "Network error.",
      );
    }
  }

  const live = items.filter((c) => c.deletedAt === null);
  const archived = items.filter((c) => c.deletedAt !== null);

  return (
    <div className="mt-8 space-y-8">
      {/* Inline create / edit form */}
      <div className="rounded-card border border-border-subtle bg-surface p-5">
        <h2 className="text-h3 text-text-primary">
          {editing ? "Edit cost center" : "Add cost center"}
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="block text-caption uppercase tracking-wide text-text-secondary">
              Code
            </label>
            <input
              type="text"
              value={form.code}
              disabled={editing !== null}
              onChange={(e) =>
                setForm({ ...form, code: e.target.value.toUpperCase() })
              }
              placeholder="PETTAH"
              className="mt-1 w-full rounded-md border border-border-subtle bg-bg-base px-3 py-2 text-body text-text-primary uppercase disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-caption uppercase tracking-wide text-text-secondary">
              Name
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Pettah branch"
              className="mt-1 w-full rounded-md border border-border-subtle bg-bg-base px-3 py-2 text-body text-text-primary"
            />
          </div>
          <div>
            <label className="block text-caption uppercase tracking-wide text-text-secondary">
              Notes (optional)
            </label>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="mt-1 w-full rounded-md border border-border-subtle bg-bg-base px-3 py-2 text-body text-text-primary"
            />
          </div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-small text-text-secondary">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
          Active (shown in invoice pickers)
        </label>

        {error && (
          <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-small text-red-700">
            {error}
          </div>
        )}

        <div className="mt-4 flex gap-2">
          {editing && (
            <button
              type="button"
              onClick={cancelEdit}
              className="btn-secondary text-small"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy}
            className="btn-primary text-small disabled:opacity-50"
          >
            {busy
              ? "Saving…"
              : editing
                ? "Save changes"
                : "Add cost center"}
          </button>
        </div>
      </div>

      {/* List */}
      <div>
        <h2 className="text-h3 text-text-primary">Active</h2>
        {live.length === 0 ? (
          <p className="mt-3 text-small text-text-secondary">
            No cost centers yet. Add one above.
          </p>
        ) : (
          <div className="mt-3 overflow-hidden rounded-card border border-border-subtle bg-surface">
            <table className="w-full text-small">
              <thead className="bg-surface-2 text-caption uppercase tracking-wide text-text-secondary">
                <tr>
                  <th className="px-4 py-2 text-left">Code</th>
                  <th className="px-4 py-2 text-left">Name</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {live.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3 font-mono text-text-primary">
                      {c.code}
                    </td>
                    <td className="px-4 py-3 text-text-primary">
                      {c.name}
                      {c.notes && (
                        <p className="mt-1 text-caption text-text-secondary">
                          {c.notes}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {c.isActive ? (
                        <span className="rounded-full bg-mint-surface px-2 py-0.5 text-caption text-text-primary">
                          Active
                        </span>
                      ) : (
                        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-caption text-text-secondary">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(c)}
                          className="text-caption text-text-secondary hover:text-text-primary"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(c)}
                          className="text-caption text-amber-700 hover:text-amber-900"
                        >
                          Archive
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {archived.length > 0 && (
        <div>
          <h2 className="text-h3 text-text-secondary">Archived</h2>
          <div className="mt-3 overflow-hidden rounded-card border border-border-subtle bg-surface opacity-60">
            <table className="w-full text-small">
              <tbody className="divide-y divide-border-subtle">
                {archived.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3 font-mono text-text-secondary">
                      {c.code}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{c.name}</td>
                    <td className="px-4 py-3 text-caption text-text-secondary">
                      Archived — historical journal lines stay tagged
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
