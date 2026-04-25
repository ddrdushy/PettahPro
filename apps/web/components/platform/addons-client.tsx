"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  PlatformApiError,
  platformApi,
  type PlatformAddon,
  type PlatformAddonCreateInput,
  type PlatformAddonUpdateInput,
} from "@/lib/platform-api";

// Add-on catalogue editor (#120). Mirrors plans-client.tsx structure
// but lighter — no versioning (price changes are not retroactive on
// add-ons either, but the spec calls for at-renewal application not
// snapshot tables; keeping this simple).

const KNOWN_FEATURES: string[] = [
  "payroll",
  "approval_workflows",
  "supplier_portal",
  "ai_bill_entry",
];

const KNOWN_PLAN_CODES: string[] = ["starter", "growth", "scale"];

interface FormState {
  code: string;
  name: string;
  tagline: string;
  monthlyPriceLkr: string;
  yearlyPriceLkr: string;
  currency: string;
  grantsFeatures: string[];
  eligiblePlanCodes: string[];
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
  grantsFeatures: [],
  eligiblePlanCodes: [],
  isPublic: true,
  sortOrder: "0",
};

function addonToForm(a: PlatformAddon): FormState {
  return {
    code: a.code,
    name: a.name,
    tagline: a.tagline,
    monthlyPriceLkr: (a.monthlyPriceCents / 100).toString(),
    yearlyPriceLkr: (a.yearlyPriceCents / 100).toString(),
    currency: a.currency,
    grantsFeatures: a.grantsFeatures,
    eligiblePlanCodes: a.eligiblePlanCodes,
    isPublic: a.isPublic,
    sortOrder: String(a.sortOrder),
  };
}

function formToCreatePayload(f: FormState): PlatformAddonCreateInput | string {
  const monthly = Math.round(parseFloat(f.monthlyPriceLkr) * 100);
  const yearly = Math.round(parseFloat(f.yearlyPriceLkr) * 100);
  if (!Number.isFinite(monthly) || monthly < 0)
    return "Monthly price must be non-negative.";
  if (!Number.isFinite(yearly) || yearly < 0)
    return "Yearly price must be non-negative.";
  const sortOrder = parseInt(f.sortOrder || "0", 10);
  if (!Number.isFinite(sortOrder)) return "Sort order must be an integer.";
  if (f.grantsFeatures.length === 0)
    return "At least one granted feature is required.";
  return {
    code: f.code,
    name: f.name,
    tagline: f.tagline,
    monthlyPriceCents: monthly,
    yearlyPriceCents: yearly,
    currency: f.currency,
    grantsFeatures: f.grantsFeatures,
    eligiblePlanCodes: f.eligiblePlanCodes,
    isPublic: f.isPublic,
    sortOrder,
  };
}

