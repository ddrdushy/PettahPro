"use client";

import { useState } from "react";
import { Trash2, Plus, Lock, X } from "lucide-react";
import { api, ApiError, type AppRole, type UserWithRoles } from "@/lib/api";

// Known permission keys, grouped. Keep aligned with the seeded
// templates in docker/postgres/init/55-tenant-admin.sql. New keys
// added to the app without updating this dictionary still work
// (the role editor preserves arbitrary keys), but won't appear as
// labelled checkboxes.
const PERMISSION_GROUPS: Array<{
  group: string;
  items: Array<{ key: string; label: string }>;
}> = [
  {
    group: "Accounting",
    items: [
      { key: "accounting.manage", label: "Manage chart of accounts, periods, opening balances" },
      { key: "reports.view",       label: "View financial reports" },
    ],
  },
  {
    group: "Sell",
    items: [
      { key: "invoices.create", label: "Create invoices" },
      { key: "invoices.post",   label: "Post invoices to the ledger" },
      { key: "invoices.void",   label: "Void posted invoices" },
    ],
  },
  {
    group: "Buy",
    items: [
      { key: "bills.create", label: "Create bills" },
      { key: "bills.post",   label: "Post bills to the ledger" },
      { key: "bills.void",   label: "Void posted bills" },
    ],
  },
  {
    group: "Money",
    items: [{ key: "payments.manage", label: "Record customer & supplier payments" }],
  },
  {
    group: "Operations",
    items: [
      { key: "inventory.manage", label: "Manage stock and warehouses" },
      { key: "payroll.manage",   label: "Run payroll" },
      { key: "hr.manage",        label: "Manage employees and leave" },
    ],
  },
  {
    group: "Admin",
    items: [
      { key: "settings.manage", label: "Change tenant settings" },
      { key: "users.manage",    label: "Manage users and roles" },
    ],
  },
];

function blankRole(): { name: string; description: string; permissions: Record<string, boolean> } {
  return { name: "", description: "", permissions: {} };
}

