"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  PlatformApiError,
  platformApi,
  type PlatformPlan,
  type PlatformPlanCreateInput,
  type PlatformPlanUpdateInput,
} from "@/lib/platform-api";

// Plan editor — closes the "read-only catalogue" todo from #61. Super-
// admin only; the role gate is on the server, but we also hide the
// mutation buttons for non-super-admin roles since seeing them disabled
// is more confusing than not seeing them at all.

const KNOWN_FEATURES: string[] = [
  // Core modules
  "sell",
  "buy",
  "inventory",
  "vat_wht",
  "cheque_lifecycle",
  // Tier-gated capabilities
  "payroll",
  "ai_bill_entry",
  "supplier_portal",
  "approval_workflows",
  // Support tiers
  "email_support",
  "priority_support",
  "phone_support",
  "dedicated_csm",
];

interface FormState {
  code: string;
  name: string;
  tagline: string;
  monthlyPriceLkr: string; // user-entered LKR major; converted to cents on save
  yearlyPriceLkr: string;
  currency: string;
  maxUsers: { unlimited: boolean; value: string };
  maxInvoicesMonthly: { unlimited: boolean; value: string };
  maxBranches: { unlimited: boolean; value: string };
  maxWarehouses: { unlimited: boolean; value: string };
  features: string[];
  isPublic: boolean;
  sortOrder: string;
}

const EMPTY_FORM: FormState = {
  code: "",
  name: "",
  tagline: "",
  monthlyPriceLkr: "",
  yearlyPriceLkr: "",
  currency: "LKR",
  maxUsers: { unlimited: true, value: "" },
  maxInvoicesMonthly: { unlimited: true, value: "" },
  maxBranches: { unlimited: true, value: "" },
  maxWarehouses: { unlimited: true, value: "" },
  features: [],
  isPublic: true,
  sortOrder: "0",
};

function planToForm(p: PlatformPlan): FormState {
  const cap = (n: number | null) => ({
    unlimited: n === null,
    value: n === null ? "" : String(n),
  });
  return {
    code: p.code,
    name: p.name,
    tagline: p.tagline,
    monthlyPriceLkr: (p.monthlyPriceCents / 100).toString(),
    yearlyPriceLkr: (p.yearlyPriceCents / 100).toString(),
    currency: p.currency,
    maxUsers: cap(p.maxUsers),
    maxInvoicesMonthly: cap(p.maxInvoicesMonthly),
    maxBranches: cap(p.maxBranches),
    maxWarehouses: cap(p.maxWarehouses),
    features: p.features,
    isPublic: p.isPublic,
    sortOrder: String(p.sortOrder),
  };
}

function formToCreatePayload(f: FormState): PlatformPlanCreateInput | string {
  const monthly = Math.round(parseFloat(f.monthlyPriceLkr) * 100);
  const yearly = Math.round(parseFloat(f.yearlyPriceLkr) * 100);
  if (!Number.isFinite(monthly) || monthly < 0) {
    return "Monthly price must be a non-negative number.";
  }
  if (!Number.isFinite(yearly) || yearly < 0) {
    return "Yearly price must be a non-negative number.";
  }
  const sortOrder = parseInt(f.sortOrder || "0", 10);
  if (!Number.isFinite(sortOrder)) {
    return "Sort order must be an integer.";
  }
  const cap = (
    c: { unlimited: boolean; value: string },
    label: string,
  ): number | null | string => {
    if (c.unlimited) return null;
    const n = parseInt(c.value, 10);
    if (!Number.isFinite(n) || n < 0) return `${label} must be a non-negative integer or unlimited.`;
    return n;
  };
  const users = cap(f.maxUsers, "Max users");
  if (typeof users === "string") return users;
  const invoices = cap(f.maxInvoicesMonthly, "Max invoices/mo");
  if (typeof invoices === "string") return invoices;
  const branches = cap(f.maxBranches, "Max branches");
  if (typeof branches === "string") return branches;
  const warehouses = cap(f.maxWarehouses, "Max warehouses");
  if (typeof warehouses === "string") return warehouses;

  return {
    code: f.code,
    name: f.name,
    tagline: f.tagline,
    monthlyPriceCents: monthly,
    yearlyPriceCents: yearly,
    currency: f.currency,
    maxUsers: users,
    maxInvoicesMonthly: invoices,
    maxBranches: branches,
    maxWarehouses: warehouses,
    features: f.features,
    isPublic: f.isPublic,
    sortOrder,
  };
}

