"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  PlatformApiError,
  platformApi,
  type PlatformCoupon,
  type PlatformCouponCreateInput,
  type PlatformCouponUpdateInput,
  type PlatformCouponRedemption,
} from "@/lib/platform-api";

const KNOWN_PLAN_CODES = ["starter", "growth", "scale"];

interface FormState {
  code: string;
  name: string;
  discountType: "percent_off" | "amount_off_cents";
  // For percent: % whole number (e.g. "20"); converted to bps on save.
  // For amount: LKR major; converted to cents on save.
  discountValue: string;
  appliesFor: "once" | "forever" | "months";
  appliesForMonths: string;
  eligiblePlanCodes: string[];
  newSignupsOnly: boolean;
  validFrom: string;
  validUntil: string;
  maxRedemptions: string;
  onePerTenant: boolean;
  isActive: boolean;
  notes: string;
}

const EMPTY_FORM: FormState = {
  code: "",
  name: "",
  discountType: "percent_off",
  discountValue: "",
  appliesFor: "once",
  appliesForMonths: "",
  eligiblePlanCodes: [],
  newSignupsOnly: false,
  validFrom: "",
  validUntil: "",
  maxRedemptions: "",
  onePerTenant: true,
  isActive: true,
  notes: "",
};

function couponToForm(c: PlatformCoupon): FormState {
  return {
    code: c.code,
    name: c.name,
    discountType: c.discountType,
    discountValue:
      c.discountType === "percent_off"
        ? String(c.discountValue / 100)
        : String(c.discountValue / 100),
    appliesFor: c.appliesFor,
    appliesForMonths: c.appliesForMonths != null ? String(c.appliesForMonths) : "",
    eligiblePlanCodes: c.eligiblePlanCodes,
    newSignupsOnly: c.newSignupsOnly,
    validFrom: c.validFrom ? c.validFrom.slice(0, 10) : "",
    validUntil: c.validUntil ? c.validUntil.slice(0, 10) : "",
    maxRedemptions: c.maxRedemptions != null ? String(c.maxRedemptions) : "",
    onePerTenant: c.onePerTenant,
    isActive: c.isActive,
    notes: c.notes ?? "",
  };
}

function formToCreatePayload(f: FormState): PlatformCouponCreateInput | string {
  if (f.code.trim().length < 2) return "Code must be at least 2 characters.";
  if (f.name.trim().length < 3) return "Name is too short.";
  const numericValue = parseFloat(f.discountValue);
  if (!Number.isFinite(numericValue) || numericValue < 0)
    return "Discount value must be a non-negative number.";
  // Convert: percent uses bps (1% = 100 bps); amount uses cents.
  // Both UI fields take "human" values (20 for 20%, 5000 for LKR 5000).
  const discountValue =
    f.discountType === "percent_off"
      ? Math.round(numericValue * 100)
      : Math.round(numericValue * 100);
  if (f.discountType === "percent_off" && discountValue > 10_000)
    return "Percent-off can't exceed 100%.";
  let appliesForMonths: number | undefined;
  if (f.appliesFor === "months") {
    const m = parseInt(f.appliesForMonths, 10);
    if (!Number.isFinite(m) || m < 1)
      return "Months must be a positive integer when 'applies for' is months.";
    appliesForMonths = m;
  }
  let maxRedemptions: number | undefined;
  if (f.maxRedemptions.trim()) {
    const n = parseInt(f.maxRedemptions, 10);
    if (!Number.isFinite(n) || n < 1)
      return "Max redemptions must be a positive integer.";
    maxRedemptions = n;
  }
  return {
    code: f.code.trim(),
    name: f.name.trim(),
    discountType: f.discountType,
    discountValue,
    appliesFor: f.appliesFor,
    appliesForMonths,
    eligiblePlanCodes: f.eligiblePlanCodes,
    newSignupsOnly: f.newSignupsOnly,
    validFrom: f.validFrom ? new Date(f.validFrom).toISOString() : undefined,
    validUntil: f.validUntil
      ? new Date(`${f.validUntil}T23:59:59`).toISOString()
      : undefined,
    maxRedemptions,
    onePerTenant: f.onePerTenant,
    isActive: f.isActive,
    notes: f.notes.trim() ? f.notes.trim() : undefined,
  };
}

