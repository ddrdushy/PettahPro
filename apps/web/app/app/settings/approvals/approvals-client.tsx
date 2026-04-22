"use client";

import { useState } from "react";
import { Trash2, Plus, X, AlertTriangle } from "lucide-react";
import {
  api,
  ApiError,
  type ApprovalPolicy,
  type ApprovalDocumentType,
  type ApprovalStep,
  type ApprovalStepApprover,
  type AppRole,
  type UserWithRoles,
} from "@/lib/api";

const DOC_TYPES: Array<{ value: ApprovalDocumentType; label: string; hint: string }> = [
  { value: "journal_entry",   label: "Journal entries",   hint: "Manual journals posted from the accounting module" },
  { value: "expense_claim",   label: "Expense claims",    hint: "Employee expense reimbursements" },
  { value: "leave_request",   label: "Leave requests",    hint: "HR leave applications" },
  { value: "bill",            label: "Supplier bills",    hint: "AP bills before posting" },
  { value: "purchase_order",  label: "Purchase orders",   hint: "Issued POs before sending to supplier" },
  { value: "invoice",         label: "Customer invoices", hint: "AR invoices before posting" },
];

interface Draft {
  name: string;
  description: string;
  documentType: ApprovalDocumentType;
  triggerMinRupees: string; // string to allow empty
  isActive: boolean;
  steps: ApprovalStep[];
}

function blankDraft(): Draft {
  return {
    name: "",
    description: "",
    documentType: "journal_entry",
    triggerMinRupees: "",
    isActive: true,
    steps: [{ approvers: [], anyOf: true }],
  };
}

function policyToDraft(p: ApprovalPolicy): Draft {
  return {
    name: p.name,
    description: p.description ?? "",
    documentType: p.documentType,
    triggerMinRupees:
      p.triggerRule.minAmountCents !== undefined
        ? (p.triggerRule.minAmountCents / 100).toFixed(2)
        : "",
    isActive: p.isActive,
    steps: p.steps.length > 0 ? p.steps : [{ approvers: [], anyOf: true }],
  };
}

