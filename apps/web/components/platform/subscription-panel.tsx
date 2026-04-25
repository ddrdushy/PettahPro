"use client";

// #61 — Subscription panel for /platform/tenants/[id]?tab=billing.
//
// Renders the current plan + trial/status chip server-side (caller
// passes the subscription row), then adds a small interactive island
// for plan changes. Only super_admin sees the mutation UI; support +
// billing see the read-out.
//
// The change-plan flow is deliberately spartan — a <select> for the
// target plan, a native prompt() for the required reason, and a
// best-effort optimistic refresh via router.refresh(). Once we build
// more sophisticated subscription actions (extend-trial, cancel,
// reactivate) we can graduate to a proper dialog; for v1, a single
// dropdown keeps the surface small.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  PlatformApiError,
  platformApi,
  type PlatformPlan,
  type PlatformTenantCustomLimits,
  type PlatformTenantSubscription,
} from "@/lib/platform-api";

function formatMoney(cents: number, currency: string): string {
  const major = cents / 100;
  // LKR rarely needs decimals in a list price; fall back to 2dp for
  // non-LKR just in case we ever seed USD plans.
  return `${currency} ${major.toLocaleString("en-LK", {
    maximumFractionDigits: currency === "LKR" ? 0 : 2,
  })}`;
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

export function SubscriptionPanel({
  tenantId,
  initialSubscription,
  plans,
  canEdit,
}: {
  tenantId: string;
  initialSubscription: PlatformTenantSubscription;
  plans: PlatformPlan[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [subscription, setSubscription] =
    useState<PlatformTenantSubscription>(initialSubscription);
  const [targetPlanCode, setTargetPlanCode] = useState<string>(
    initialSubscription.plan.code,
  );
  const [targetCycle, setTargetCycle] = useState<"monthly" | "yearly">(
    initialSubscription.billingCycle,
  );
  const [endTrial, setEndTrial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const currentPlan = subscription.plan;
  const trialDaysLeft = daysUntil(subscription.trialEndsAt);
  const isTrial = subscription.status === "trial";
  const isCancelled = subscription.status === "cancelled";

  // A noop change shouldn't hit the network. Catch the three-param
  // equivalence locally.
  const isDirty =
    targetPlanCode !== currentPlan.code ||
    targetCycle !== subscription.billingCycle ||
    endTrial;

  async function doChange() {
    if (!isDirty) return;
    const reason = window.prompt(
      "Reason for plan change (required, min 3 chars):",
      "",
    );
    if (!reason || reason.trim().length < 3) {
      setError("A reason of at least 3 characters is required.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await platformApi.changeTenantPlan(tenantId, {
        planCode: targetPlanCode,
        billingCycle: targetCycle,
        endTrial,
        reason: reason.trim(),
      });
      setSubscription(res.subscription);
      setEndTrial(false);
      setNotice(
        res.changed
          ? "Plan updated. The tenant's next API request will see the new limits."
          : "No change applied.",
      );
      // Refresh the server-rendered audit tab so the change appears
      // immediately if the operator clicks over.
      router.refresh();
    } catch (e) {
      if (e instanceof PlatformApiError) {
        if (e.code === "SUBSCRIPTION_CANCELLED") {
          setError(
            "Subscription is cancelled. Reactivate first before changing plan.",
          );
        } else if (e.code === "UNKNOWN_PLAN") {
          setError("That plan code is not recognised.");
        } else {
          setError(e.message || "Could not change plan.");
        }
      } else {
        setError("Could not change plan.");
      }
    } finally {
      setBusy(false);
    }
  }

  const statusPill = (() => {
    switch (subscription.status) {
      case "trial":
        return {
          label: "Trial",
          cls: "bg-amber-400/20 text-amber-200 ring-amber-400/30",
        };
      case "active":
        return {
          label: "Active",
          cls: "bg-mint/20 text-mint ring-mint/30",
        };
      case "past_due":
        return {
          label: "Past due",
          cls: "bg-orange-500/20 text-orange-200 ring-orange-500/30",
        };
      case "cancelled":
        return {
          label: "Cancelled",
          cls: "bg-white/10 text-white/60 ring-white/20",
        };
    }
  })();

  return (
    <div className="space-y-6">
      {/* Current plan card */}
      <div className="rounded-md border border-white/10 bg-black/30 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-h3 text-white">{currentPlan.name}</h3>
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-caption ring-1 ring-inset ${statusPill.cls}`}
              >
                {statusPill.label}
              </span>
            </div>
            <p className="mt-1 text-caption text-white/50">
              {currentPlan.tagline}
            </p>
          </div>
          <div className="text-right">
            <div className="text-body text-white">
              {formatMoney(
                subscription.billingCycle === "yearly"
                  ? currentPlan.yearlyPriceCents
                  : currentPlan.monthlyPriceCents,
                currentPlan.currency,
              )}
              <span className="ml-1 text-caption text-white/50">
                / {subscription.billingCycle === "yearly" ? "year" : "month"}
              </span>
            </div>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-small md:grid-cols-4">
          <Limit
            label="Users"
            planN={currentPlan.maxUsers}
            overrideN={subscription.customLimits.maxUsers}
          />
          <Limit
            label="Invoices / mo"
            planN={currentPlan.maxInvoicesMonthly}
            overrideN={subscription.customLimits.maxInvoicesMonthly}
          />
          <Limit
            label="Branches"
            planN={currentPlan.maxBranches}
            overrideN={subscription.customLimits.maxBranches}
          />
          <Limit
            label="Warehouses"
            planN={currentPlan.maxWarehouses}
            overrideN={subscription.customLimits.maxWarehouses}
          />
        </dl>
        {subscription.customLimits.note && (
          <p className="mt-3 rounded-md border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-caption text-amber-200/90">
            <span className="font-medium">Custom limits note:</span>{" "}
            {subscription.customLimits.note}
          </p>
        )}
        {isTrial && trialDaysLeft !== null && (
          <p
            className={`mt-4 text-caption ${
              trialDaysLeft <= 3 ? "text-red-300" : "text-amber-200"
            }`}
          >
            Trial ends in {trialDaysLeft} day{trialDaysLeft === 1 ? "" : "s"}
            {subscription.trialEndsAt
              ? ` (${new Date(subscription.trialEndsAt).toLocaleDateString(
                  "en-GB",
                  { day: "2-digit", month: "short", year: "numeric" },
                )})`
              : ""}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-1">
          {currentPlan.features.map((f) => (
            <span
              key={f}
              className="rounded-full bg-white/5 px-2 py-0.5 text-caption text-white/60"
            >
              {f}
            </span>
          ))}
        </div>
      </div>

      {/* Change plan — super_admin only */}
      {canEdit && !isCancelled && (
        <div className="rounded-md border border-white/10 bg-black/30 p-5">
          <h3 className="text-h3 text-white">Change plan</h3>
          <p className="mt-1 text-caption text-white/50">
            Audited. A reason is required. Move between any of the seeded
            plans; this endpoint doesn't collect payment — do that out-of-band
            and reflect the outcome here.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="block text-caption text-white/50">Plan</label>
              <select
                value={targetPlanCode}
                onChange={(e) => setTargetPlanCode(e.target.value)}
                disabled={busy}
                className="mt-1 block w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-body text-white focus:border-mint focus:outline-none"
              >
                {plans.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name} — {formatMoney(p.monthlyPriceCents, p.currency)}/mo
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-caption text-white/50">
                Billing cycle
              </label>
              <select
                value={targetCycle}
                onChange={(e) =>
                  setTargetCycle(e.target.value as "monthly" | "yearly")
                }
                disabled={busy}
                className="mt-1 block w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-body text-white focus:border-mint focus:outline-none"
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-2 text-small text-white/70">
                <input
                  type="checkbox"
                  checked={endTrial}
                  onChange={(e) => setEndTrial(e.target.checked)}
                  disabled={busy || !isTrial}
                  className="h-4 w-4 rounded border-white/20 bg-black/40"
                />
                End trial now
              </label>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={doChange}
              disabled={busy || !isDirty}
              className="rounded-md border border-mint/40 bg-mint/10 px-4 py-2 text-small text-mint hover:bg-mint/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-white/40"
            >
              {busy ? "Applying…" : "Apply change"}
            </button>
            {notice && <span className="text-caption text-mint">{notice}</span>}
            {error && <span className="text-caption text-red-300">{error}</span>}
          </div>
        </div>
      )}

      {/* Cancelled footer — mutation UI hidden; we explain why. */}
      {isCancelled && (
        <div className="rounded-md border border-white/10 bg-black/30 p-4 text-caption text-white/60">
          Subscription was cancelled on{" "}
          {subscription.cancelledAt
            ? new Date(subscription.cancelledAt).toLocaleDateString("en-GB")
            : "—"}
          . Reactivate from the tenant actions menu before changing plans.
        </div>
      )}

      {/* Per-tenant quota overrides (#71). Surface only to super_admin
          and only while the subscription is alive — overrides on a
          cancelled tenant would be meaningless since gated features
          are already locked. */}
      {canEdit && !isCancelled && (
        <QuotaOverridesCard
          tenantId={tenantId}
          plan={currentPlan}
          initial={subscription.customLimits}
          onSaved={(next) =>
            setSubscription((s) => ({ ...s, customLimits: next }))
          }
        />
      )}
    </div>
  );
}

// Override editor. Each numeric field has three states:
//   - blank input   → field not sent to the API (preserve current value)
//   - "clear" click → explicit null, removes the override
//   - a number      → set / update the override
//
// Using a separate card (rather than inlining into "Change plan") so
// operators don't accidentally conflate plan upgrades with bespoke
// contract adjustments. They're different conversations.
function QuotaOverridesCard({
  tenantId,
  plan,
  initial,
  onSaved,
}: {
  tenantId: string;
  plan: PlatformPlan;
  initial: PlatformTenantCustomLimits;
  onSaved: (next: PlatformTenantCustomLimits) => void;
}) {
  // Store inputs as strings so the "empty field = untouched" pattern
  // survives round-tripping through type="number". Convert to number
  // at save time.
  const [users, setUsers] = useState(numToString(initial.maxUsers));
  const [invoices, setInvoices] = useState(
    numToString(initial.maxInvoicesMonthly),
  );
  const [branches, setBranches] = useState(numToString(initial.maxBranches));
  const [warehouses, setWarehouses] = useState(
    numToString(initial.maxWarehouses),
  );
  const [note, setNote] = useState(initial.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function apply(field: keyof PlatformTenantCustomLimits | "all") {
    const reason = window.prompt(
      "Reason for override change (required, min 3 chars):",
      "",
    );
    if (!reason || reason.trim().length < 3) {
      setError("A reason of at least 3 characters is required.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Build the patch body from the current inputs. For "all" (save
      // button) we send every field that differs from the initial
      // state — including explicit nulls to clear overrides. For a
      // single-field clear we send just that field.
      const body: Parameters<typeof platformApi.setTenantOverrides>[1] = {
        reason: reason.trim(),
      };
      if (field === "all") {
        body.maxUsers = stringToNum(users);
        body.maxInvoicesMonthly = stringToNum(invoices);
        body.maxBranches = stringToNum(branches);
        body.maxWarehouses = stringToNum(warehouses);
        body.note = note.trim() ? note.trim() : null;
      } else if (field === "note") {
        body.note = null;
        setNote("");
      } else {
        // Per-field clear. We still need a unique field name in the
        // body so the API knows which override to nullify.
        const fieldKey = field as
          | "maxUsers"
          | "maxInvoicesMonthly"
          | "maxBranches"
          | "maxWarehouses";
        body[fieldKey] = null;
        const setter = (
          {
            maxUsers: setUsers,
            maxInvoicesMonthly: setInvoices,
            maxBranches: setBranches,
            maxWarehouses: setWarehouses,
          } as const
        )[fieldKey];
        setter("");
      }
      const res = await platformApi.setTenantOverrides(tenantId, body);
      onSaved(res.customLimits);
      setNotice("Overrides updated. The tenant's next request sees the new caps.");
    } catch (e) {
      if (e instanceof PlatformApiError) {
        setError(e.message || "Could not save overrides.");
      } else {
        setError("Could not save overrides.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-white/10 bg-black/30 p-5">
      <h3 className="text-h3 text-white">Custom quota overrides</h3>
      <p className="mt-1 text-caption text-white/50">
        Bespoke caps for this tenant. Leave a field blank to inherit the plan
        default; set a number to override. All changes are audited and
        require a reason.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <OverrideInput
          label="Users"
          placeholder={formatPlaceholder(plan.maxUsers)}
          value={users}
          onChange={setUsers}
          onClear={
            initial.maxUsers !== null ? () => apply("maxUsers") : undefined
          }
          disabled={busy}
        />
        <OverrideInput
          label="Invoices / month"
          placeholder={formatPlaceholder(plan.maxInvoicesMonthly)}
          value={invoices}
          onChange={setInvoices}
          onClear={
            initial.maxInvoicesMonthly !== null
              ? () => apply("maxInvoicesMonthly")
              : undefined
          }
          disabled={busy}
        />
        <OverrideInput
          label="Branches"
          placeholder={formatPlaceholder(plan.maxBranches)}
          value={branches}
          onChange={setBranches}
          onClear={
            initial.maxBranches !== null
              ? () => apply("maxBranches")
              : undefined
          }
          disabled={busy}
        />
        <OverrideInput
          label="Warehouses"
          placeholder={formatPlaceholder(plan.maxWarehouses)}
          value={warehouses}
          onChange={setWarehouses}
          onClear={
            initial.maxWarehouses !== null
              ? () => apply("maxWarehouses")
              : undefined
          }
          disabled={busy}
        />
      </div>
      <div className="mt-3">
        <label className="block text-caption text-white/50">
          Note <span className="text-white/30">(shown with the overrides)</span>
        </label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Grandfathered from Q2 contract"
          disabled={busy}
          maxLength={500}
          className="mt-1 block w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-body text-white focus:border-mint focus:outline-none"
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => apply("all")}
          disabled={busy}
          className="rounded-md border border-mint/40 bg-mint/10 px-4 py-2 text-small text-mint hover:bg-mint/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-white/40"
        >
          {busy ? "Saving…" : "Save overrides"}
        </button>
        {notice && <span className="text-caption text-mint">{notice}</span>}
        {error && <span className="text-caption text-red-300">{error}</span>}
      </div>
    </div>
  );
}

function OverrideInput({
  label,
  placeholder,
  value,
  onChange,
  onClear,
  disabled,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  // Only provided when there's an active override to clear. Hides the
  // button on fields that are currently inheriting, so the UI reflects
  // state truthfully.
  onClear?: () => void;
  disabled: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-caption text-white/50">{label}</label>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            className="text-caption text-white/40 underline-offset-2 hover:text-white/70 hover:underline disabled:cursor-not-allowed disabled:no-underline"
          >
            Clear override
          </button>
        )}
      </div>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="mt-1 block w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-body text-white focus:border-mint focus:outline-none"
      />
    </div>
  );
}

function numToString(n: number | null): string {
  return n === null ? "" : String(n);
}

// Blank input → null (clear the override, inherit the plan). A digit
// string → number. Non-empty but non-numeric also returns null so a
// garbage value at least doesn't silently become a number — the server
// schema accepts null. Zero is legitimate: a "freeze this resource"
// value distinct from both "unlimited" and "inherit."
function stringToNum(s: string): number | null {
  const trimmed = s.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

function formatPlaceholder(n: number | null): string {
  return n === null ? "Plan: Unlimited" : `Plan: ${n.toLocaleString()}`;
}

function Limit({
  label,
  planN,
  overrideN,
}: {
  label: string;
  planN: number | null;
  // An explicit override wins; when null the plan cap is effective.
  // Showing both lets the operator see "custom 5,000 (plan: 500)" at
  // a glance without clicking into the override editor.
  overrideN: number | null;
}) {
  const effective = overrideN ?? planN;
  const isOverridden = overrideN !== null;
  return (
    <div>
      <div className="text-caption text-white/50">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span
          className={`text-body ${isOverridden ? "text-amber-300" : "text-white/90"}`}
        >
          {effective == null ? "Unlimited" : effective.toLocaleString()}
        </span>
        {isOverridden && (
          <span className="text-caption text-white/40">
            (plan: {planN == null ? "∞" : planN.toLocaleString()})
          </span>
        )}
      </div>
    </div>
  );
}