function formatMoney(cents: number, currency: string): string {
  const major = cents / 100;
  return `${currency} ${major.toLocaleString("en-LK", {
    maximumFractionDigits: currency === "LKR" ? 0 : 2,
  })}`;
}

function formatLimit(n: number | null): string {
  return n == null ? "Unlimited" : n.toLocaleString();
}

export function PlansClient({
  initialPlans,
  canEdit,
}: {
  initialPlans: PlatformPlan[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [plans, setPlans] = useState<PlatformPlan[]>(initialPlans);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<
    { mode: "create" } | { mode: "edit"; planId: string } | null
  >(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  function refresh() {
    router.refresh();
    platformApi
      .listPlans()
      .then((r) => setPlans(r.plans))
      .catch(() => {
        /* router.refresh will pick it up */
      });
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditing({ mode: "create" });
    setError(null);
  }

  function openEdit(plan: PlatformPlan) {
    setForm(planToForm(plan));
    setEditing({ mode: "edit", planId: plan.id });
    setError(null);
  }

  function close() {
    setEditing(null);
    setError(null);
  }

  async function onSave() {
    if (!editing) return;
    const payload = formToCreatePayload(form);
    if (typeof payload === "string") {
      setError(payload);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editing.mode === "create") {
        await platformApi.createPlan(payload);
      } else {
        // Drop `code` on update — server rejects it anyway, and the
        // type is Partial<Omit<…, "code">>.
        const { code: _omit, ...patch } = payload;
        void _omit;
        await platformApi.updatePlan(editing.planId, patch as PlatformPlanUpdateInput);
      }
      refresh();
      close();
    } catch (err) {
      setError(
        err instanceof PlatformApiError
          ? err.message || "Save failed."
          : "Could not reach the API.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function onArchive(plan: PlatformPlan) {
    if (
      !confirm(
        `Archive plan "${plan.name}"? Existing tenants stay grandfathered, but new tenants won't be able to switch to it.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await platformApi.archivePlan(plan.id);
      refresh();
    } catch (err) {
      setError(
        err instanceof PlatformApiError
          ? err.message || "Archive failed."
          : "Could not reach the API.",
      );
    }
  }

  async function onUnarchive(plan: PlatformPlan) {
    setError(null);
    try {
      await platformApi.unarchivePlan(plan.id);
      refresh();
    } catch (err) {
      setError(
        err instanceof PlatformApiError
          ? err.message || "Unarchive failed."
          : "Could not reach the API.",
      );
    }
  }

  async function onMigrateSubscribers(plan: PlatformPlan) {
    const older = plan.subscribersOnVersion?.older ?? 0;
    if (older === 0) return;
    if (
      !confirm(
        `Migrate ${older} grandfathered subscriber(s) to v${plan.currentVersionNumber} of ${plan.name}? They'll start seeing the current version's prices and caps immediately. This is irreversible — older versions remain on file but subscribers will be on the latest.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      const res = await platformApi.migratePlanSubscribers(plan.id);
      refresh();
      alert(`Migrated ${res.migrated} subscriber(s) to v${plan.currentVersionNumber}.`);
    } catch (err) {
      setError(
        err instanceof PlatformApiError
          ? err.message || "Migration failed."
          : "Could not reach the API.",
      );
    }
  }

  function toggleFeature(code: string) {
    setForm((f) =>
      f.features.includes(code)
        ? { ...f, features: f.features.filter((c) => c !== code) }
        : { ...f, features: [...f.features, code] },
    );
  }

  function addCustomFeature(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return;
    setForm((f) =>
      f.features.includes(trimmed) ? f : { ...f, features: [...f.features, trimmed] },
    );
  }

  return (
    <>
      {error && !editing && (
        <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-small text-red-200">
          {error}
        </div>
      )}

      {canEdit && (
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={openCreate}
            className="rounded-md border border-mint/40 bg-mint/10 px-4 py-2 text-small text-mint hover:bg-mint/20"
          >
            New plan
          </button>
        </div>
      )}

      {plans.length === 0 ? (
        <p className="mt-10 rounded-md border border-red-500/30 bg-red-500/10 p-4 text-small text-red-200">
          Could not load plans. Check that the migration ran and the API is up.
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {plans.map((p) => (
            <div
              key={p.id}
              className={`flex flex-col rounded-card border bg-black/20 p-6 ${
                p.isArchived ? "border-amber-400/30" : "border-white/10"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-h2 text-white truncate">{p.name}</h2>
                  <p className="mt-1 text-caption text-white/50 line-clamp-2">{p.tagline}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {p.isArchived && (
                    <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-caption text-amber-200">
                      Archived
                    </span>
                  )}
                  {!p.isPublic && (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-caption text-white/60">
                      Hidden
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-6 space-y-1">
                <div className="text-h3 text-white">
                  {formatMoney(p.monthlyPriceCents, p.currency)}
                  <span className="ml-2 text-caption text-white/50">/ mo</span>
                </div>
                <div className="text-small text-white/60">
                  or {formatMoney(p.yearlyPriceCents, p.currency)} / yr
                </div>
              </div>
              <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-2 text-small">
                <dt className="text-white/50">Users</dt>
                <dd className="text-right text-white/90">{formatLimit(p.maxUsers)}</dd>
                <dt className="text-white/50">Invoices / mo</dt>
                <dd className="text-right text-white/90">
                  {formatLimit(p.maxInvoicesMonthly)}
                </dd>
                <dt className="text-white/50">Branches</dt>
                <dd className="text-right text-white/90">{formatLimit(p.maxBranches)}</dd>
                <dt className="text-white/50">Warehouses</dt>
                <dd className="text-right text-white/90">{formatLimit(p.maxWarehouses)}</dd>
              </dl>
              <div className="mt-6 border-t border-white/10 pt-4">
                <div className="text-caption uppercase tracking-wide text-white/50">
                  Features
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.features.length === 0 ? (
                    <span className="text-caption text-white/40">—</span>
                  ) : (
                    p.features.map((f) => (
                      <span
                        key={f}
                        className="rounded-full bg-white/5 px-2 py-0.5 text-caption text-white/70"
                      >
                        {f}
                      </span>
                    ))
                  )}
                </div>
              </div>
              {/* Version + subscriber summary */}
              {p.currentVersionNumber != null && (
                <div className="mt-6 border-t border-white/10 pt-4">
                  <div className="text-caption uppercase tracking-wide text-white/50">
                    Version
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="rounded-md border border-mint/40 bg-mint/10 px-2 py-0.5 text-caption text-mint">
                      v{p.currentVersionNumber} (current)
                    </span>
                    {p.subscribersOnVersion && (
                      <span className="text-caption text-white/60">
                        {p.subscribersOnVersion.current} on current
                        {p.subscribersOnVersion.older > 0 && (
                          <>
                            {" · "}
                            <span className="text-amber-200">
                              {p.subscribersOnVersion.older} grandfathered
                            </span>
                          </>
                        )}
                      </span>
                    )}
                  </div>
                  {canEdit &&
                    p.subscribersOnVersion &&
                    p.subscribersOnVersion.older > 0 && (
                      <button
                        type="button"
                        onClick={() => onMigrateSubscribers(p)}
                        className="mt-2 w-full rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-caption text-amber-200 hover:bg-amber-400/20"
                      >
                        Migrate {p.subscribersOnVersion.older} grandfathered →
                        v{p.currentVersionNumber}
                      </button>
                    )}
                </div>
              )}

              <div className="mt-6 border-t border-white/10 pt-4 flex items-center justify-between">
                <div className="text-caption text-white/40">
                  code <span className="font-mono text-white/60">{p.code}</span>
                </div>
                {canEdit && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(p)}
                      className="rounded-md border border-white/15 bg-white/5 px-3 py-1 text-caption text-white/80 hover:bg-white/10"
                    >
                      Edit
                    </button>
                    {p.isArchived ? (
                      <button
                        type="button"
                        onClick={() => onUnarchive(p)}
                        className="rounded-md border border-mint/40 bg-mint/10 px-3 py-1 text-caption text-mint hover:bg-mint/20"
                      >
                        Unarchive
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onArchive(p)}
                        className="rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-caption text-amber-200 hover:bg-amber-400/20"
                      >
                        Archive
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <PlanEditorDrawer
          mode={editing.mode}
          editingPlan={
            editing.mode === "edit"
              ? plans.find((p) => p.id === editing.planId) ?? null
              : null
          }
          form={form}
          setForm={setForm}
          saving={saving}
          error={error}
          onClose={close}
          onSave={onSave}
          onToggleFeature={toggleFeature}
          onAddCustomFeature={addCustomFeature}
        />
      )}
    </>
  );
}

// Mirror of server-side VERSIONED_FIELDS detection: returns true if any
// value-bearing field would actually change between the loaded plan and
// the form. Keep in sync with apps/api/src/modules/platform-admin/routes.ts.
function hasValueBearingChange(plan: PlatformPlan, form: FormState): boolean {
  const formMonthly = Math.round(parseFloat(form.monthlyPriceLkr || "0") * 100);
  const formYearly = Math.round(parseFloat(form.yearlyPriceLkr || "0") * 100);
  const capValue = (cap: { unlimited: boolean; value: string }) =>
    cap.unlimited ? null : parseInt(cap.value, 10);
  if (form.name !== plan.name) return true;
  if (form.tagline !== plan.tagline) return true;
  if (formMonthly !== plan.monthlyPriceCents) return true;
  if (formYearly !== plan.yearlyPriceCents) return true;
  if (form.currency !== plan.currency) return true;
  if (capValue(form.maxUsers) !== plan.maxUsers) return true;
  if (capValue(form.maxInvoicesMonthly) !== plan.maxInvoicesMonthly) return true;
  if (capValue(form.maxBranches) !== plan.maxBranches) return true;
  if (capValue(form.maxWarehouses) !== plan.maxWarehouses) return true;
  const a = [...form.features].sort();
  const b = [...plan.features].sort();
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) return true;
  return false;
}

function PlanEditorDrawer({
  mode,
  editingPlan,
  form,
  setForm,
  saving,
  error,
  onClose,
  onSave,
  onToggleFeature,
  onAddCustomFeature,
}: {
  mode: "create" | "edit";
  editingPlan: PlatformPlan | null;
  form: FormState;
  setForm: (updater: (f: FormState) => FormState) => void;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: () => void;
  onToggleFeature: (code: string) => void;
  onAddCustomFeature: (code: string) => void;
}) {
  const [customFeature, setCustomFeature] = useState("");

  // Detect value-bearing changes so the warning banner is accurate.
  // Mirrors the server's VERSIONED_FIELDS check — keep in sync.
  const willCreateVersion =
    mode === "edit" && editingPlan != null && hasValueBearingChange(editingPlan, form);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="flex-1 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        role="presentation"
      />
      <div className="w-full max-w-xl overflow-y-auto bg-charcoal border-l border-white/10 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-h2 text-white">
            {mode === "create"
              ? "New plan"
              : `Edit plan${editingPlan?.currentVersionNumber ? ` (currently v${editingPlan.currentVersionNumber})` : ""}`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white/50 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {willCreateVersion && (
          <div className="mt-4 rounded-md border border-mint/40 bg-mint/10 p-3 text-small text-mint">
            Saving will create v{(editingPlan?.currentVersionNumber ?? 1) + 1}.{" "}
            {editingPlan?.subscribersOnVersion &&
            editingPlan.subscribersOnVersion.current > 0
              ? `The ${editingPlan.subscribersOnVersion.current} subscriber(s) currently on v${editingPlan.currentVersionNumber} will stay on v${editingPlan.currentVersionNumber} (grandfathered). New signups get v${(editingPlan.currentVersionNumber ?? 1) + 1}.`
              : `New signups will get v${(editingPlan?.currentVersionNumber ?? 1) + 1}.`}
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-small text-red-200">
            {error}
          </div>
        )}

        <div className="mt-6 space-y-5">
          <Field label="Code" hint="lowercase, used by requireFeature(). Locked on edit.">
            <input
              type="text"
              value={form.code}
              disabled={mode === "edit"}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              placeholder="e.g. growth"
              className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-white placeholder-white/30 disabled:opacity-50"
            />
          </Field>

          <Field label="Name">
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-white"
            />
          </Field>

          <Field label="Tagline" hint="Shown on the plan picker.">
            <input
              type="text"
              value={form.tagline}
              onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))}
              className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-white"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Monthly (LKR)">
              <input
                type="number"
                min={0}
                step={1}
                value={form.monthlyPriceLkr}
                onChange={(e) =>
                  setForm((f) => ({ ...f, monthlyPriceLkr: e.target.value }))
                }
                className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-white"
              />
            </Field>
            <Field label="Yearly (LKR)">
              <input
                type="number"
                min={0}
                step={1}
                value={form.yearlyPriceLkr}
                onChange={(e) =>
                  setForm((f) => ({ ...f, yearlyPriceLkr: e.target.value }))
                }
                className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-white"
              />
            </Field>
          </div>

          <Field label="Currency">
            <input
              type="text"
              maxLength={3}
              value={form.currency}
              onChange={(e) =>
                setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))
              }
              className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-white uppercase"
            />
          </Field>

          <div>
            <div className="text-caption uppercase tracking-wide text-white/50">
              Limits
            </div>
            <div className="mt-2 space-y-2">
              <CapField
                label="Max users"
                cap={form.maxUsers}
                onChange={(v) => setForm((f) => ({ ...f, maxUsers: v }))}
              />
              <CapField
                label="Max invoices / month"
                cap={form.maxInvoicesMonthly}
                onChange={(v) => setForm((f) => ({ ...f, maxInvoicesMonthly: v }))}
              />
              <CapField
                label="Max branches"
                cap={form.maxBranches}
                onChange={(v) => setForm((f) => ({ ...f, maxBranches: v }))}
              />
              <CapField
                label="Max warehouses"
                cap={form.maxWarehouses}
                onChange={(v) => setForm((f) => ({ ...f, maxWarehouses: v }))}
              />
            </div>
          </div>

          <div>
            <div className="text-caption uppercase tracking-wide text-white/50">
              Features
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {KNOWN_FEATURES.map((code) => {
                const on = form.features.includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => onToggleFeature(code)}
                    className={`rounded-full px-2 py-0.5 text-caption ${
                      on
                        ? "bg-mint/20 text-mint border border-mint/40"
                        : "bg-white/5 text-white/60 border border-white/10 hover:bg-white/10"
                    }`}
                  >
                    {code}
                  </button>
                );
              })}
              {form.features
                .filter((f) => !KNOWN_FEATURES.includes(f))
                .map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => onToggleFeature(code)}
                    className="rounded-full px-2 py-0.5 text-caption bg-amber-400/20 text-amber-200 border border-amber-400/30"
                    title="Custom feature — click to remove"
                  >
                    {code} ✕
                  </button>
                ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                placeholder="Custom feature code"
                value={customFeature}
                onChange={(e) => setCustomFeature(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onAddCustomFeature(customFeature);
                    setCustomFeature("");
                  }
                }}
                className="flex-1 rounded-md border border-white/15 bg-black/30 px-3 py-1.5 text-small text-white placeholder-white/30"
              />
              <button
                type="button"
                onClick={() => {
                  onAddCustomFeature(customFeature);
                  setCustomFeature("");
                }}
                className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-small text-white/80 hover:bg-white/10"
              >
                Add
              </button>
            </div>
          </div>

          <Field label="Sort order" hint="Lower = leftmost on the picker.">
            <input
              type="number"
              min={0}
              max={32767}
              value={form.sortOrder}
              onChange={(e) =>
                setForm((f) => ({ ...f, sortOrder: e.target.value }))
              }
              className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-white"
            />
          </Field>

          <label className="flex items-center gap-2 text-small text-white/80">
            <input
              type="checkbox"
              checked={form.isPublic}
              onChange={(e) =>
                setForm((f) => ({ ...f, isPublic: e.target.checked }))
              }
            />
            Public — show on the tenant plan picker
          </label>
        </div>

        <div className="mt-8 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/15 bg-white/5 px-4 py-2 text-small text-white/80 hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onSave}
            className="rounded-md border border-mint/40 bg-mint/10 px-4 py-2 text-small text-mint hover:bg-mint/20 disabled:opacity-50"
          >
            {saving ? "Saving…" : mode === "create" ? "Create plan" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-caption uppercase tracking-wide text-white/50">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-caption text-white/40">{hint}</p>}
    </div>
  );
}

function CapField({
  label,
  cap,
  onChange,
}: {
  label: string;
  cap: { unlimited: boolean; value: string };
  onChange: (v: { unlimited: boolean; value: string }) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex-1 text-small text-white/70">{label}</span>
      <label className="flex items-center gap-1.5 text-caption text-white/60">
        <input
          type="checkbox"
          checked={cap.unlimited}
          onChange={(e) =>
            onChange({ unlimited: e.target.checked, value: cap.value })
          }
        />
        Unlimited
      </label>
      <input
        type="number"
        min={0}
        disabled={cap.unlimited}
        value={cap.value}
        onChange={(e) => onChange({ unlimited: cap.unlimited, value: e.target.value })}
        placeholder={cap.unlimited ? "—" : "0"}
        className="w-24 rounded-md border border-white/15 bg-black/30 px-2 py-1 text-small text-white text-right disabled:opacity-40"
      />
    </div>
  );
}