export function ApprovalsClient({
  initialPolicies,
  roles,
  users,
}: {
  initialPolicies: ApprovalPolicy[];
  roles: AppRole[];
  users: UserWithRoles[];
}) {
  const [policies, setPolicies] = useState(initialPolicies);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const editing = policies.find((p) => p.id === editingId) ?? null;

  function startEdit(p: ApprovalPolicy) {
    setEditingId(p.id);
    setDraft(policyToDraft(p));
    setCreating(false);
    setError(null);
  }

  function startCreate() {
    setEditingId(null);
    setDraft(blankDraft());
    setCreating(true);
    setError(null);
  }

  function addStep() {
    setDraft((d) => ({ ...d, steps: [...d.steps, { approvers: [], anyOf: true }] }));
  }

  function removeStep(idx: number) {
    setDraft((d) => ({ ...d, steps: d.steps.filter((_, i) => i !== idx) }));
  }

  function addApprover(stepIdx: number, approver: ApprovalStepApprover) {
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, i) =>
        i === stepIdx && !s.approvers.some((a) => a.kind === approver.kind && a.id === approver.id)
          ? { ...s, approvers: [...s.approvers, approver] }
          : s,
      ),
    }));
  }

  function removeApprover(stepIdx: number, idx: number) {
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, i) =>
        i === stepIdx ? { ...s, approvers: s.approvers.filter((_, j) => j !== idx) } : s,
      ),
    }));
  }

  function toggleAnyOf(stepIdx: number) {
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, i) => (i === stepIdx ? { ...s, anyOf: !s.anyOf } : s)),
    }));
  }

  function buildPayload() {
    const trigger: { minAmountCents?: number } = {};
    const rupees = draft.triggerMinRupees.trim();
    if (rupees !== "") {
      const n = Number(rupees.replace(/,/g, ""));
      if (Number.isFinite(n) && n >= 0) trigger.minAmountCents = Math.round(n * 100);
    }
    return {
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      documentType: draft.documentType,
      triggerRule: trigger,
      steps: draft.steps,
      isActive: draft.isActive,
    };
  }

  async function save() {
    setError(null);
    const payload = buildPayload();
    if (!payload.name) {
      setError("Name is required.");
      return;
    }
    if (payload.steps.some((s) => s.approvers.length === 0)) {
      setError("Every step needs at least one approver.");
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        const { policy } = await api.updateApprovalPolicy(editing.id, payload);
        setPolicies((ps) => ps.map((x) => (x.id === policy.id ? policy : x)));
      } else {
        const { policy } = await api.createApprovalPolicy(payload);
        setPolicies((ps) => [policy, ...ps]);
        setCreating(false);
        setEditingId(policy.id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save policy.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: ApprovalPolicy) {
    if (!confirm(`Delete approval policy "${p.name}"?`)) return;
    try {
      await api.deleteApprovalPolicy(p.id);
      setPolicies((ps) => ps.filter((x) => x.id !== p.id));
      if (editingId === p.id) setEditingId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete policy.");
    }
  }

  return (
    <div className="mt-8 space-y-6">
      <div className="flex items-start gap-2 rounded-card border-hairline border-amber-400/40 bg-amber-50/60 p-4 text-small text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
        <p>
          Designer preview: policies are stored and visible here, but the engine that routes
          documents through them isn't wired into posting flows yet. Existing per-domain approval
          gates (e.g. journal entry amount threshold in tenant settings) continue to work as before.
        </p>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-caption text-red-700">{error}</p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        {/* Policy list */}
        <section className="rounded-card border-hairline border-border bg-surface-elevated">
          <header className="flex items-center justify-between border-b-hairline border-border px-6 py-4">
            <div>
              <h2 className="text-body font-medium text-charcoal">Policies</h2>
              <p className="text-caption text-text-tertiary">{policies.length} total</p>
            </div>
            <button type="button" onClick={startCreate} className="btn-secondary text-small">
              <Plus className="h-4 w-4" aria-hidden /> New
            </button>
          </header>
          <ul className="divide-y-hairline divide-border">
            {policies.length === 0 && !creating ? (
              <li className="px-6 py-8 text-center text-small text-text-secondary">
                No policies yet.
              </li>
            ) : (
              policies.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => startEdit(p)}
                    className={`flex w-full items-center justify-between px-6 py-3 text-left hover:bg-surface-recessed/40 ${
                      editingId === p.id ? "bg-mint-surface/30" : ""
                    }`}
                  >
                    <div>
                      <p className="text-small font-medium text-charcoal">{p.name}</p>
                      <p className="text-caption text-text-tertiary">
                        {DOC_TYPES.find((d) => d.value === p.documentType)?.label ?? p.documentType}
                        {" · "}
                        {p.steps.length} step{p.steps.length === 1 ? "" : "s"}
                        {!p.isActive && " · inactive"}
                      </p>
                    </div>
                    <span
                      role="button"
                      aria-label={`Delete ${p.name}`}
                      className="text-text-tertiary hover:text-red-700"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(p);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </section>

        {/* Editor */}
        <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
          {!editing && !creating ? (
            <p className="text-small text-text-secondary">
              Pick a policy to edit, or create a new one.
            </p>
          ) : (
            <>
              <h2 className="text-h3 text-charcoal">{editing ? editing.name : "New policy"}</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="block text-small sm:col-span-2">
                  <span className="mb-1 block text-caption text-text-secondary">Name</span>
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    className="w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-body text-charcoal"
                    maxLength={128}
                  />
                </label>
                <label className="block text-small">
                  <span className="mb-1 block text-caption text-text-secondary">Document type</span>
                  <select
                    value={draft.documentType}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, documentType: e.target.value as ApprovalDocumentType }))
                    }
                    className="w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-body text-charcoal"
                  >
                    {DOC_TYPES.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-caption text-text-tertiary">
                    {DOC_TYPES.find((d) => d.value === draft.documentType)?.hint}
                  </p>
                </label>
                <label className="block text-small">
                  <span className="mb-1 block text-caption text-text-secondary">
                    Trigger ≥ amount (LKR, optional)
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draft.triggerMinRupees}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, triggerMinRupees: e.target.value }))
                    }
                    placeholder="e.g. 50000 — leave blank to trigger on every document"
                    className="w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-body text-charcoal"
                  />
                </label>
                <label className="block text-small sm:col-span-2">
                  <span className="mb-1 block text-caption text-text-secondary">Description (optional)</span>
                  <textarea
                    value={draft.description}
                    onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                    rows={2}
                    className="w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-body text-charcoal"
                  />
                </label>
                <label className="flex items-center gap-2 text-small">
                  <input
                    type="checkbox"
                    checked={draft.isActive}
                    onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
                    className="h-4 w-4"
                  />
                  <span className="text-charcoal">Active</span>
                </label>
              </div>

              <div className="mt-6">
                <div className="flex items-center justify-between">
                  <p className="text-body font-medium text-charcoal">Approval chain</p>
                  <button type="button" onClick={addStep} className="btn-secondary text-small">
                    <Plus className="h-4 w-4" aria-hidden /> Add step
                  </button>
                </div>
                <ol className="mt-3 space-y-3">
                  {draft.steps.map((step, idx) => (
                    <li
                      key={idx}
                      className="rounded-md border-hairline border-border bg-surface-recessed/30 p-4"
                    >
                      <div className="flex items-start justify-between">
                        <p className="text-small font-medium text-charcoal">Step {idx + 1}</p>
                        {draft.steps.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeStep(idx)}
                            className="text-text-tertiary hover:text-red-700"
                            aria-label={`Remove step ${idx + 1}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        {step.approvers.length === 0 ? (
                          <span className="text-caption text-text-tertiary">No approvers yet.</span>
                        ) : (
                          step.approvers.map((a, j) => {
                            const label =
                              a.kind === "role"
                                ? roles.find((r) => r.id === a.id)?.name ?? a.label ?? a.id
                                : users.find((u) => u.id === a.id)?.fullName ??
                                  users.find((u) => u.id === a.id)?.email ??
                                  a.label ??
                                  a.id;
                            return (
                              <span
                                key={`${a.kind}-${a.id}-${j}`}
                                className="inline-flex items-center gap-1 rounded-full bg-surface-elevated px-2 py-0.5 text-caption text-charcoal"
                              >
                                <span className="text-text-tertiary">{a.kind === "role" ? "Role" : "User"}:</span>
                                {label}
                                <button
                                  type="button"
                                  onClick={() => removeApprover(idx, j)}
                                  className="text-text-tertiary hover:text-red-700"
                                  aria-label="Remove approver"
                                >
                                  <X className="h-3 w-3" aria-hidden />
                                </button>
                              </span>
                            );
                          })
                        )}
                      </div>

                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) {
                              const role = roles.find((r) => r.id === e.target.value);
                              if (role) addApprover(idx, { kind: "role", id: role.id, label: role.name });
                            }
                            e.currentTarget.value = "";
                          }}
                          className="rounded-md border-hairline border-border-emphasis bg-surface-elevated px-2 py-1.5 text-small text-charcoal"
                        >
                          <option value="">Add role approver…</option>
                          {roles.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) {
                              const u = users.find((x) => x.id === e.target.value);
                              if (u) addApprover(idx, { kind: "user", id: u.id, label: u.fullName ?? u.email });
                            }
                            e.currentTarget.value = "";
                          }}
                          className="rounded-md border-hairline border-border-emphasis bg-surface-elevated px-2 py-1.5 text-small text-charcoal"
                        >
                          <option value="">Add user approver…</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.fullName ?? u.email}
                            </option>
                          ))}
                        </select>
                      </div>

                      <label className="mt-3 flex items-center gap-2 text-small">
                        <input
                          type="checkbox"
                          checked={step.anyOf}
                          onChange={() => toggleAnyOf(idx)}
                          className="h-4 w-4"
                        />
                        <span className="text-charcoal">
                          Any one approver is enough
                          <span className="ml-1 text-text-tertiary">
                            (unchecked = all must approve)
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setCreating(false);
                  }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button type="button" onClick={save} disabled={busy} className="btn-primary disabled:opacity-50">
                  {editing ? "Save changes" : "Create policy"}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