export function RolesClient({
  initialRoles,
  initialUsers,
}: {
  initialRoles: AppRole[];
  initialUsers: UserWithRoles[];
}) {
  const [roles, setRoles] = useState(initialRoles);
  const [users, setUsers] = useState(initialUsers);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [draft, setDraft] = useState(blankRole());
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const editing = roles.find((r) => r.id === editingRoleId) ?? null;

  function startEdit(r: AppRole) {
    setEditingRoleId(r.id);
    setDraft({
      name: r.name,
      description: r.description ?? "",
      permissions: { ...r.permissions },
    });
    setShowCreate(false);
    setError(null);
  }

  function startCreate() {
    setEditingRoleId(null);
    setDraft(blankRole());
    setShowCreate(true);
    setError(null);
  }

  function togglePerm(key: string) {
    setDraft((d) => ({ ...d, permissions: { ...d.permissions, [key]: !d.permissions[key] } }));
  }

  async function save() {
    setError(null);
    setBusy(true);
    try {
      if (editing) {
        const { role } = await api.updateRole(editing.id, {
          ...(editing.isSystem ? {} : { name: draft.name.trim(), description: draft.description.trim() || undefined }),
          permissions: draft.permissions,
        });
        setRoles((rs) => rs.map((r) => (r.id === role.id ? role : r)));
      } else {
        if (!draft.name.trim()) {
          setError("Name is required.");
          setBusy(false);
          return;
        }
        const { role } = await api.createRole({
          name: draft.name.trim(),
          description: draft.description.trim() || undefined,
          permissions: draft.permissions,
        });
        setRoles((rs) => [...rs, role].sort((a, b) => (Number(b.isSystem) - Number(a.isSystem)) || a.name.localeCompare(b.name)));
        setShowCreate(false);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "DUPLICATE_NAME") {
        setError("A role with that name already exists.");
      } else {
        setError(err instanceof ApiError ? err.message : "Couldn't save role.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: AppRole) {
    if (r.isSystem) return;
    if (!confirm(`Delete role "${r.name}"? Users assigned to it will lose the permissions.`)) return;
    try {
      await api.deleteRole(r.id);
      setRoles((rs) => rs.filter((x) => x.id !== r.id));
      setUsers((us) =>
        us.map((u) => ({ ...u, roles: u.roles.filter((x) => x.id !== r.id) })),
      );
      if (editingRoleId === r.id) setEditingRoleId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete role.");
    }
  }

  async function assign(userId: string, roleId: string) {
    try {
      await api.assignRole(userId, roleId);
      const role = roles.find((r) => r.id === roleId);
      if (!role) return;
      setUsers((us) =>
        us.map((u) =>
          u.id === userId && !u.roles.some((x) => x.id === roleId)
            ? { ...u, roles: [...u.roles, { id: role.id, name: role.name }].sort((a, b) => a.name.localeCompare(b.name)) }
            : u,
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't assign role.");
    }
  }

  async function unassign(userId: string, roleId: string) {
    try {
      await api.unassignRole(userId, roleId);
      setUsers((us) =>
        us.map((u) => (u.id === userId ? { ...u, roles: u.roles.filter((x) => x.id !== roleId) } : u)),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't unassign role.");
    }
  }

  return (
    <div className="mt-8 space-y-8">
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-caption text-red-700">{error}</p>
      )}

      <section className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">
        {/* Role list */}
        <div className="rounded-card border-hairline border-border bg-surface-elevated">
          <header className="flex items-center justify-between border-b-hairline border-border px-6 py-4">
            <div>
              <h2 className="text-body font-medium text-charcoal">Roles</h2>
              <p className="text-caption text-text-tertiary">{roles.length} total</p>
            </div>
            <button type="button" onClick={startCreate} className="btn-secondary text-small">
              <Plus className="h-4 w-4" aria-hidden /> New role
            </button>
          </header>
          <ul className="divide-y-hairline divide-border">
            {roles.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => startEdit(r)}
                  className={`flex w-full items-center justify-between px-6 py-3 text-left hover:bg-surface-recessed/40 ${
                    editingRoleId === r.id ? "bg-mint-surface/30" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {r.isSystem && <Lock className="h-3 w-3 text-text-tertiary" aria-hidden />}
                    <span className="text-small font-medium text-charcoal">{r.name}</span>
                    <span className="text-caption text-text-tertiary">
                      {Object.values(r.permissions).filter(Boolean).length} perms
                    </span>
                  </div>
                  {!r.isSystem && (
                    <span
                      role="button"
                      aria-label={`Delete ${r.name}`}
                      className="text-text-tertiary hover:text-red-700"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(r);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Editor */}
        <div className="rounded-card border-hairline border-border bg-surface-elevated p-6">
          {!editing && !showCreate ? (
            <p className="text-small text-text-secondary">
              Pick a role to edit, or create a new one.
            </p>
          ) : (
            <>
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-h3 text-charcoal">
                    {editing ? editing.name : "New role"}
                  </h2>
                  {editing?.isSystem && (
                    <p className="mt-1 text-caption text-text-tertiary">
                      Built-in template — name is locked, permissions can be tuned.
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-5 space-y-4">
                {!editing?.isSystem && (
                  <>
                    <label className="block text-small">
                      <span className="mb-1 block text-caption text-text-secondary">Name</span>
                      <input
                        value={draft.name}
                        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                        className="w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-body text-charcoal"
                        maxLength={64}
                      />
                    </label>
                    <label className="block text-small">
                      <span className="mb-1 block text-caption text-text-secondary">Description (optional)</span>
                      <textarea
                        value={draft.description}
                        onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                        rows={2}
                        className="w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-body text-charcoal"
                      />
                    </label>
                  </>
                )}

                <div>
                  <p className="mb-2 text-caption uppercase tracking-wide text-text-tertiary">
                    Permissions
                  </p>
                  <div className="space-y-4">
                    {PERMISSION_GROUPS.map((g) => (
                      <div key={g.group}>
                        <p className="text-small font-medium text-charcoal">{g.group}</p>
                        <ul className="mt-1 space-y-1">
                          {g.items.map((it) => (
                            <li key={it.key}>
                              <label className="flex items-start gap-2 text-small">
                                <input
                                  type="checkbox"
                                  checked={Boolean(draft.permissions[it.key])}
                                  onChange={() => togglePerm(it.key)}
                                  className="mt-0.5 h-4 w-4"
                                />
                                <span>
                                  <span className="text-charcoal">{it.label}</span>{" "}
                                  <code className="text-caption text-text-tertiary">{it.key}</code>
                                </span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingRoleId(null);
                    setShowCreate(false);
                  }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button type="button" onClick={save} disabled={busy} className="btn-primary disabled:opacity-50">
                  {editing ? "Save changes" : "Create role"}
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      {/* User ↔ role matrix */}
      <section className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <header className="border-b-hairline border-border px-6 py-4">
          <h2 className="text-body font-medium text-charcoal">Team members</h2>
          <p className="text-caption text-text-tertiary">
            {users.length} user{users.length === 1 ? "" : "s"}. Owners have full access regardless of role.
          </p>
        </header>
        <table className="w-full text-small">
          <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="px-6 py-3 text-left">User</th>
              <th className="px-6 py-3 text-left">Assigned roles</th>
              <th className="w-56 px-6 py-3 text-left">Add role</th>
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-6 py-4">
                  <p className="font-medium text-charcoal">{u.fullName ?? u.email}</p>
                  <p className="text-caption text-text-tertiary">{u.email}</p>
                  {u.isOwner && (
                    <span className="mt-1 inline-flex rounded-full bg-mint-surface px-2 py-0.5 text-caption font-medium text-mint-dark">
                      Owner
                    </span>
                  )}
                </td>
                <td className="px-6 py-4">
                  {u.roles.length === 0 ? (
                    <span className="text-text-tertiary">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {u.roles.map((r) => (
                        <span
                          key={r.id}
                          className="inline-flex items-center gap-1 rounded-full bg-surface-recessed px-2 py-0.5 text-caption text-charcoal"
                        >
                          {r.name}
                          <button
                            type="button"
                            onClick={() => unassign(u.id, r.id)}
                            aria-label={`Remove ${r.name}`}
                            className="text-text-tertiary hover:text-red-700"
                          >
                            <X className="h-3 w-3" aria-hidden />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4">
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) assign(u.id, e.target.value);
                      e.currentTarget.value = "";
                    }}
                    className="w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-2 py-1.5 text-small text-charcoal"
                  >
                    <option value="">Add role…</option>
                    {roles
                      .filter((r) => !u.roles.some((x) => x.id === r.id))
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