function formatDiscount(c: PlatformCoupon): string {
  if (c.discountType === "percent_off") {
    return `${(c.discountValue / 100).toFixed(c.discountValue % 100 === 0 ? 0 : 2)}% off`;
  }
  return `LKR ${(c.discountValue / 100).toLocaleString("en-LK")} off`;
}

function formatDate(s: string | null): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-LK", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return s;
  }
}

export function CouponsClient({
  initialCoupons,
  canEdit,
}: {
  initialCoupons: PlatformCoupon[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [coupons, setCoupons] = useState(initialCoupons);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<
    { mode: "create" } | { mode: "edit"; couponId: string } | null
  >(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [redemptionsFor, setRedemptionsFor] = useState<{
    coupon: PlatformCoupon;
    redemptions: PlatformCouponRedemption[];
  } | null>(null);

  function refresh() {
    router.refresh();
    platformApi
      .listCoupons()
      .then((r) => setCoupons(r.coupons))
      .catch(() => {});
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
        await platformApi.createCoupon(payload);
      } else {
        const { code: _omit, ...patch } = payload;
        void _omit;
        await platformApi.updateCoupon(
          editing.couponId,
          patch as PlatformCouponUpdateInput,
        );
      }
      refresh();
      setEditing(null);
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

  async function toggleArchive(coupon: PlatformCoupon) {
    setError(null);
    try {
      if (coupon.isArchived) {
        await platformApi.unarchiveCoupon(coupon.id);
      } else {
        if (
          !confirm(
            `Archive ${coupon.code}? It can no longer be redeemed; existing redemptions stay.`,
          )
        ) {
          return;
        }
        await platformApi.archiveCoupon(coupon.id);
      }
      refresh();
    } catch (err) {
      setError(
        err instanceof PlatformApiError
          ? err.message || "Action failed."
          : "Could not reach the API.",
      );
    }
  }

  async function viewRedemptions(coupon: PlatformCoupon) {
    setError(null);
    try {
      const r = await platformApi.listCouponRedemptions(coupon.id);
      setRedemptionsFor({ coupon, redemptions: r.redemptions });
    } catch (err) {
      setError(
        err instanceof PlatformApiError
          ? err.message || "Could not load redemptions."
          : "Could not reach the API.",
      );
    }
  }

  function togglePlanCode(code: string) {
    setForm((f) => ({
      ...f,
      eligiblePlanCodes: f.eligiblePlanCodes.includes(code)
        ? f.eligiblePlanCodes.filter((c) => c !== code)
        : [...f.eligiblePlanCodes, code],
    }));
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
            onClick={() => {
              setForm(EMPTY_FORM);
              setEditing({ mode: "create" });
              setError(null);
            }}
            className="rounded-md border border-mint/40 bg-mint/10 px-4 py-2 text-small text-mint hover:bg-mint/20"
          >
            New coupon
          </button>
        </div>
      )}

      {coupons.length === 0 ? (
        <p className="mt-10 rounded-md border border-white/10 bg-black/20 p-6 text-small text-white/60">
          No coupons yet.{" "}
          {canEdit && "Click \"New coupon\" to create the first one."}
        </p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-card border border-white/10 bg-black/20">
          <table className="w-full text-small">
            <thead className="bg-white/5 text-caption uppercase tracking-wide text-white/50">
              <tr>
                <th className="px-4 py-2 text-left">Code</th>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Discount</th>
                <th className="px-4 py-2 text-left">Valid</th>
                <th className="px-4 py-2 text-left">Redeemed</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {coupons.map((c) => (
                <tr
                  key={c.id}
                  className={c.isArchived ? "opacity-50" : "hover:bg-white/5"}
                >
                  <td className="px-4 py-3 font-mono text-white">{c.code}</td>
                  <td className="px-4 py-3 text-white/80">{c.name}</td>
                  <td className="px-4 py-3 text-white/80">
                    {formatDiscount(c)}
                    <span className="ml-2 text-caption text-white/50">
                      {c.appliesFor === "months"
                        ? `× ${c.appliesForMonths ?? "?"} mo`
                        : c.appliesFor === "forever"
                          ? "every cycle"
                          : "once"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-caption text-white/60">
                    {formatDate(c.validFrom)} → {formatDate(c.validUntil)}
                  </td>
                  <td className="px-4 py-3 text-white/80">
                    {c.redemptionCount}
                    {c.maxRedemptions != null && (
                      <span className="text-white/50"> / {c.maxRedemptions}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {c.isArchived ? (
                      <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-caption text-amber-200">
                        Archived
                      </span>
                    ) : c.isActive ? (
                      <span className="rounded-full bg-mint/20 px-2 py-0.5 text-caption text-mint">
                        Active
                      </span>
                    ) : (
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-caption text-white/60">
                        Disabled
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => viewRedemptions(c)}
                        className="text-caption text-white/60 hover:text-white"
                      >
                        Redemptions ({c.redemptionCount})
                      </button>
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setForm(couponToForm(c));
                              setEditing({ mode: "edit", couponId: c.id });
                              setError(null);
                            }}
                            className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-caption text-white/80 hover:bg-white/10"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleArchive(c)}
                            className="rounded-md border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-caption text-amber-200 hover:bg-amber-400/20"
                          >
                            {c.isArchived ? "Unarchive" : "Archive"}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Editor drawer */}
      {editing && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="flex-1 bg-black/60 backdrop-blur-sm"
            onClick={() => setEditing(null)}
            role="presentation"
          />
          <div className="w-full max-w-xl overflow-y-auto bg-charcoal-950 border-l border-white/10 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-h2 text-white">
                {editing.mode === "create" ? "New coupon" : "Edit coupon"}
              </h2>
              <button
                type="button"
                onClick={() => setEditing(null)}
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
              <Field label="Code" hint="UPPERCASE, what users type. Locked on edit.">
                <input
                  type="text"
                  value={form.code}
                  disabled={editing.mode === "edit"}
                  onChange={(e) =>
                    setForm({ ...form, code: e.target.value.toUpperCase() })
                  }
                  placeholder="AVURUDU2026"
                  className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-white uppercase placeholder-white/30 disabled:opacity-50"
                />
              </Field>

              <Field label="Name" hint="Internal description.">
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-white"
                />
              </Field>

              <div>
                <div className="text-caption uppercase tracking-wide text-white/50">
                  Discount
                </div>
                <div className="mt-2 flex gap-2">
                  <select
                    value={form.discountType}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        discountType: e.target.value as
                          | "percent_off"
                          | "amount_off_cents",
                      })
                    }
                    className="rounded-md border border-white/15 bg-black/30 px-3 py-2 text-white"
                  >
                    <option value="percent_off">% off</option>
                    <option value="amount_off_cents">LKR off</option>
                  </select>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.discountValue}
                    onChange={(e) =>
                      setForm({ ...form, discountValue: e.target.value })
                    }
                    className="flex-1 rounded-md border border-white/15 bg-black/30 px-3 py-2 text-white"
                    placeholder={
                      form.discountType === "percent_off" ? "20" : "5000"
                    }
                  />
                  <span className="self-center text-small text-white/50">
                    {form.discountType === "percent_off" ? "%" : "LKR"}
                  </span>
                </div>
              </div>

              <div>
                <div className="text-caption uppercase tracking-wide text-white/50">
                  Applies for
                </div>
                <div className="mt-2 flex gap-2">
                  <select
                    value={form.appliesFor}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        appliesFor: e.target.value as
                          | "once"
                          | "forever"
                          | "months",
                      })
                    }
                    className="rounded-md border border-white/15 bg-black/30 px-3 py-2 text-white"
                  >
                    <option value="once">Once (first invoice)</option>
                    <option value="months">N months</option>
                    <option value="forever">Forever</option>
                  </select>
                  {form.appliesFor === "months" && (
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={form.appliesForMonths}
                      onChange={(e) =>
                        setForm({ ...form, appliesForMonths: e.target.value })
                      }
                      className="w-24 rounded-md border border-white/15 bg-black/30 px-3 py-2 text-white"
                      placeholder="3"
                    />
                  )}
                </div>
              </div>

              <div>
                <div className="text-caption uppercase tracking-wide text-white/50">
                  Eligible plans
                </div>
                <p className="mt-1 text-caption text-white/40">
                  Empty = any plan.
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {KNOWN_PLAN_CODES.map((code) => {
                    const on = form.eligiblePlanCodes.includes(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => togglePlanCode(code)}
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

              <div className="grid grid-cols-2 gap-3">
                <Field label="Valid from">
                  <input
                    type="date"
                    value={form.validFrom}
                    onChange={(e) =>
                      setForm({ ...form, validFrom: e.target.value })
                    }
                    className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-white"
                  />
                </Field>
                <Field label="Valid until">
                  <input
                    type="date"
                    value={form.validUntil}
                    onChange={(e) =>
                      setForm({ ...form, validUntil: e.target.value })
                    }
                    className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-white"
                  />
                </Field>
              </div>

              <Field label="Max redemptions" hint="Empty = unlimited.">
                <input
                  type="number"
                  min={1}
                  value={form.maxRedemptions}
                  onChange={(e) =>
                    setForm({ ...form, maxRedemptions: e.target.value })
                  }
                  className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-white"
                />
              </Field>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-small text-white/80">
                  <input
                    type="checkbox"
                    checked={form.onePerTenant}
                    onChange={(e) =>
                      setForm({ ...form, onePerTenant: e.target.checked })
                    }
                  />
                  Limit to one redemption per tenant
                </label>
                <label className="flex items-center gap-2 text-small text-white/80">
                  <input
                    type="checkbox"
                    checked={form.newSignupsOnly}
                    onChange={(e) =>
                      setForm({ ...form, newSignupsOnly: e.target.checked })
                    }
                  />
                  New signups only (not redeemable after signup)
                </label>
                <label className="flex items-center gap-2 text-small text-white/80">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) =>
                      setForm({ ...form, isActive: e.target.checked })
                    }
                  />
                  Active
                </label>
              </div>

              <Field label="Internal notes" hint="Operators only.">
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={3}
                  className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-white"
                />
              </Field>
            </div>

            <div className="mt-8 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
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
                    ? "Create coupon"
                    : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Redemptions panel */}
      {redemptionsFor && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="flex-1 bg-black/60 backdrop-blur-sm"
            onClick={() => setRedemptionsFor(null)}
            role="presentation"
          />
          <div className="w-full max-w-2xl overflow-y-auto bg-charcoal-950 border-l border-white/10 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-h2 text-white">
                  Redemptions: {redemptionsFor.coupon.code}
                </h2>
                <p className="mt-1 text-small text-white/60">
                  {redemptionsFor.redemptions.length} total
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRedemptionsFor(null)}
                className="text-white/50 hover:text-white"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="mt-6 divide-y divide-white/10">
              {redemptionsFor.redemptions.length === 0 ? (
                <p className="py-8 text-center text-small text-white/50">
                  No redemptions yet.
                </p>
              ) : (
                redemptionsFor.redemptions.map((r) => (
                  <div key={r.id} className="py-3">
                    <div className="flex justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-small text-white/90 truncate">
                          {r.tenantName ?? r.tenantId.slice(0, 8) + "…"}
                        </p>
                        {r.tenantSlug && (
                          <p className="text-caption text-white/40 font-mono">
                            {r.tenantSlug}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-caption text-white/60">
                          {formatDate(r.redeemedAt)}
                        </p>
                        <p className="text-caption">
                          <span
                            className={`rounded-full px-2 py-0.5 ${
                              r.status === "active"
                                ? "bg-mint/20 text-mint"
                                : r.status === "consumed"
                                  ? "bg-white/10 text-white/60"
                                  : "bg-amber-400/20 text-amber-200"
                            }`}
                          >
                            {r.status}
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
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