function formatMoney(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toLocaleString("en-LK", {
    maximumFractionDigits: currency === "LKR" ? 0 : 2,
  })}`;
}

export function AddonsClient({
  initialAddons,
  canEdit,
}: {
  initialAddons: PlatformAddon[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [addons, setAddons] = useState<PlatformAddon[]>(initialAddons);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<
    { mode: "create" } | { mode: "edit"; addonId: string } | null
  >(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  function refresh() {
    router.refresh();
    platformApi
      .listAddons()
      .then((r) => setAddons(r.addons))
      .catch(() => {});
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditing({ mode: "create" });
    setError(null);
  }

  function openEdit(addon: PlatformAddon) {
    setForm(addonToForm(addon));
    setEditing({ mode: "edit", addonId: addon.id });
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
        await platformApi.createAddon(payload);
      } else {
        const { code: _omit, ...patch } = payload;
        void _omit;
        await platformApi.updateAddon(editing.addonId, patch as PlatformAddonUpdateInput);
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

  async function onArchive(addon: PlatformAddon) {
    if (
      !confirm(
        `Archive "${addon.name}"? Existing subscribers stay active; new tenants can't buy it.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await platformApi.archiveAddon(addon.id);
      refresh();
    } catch (err) {
      setError(
        err instanceof PlatformApiError
          ? err.message || "Archive failed."
          : "Could not reach the API.",
      );
    }
  }

  async function onUnarchive(addon: PlatformAddon) {
    setError(null);
    try {
      await platformApi.unarchiveAddon(addon.id);
      refresh();
    } catch (err) {
      setError(
        err instanceof PlatformApiError
          ? err.message || "Unarchive failed."
          : "Could not reach the API.",
      );
    }
  }

  function toggleListItem(
    list: string[],
    code: string,
  ): string[] {
    return list.includes(code) ? list.filter((c) => c !== code) : [...list, code];
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
            New add-on
          </button>
        </div>
      )}

      {addons.length === 0 ? (
        <p className="mt-10 rounded-md border border-white/10 bg-black/20 p-6 text-small text-white/60">
          No add-ons yet. {canEdit && "Click \"New add-on\" to create the first one."}
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {addons.map((a) => (
            <div
              key={a.id}
              className={`flex flex-col rounded-card border bg-black/20 p-6 ${
                a.isArchived ? "border-amber-400/30" : "border-white/10"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-h2 text-white truncate">{a.name}</h2>
                  <p className="mt-1 text-caption text-white/50">{a.tagline}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {a.isArchived && (
                    <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-caption text-amber-200">
                      Archived
                    </span>
                  )}
                  {!a.isPublic && (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-caption text-white/60">
                      Hidden
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-4">
                <div className="text-h3 text-white">
                  {formatMoney(a.monthlyPriceCents, a.currency)}
                  <span className="ml-2 text-caption text-white/50">/ mo</span>
                </div>
                <div className="text-small text-white/60">
                  or {formatMoney(a.yearlyPriceCents, a.currency)} / yr
                </div>
              </div>

              <div className="mt-4 border-t border-white/10 pt-3">
                <div className="text-caption uppercase tracking-wide text-white/50">
                  Grants features
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {a.grantsFeatures.length === 0 ? (
                    <span className="text-caption text-white/40">— none</span>
                  ) : (
                    a.grantsFeatures.map((f) => (
                      <span
                        key={f}
                        className="rounded-full bg-mint/10 border border-mint/30 px-2 py-0.5 text-caption text-mint"
                      >
                        {f}
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div className="mt-3 border-t border-white/10 pt-3">
                <div className="text-caption uppercase tracking-wide text-white/50">
                  Eligible plans
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {a.eligiblePlanCodes.length === 0 ? (
                    <span className="text-caption text-white/40">All plans</span>
                  ) : (
                    a.eligiblePlanCodes.map((c) => (
                      <span
                        key={c}
                        className="rounded-full bg-white/5 border border-white/10 px-2 py-0.5 text-caption text-white/70"
                      >
                        {c}
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div className="mt-4 border-t border-white/10 pt-3 text-caption text-white/60">
                {a.activeSubscribers} active subscriber
                {a.activeSubscribers === 1 ? "" : "s"}
              </div>

              <div className="mt-4 border-t border-white/10 pt-3 flex items-center justify-between">
                <div className="text-caption text-white/40">
                  code <span className="font-mono text-white/60">{a.code}</span>
                </div>
                {canEdit && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(a)}
                      className="rounded-md border border-white/15 bg-white/5 px-3 py-1 text-caption text-white/80 hover:bg-white/10"
                    >
                      Edit
                    </button>
                    {a.isArchived ? (
                      <button
                        type="button"
                        onClick={() => onUnarchive(a)}
                        className="rounded-md border border-mint/40 bg-mint/10 px-3 py-1 text-caption text-mint hover:bg-mint/20"
                      >
                        Unarchive
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onArchive(a)}
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
        <div className="fixed inset-0 z-50 flex">
          <div
            className="flex-1 bg-black/60 backdrop-blur-sm"
            onClick={close}
            role="presentation"
          />
          <div className="w-full max-w-xl overflow-y-auto bg-charcoal border-l border-white/10 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-h2 text-white">
                {editing.mode === "create" ? "New add-on" : "Edit add-on"}
              </h2>
              <button
                type="button"
                onClick={close}
                className="text-white/50 hover:text-white"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {error && (
              <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-small text-red-200">
                {error}
              </div>
            )}

            <div className="mt-6 space-y-5">
              <Field label="Code" hint="lowercase. Locked on edit.">
                <input
                  type="text"
                  value={form.code}
                  disabled={editing.mode === "edit"}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="e.g. payroll_addon"
                  className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-white placeholder-white/30 disabled:opacity-50"
                />
              </Field>

              <Field label="Name">
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-white"
                />
              </Field>

              <Field label="Tagline">
                <input
                  type="text"
                  value={form.tagline}
                  onChange={(e) => setForm({ ...form, tagline: e.target.value })}
                  className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-white"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Monthly (LKR)">
                  <input
                    type="number"
                    min={0}
                    value={form.monthlyPriceLkr}
                    onChange={(e) =>
                      setForm({ ...form, monthlyPriceLkr: e.target.value })
                    }
                    className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-white"
                  />
                </Field>
                <Field label="Yearly (LKR)">
                  <input
                    type="number"
                    min={0}
                    value={form.yearlyPriceLkr}
                    onChange={(e) =>
                      setForm({ ...form, yearlyPriceLkr: e.target.value })
                    }
                    className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-white"
                  />
                </Field>
              </div>

              <div>
                <div className="text-caption uppercase tracking-wide text-white/50">
                  Grants features
                </div>
                <p className="mt-1 text-caption text-white/40">
                  Codes added to the tenant's effective feature set when this
                  add-on is active. Use codes that match server gates.
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {KNOWN_FEATURES.map((code) => {
                    const on = form.grantsFeatures.includes(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            grantsFeatures: toggleListItem(form.grantsFeatures, code),
                          })
                        }
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
                </div>
              </div>

              <div>
                <div className="text-caption uppercase tracking-wide text-white/50">
                  Eligible plans
                </div>
                <p className="mt-1 text-caption text-white/40">
                  Which plan codes can purchase this. Empty = anyone.
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {KNOWN_PLAN_CODES.map((code) => {
                    const on = form.eligiblePlanCodes.includes(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            eligiblePlanCodes: toggleListItem(
                              form.eligiblePlanCodes,
                              code,
                            ),
                          })
                        }
                        className={`rounded-full px-2 py-0.5 text-caption ${
                          on
                            ? "bg-sky-500/20 text-sky-200 border border-sky-500/40"
                            : "bg-white/5 text-white/60 border border-white/10 hover:bg-white/10"
                        }`}
                      >
                        {code}
                      </button>
                    );
                  })}
                </div>
              </div>

              <Field label="Sort order">
                <input
                  type="number"
                  min={0}
                  max={32767}
                  value={form.sortOrder}
                  onChange={(e) =>
                    setForm({ ...form, sortOrder: e.target.value })
                  }
                  className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-white"
                />
              </Field>

              <label className="flex items-center gap-2 text-small text-white/80">
                <input
                  type="checkbox"
                  checked={form.isPublic}
                  onChange={(e) =>
                    setForm({ ...form, isPublic: e.target.checked })
                  }
                />
                Public — show in the tenant's add-on picker
              </label>
            </div>

            <div className="mt-8 flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
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
                {saving
                  ? "Saving…"
                  : editing.mode === "create"
                    ? "Create add-on"
                    : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
