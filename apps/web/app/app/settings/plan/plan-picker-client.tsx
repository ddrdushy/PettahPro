"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Sparkles } from "lucide-react";
import {
  api,
  ApiError,
  type AvailablePlan,
  type TenantSubscriptionResponse,
} from "@/lib/api";
import { formatLKR } from "@/lib/format";

type BillingCycle = "monthly" | "yearly";

export function PlanPickerClient({
  plans,
  subscription,
}: {
  plans: AvailablePlan[];
  subscription: TenantSubscriptionResponse;
}) {
  const router = useRouter();
  const [cycle, setCycle] = useState<BillingCycle>(subscription.billingCycle);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<AvailablePlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentPlanCode = subscription.plan.code;
  const isCancelled = subscription.status === "cancelled";

  async function submit(plan: AvailablePlan) {
    setError(null);
    setBusyCode(plan.code);
    try {
      await api.changeMyPlan({ planCode: plan.code, billingCycle: cycle });
      setConfirming(null);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "PAYMENT_PROVIDER_UNAVAILABLE") {
          // Payment stub is off — show a friendly message pointing the
          // user at support instead of the raw 503.
          setError(err.message);
        } else if (err.code === "SUBSCRIPTION_CANCELLED") {
          setError(
            "Your subscription has been cancelled. Contact support to reactivate.",
          );
        } else {
          setError(err.message || "Couldn't change your plan. Try again.");
        }
      } else {
        setError("Couldn't change your plan. Try again.");
      }
    } finally {
      setBusyCode(null);
    }
  }

  return (
    <div className="mt-8">
      {/* Monthly / yearly toggle — yearly is the headline price on the
          marketing site; show the same saving on settings so the mental
          model is consistent. */}
      <div className="mb-6 flex items-center gap-3">
        <span className="text-small font-medium text-text-secondary">Billing cycle</span>
        <div
          role="tablist"
          aria-label="Billing cycle"
          className="inline-flex rounded-md border-hairline border-border bg-surface-elevated p-0.5"
        >
          {(["monthly", "yearly"] as const).map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={cycle === c}
              onClick={() => setCycle(c)}
              className={`rounded px-3 py-1 text-small font-medium transition ${
                cycle === c
                  ? "bg-charcoal text-white"
                  : "text-text-secondary hover:text-charcoal"
              }`}
            >
              {c === "monthly" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </div>
        {cycle === "yearly" ? (
          <span className="text-caption text-emerald-800">~17% saved vs monthly</span>
        ) : null}
      </div>

      {isCancelled ? (
        <div className="mb-6 rounded-card border-hairline border-border bg-rose-50 p-4">
          <p className="text-small text-rose-900">
            Your subscription has been cancelled. Self-serve plan change is
            unavailable — contact support to reactivate.
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="mb-6 rounded-card border-hairline border-border bg-rose-50 p-4">
          <p className="text-small text-rose-900">{error}</p>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => {
          const isCurrent = plan.code === currentPlanCode;
          const priceCents =
            cycle === "yearly" ? plan.yearlyPriceCents : plan.monthlyPriceCents;
          const priceLabel = cycle === "yearly" ? "/ year" : "/ month";
          const busy = busyCode === plan.code;

          return (
            <div
              key={plan.id}
              className={`flex flex-col rounded-card border-hairline p-6 transition ${
                isCurrent
                  ? "border-charcoal bg-surface-elevated shadow-sm"
                  : "border-border bg-surface-elevated hover:border-charcoal/40"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-body font-semibold text-charcoal">{plan.name}</p>
                  <p className="mt-1 text-caption text-text-secondary">{plan.tagline}</p>
                </div>
                {isCurrent ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-charcoal px-2 py-0.5 text-caption font-medium text-white">
                    <Sparkles className="h-3 w-3" aria-hidden /> Current
                  </span>
                ) : null}
              </div>

              <p className="mt-4 text-h2 font-semibold text-charcoal">
                {formatLKR(priceCents)}
                <span className="ml-1 text-small font-normal text-text-tertiary">
                  {priceLabel}
                </span>
              </p>

              <ul className="mt-4 flex-1 space-y-2">
                {renderLimitLine(
                  "Users",
                  plan.maxUsers === null ? "Unlimited" : plan.maxUsers,
                )}
                {renderLimitLine(
                  "Invoices / month",
                  plan.maxInvoicesMonthly === null
                    ? "Unlimited"
                    : plan.maxInvoicesMonthly,
                )}
                {renderLimitLine(
                  "Branches",
                  plan.maxBranches === null ? "Unlimited" : plan.maxBranches,
                )}
                {renderLimitLine(
                  "Warehouses",
                  plan.maxWarehouses === null ? "Unlimited" : plan.maxWarehouses,
                )}
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-caption text-text-secondary">
                    <Check className="mt-0.5 h-3.5 w-3.5 text-emerald-700" aria-hidden />
                    <span>{f.replace(/_/g, " ")}</span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                disabled={isCurrent || isCancelled || busy}
                onClick={() => setConfirming(plan)}
                className={`mt-6 inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2 text-small font-medium transition ${
                  isCurrent
                    ? "cursor-default border-hairline border-border bg-surface-recessed/40 text-text-tertiary"
                    : isCancelled
                      ? "cursor-not-allowed border-hairline border-border bg-surface-recessed/40 text-text-tertiary"
                      : "bg-charcoal text-white hover:bg-charcoal/90 disabled:opacity-60"
                }`}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                {isCurrent ? "Current plan" : `Choose ${plan.name}`}
              </button>
            </div>
          );
        })}
      </div>

      {confirming ? (
        <ConfirmModal
          plan={confirming}
          cycle={cycle}
          fromPlanCode={currentPlanCode}
          busy={busyCode === confirming.code}
          onCancel={() => setConfirming(null)}
          onConfirm={() => submit(confirming)}
        />
      ) : null}
    </div>
  );
}

function renderLimitLine(label: string, value: string | number) {
  return (
    <li className="flex items-start gap-2 text-caption text-text-secondary">
      <Check className="mt-0.5 h-3.5 w-3.5 text-emerald-700" aria-hidden />
      <span>
        {label}: <span className="font-medium text-charcoal">{value}</span>
      </span>
    </li>
  );
}

function ConfirmModal({
  plan,
  cycle,
  fromPlanCode,
  busy,
  onCancel,
  onConfirm,
}: {
  plan: AvailablePlan;
  cycle: BillingCycle;
  fromPlanCode: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const priceCents =
    cycle === "yearly" ? plan.yearlyPriceCents : plan.monthlyPriceCents;
  const priceLabel = cycle === "yearly" ? "per year" : "per month";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="plan-change-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 p-4"
    >
      <div className="max-w-md rounded-card border-hairline border-border bg-surface-elevated p-6 shadow-xl">
        <h3 id="plan-change-title" className="text-h3 font-semibold text-charcoal">
          Change plan to {plan.name}?
        </h3>
        <p className="mt-3 text-small text-text-secondary">
          You're switching from <strong className="font-medium text-charcoal">{fromPlanCode}</strong> to{" "}
          <strong className="font-medium text-charcoal">{plan.code}</strong>, billed {cycle}.
          The new price is <strong className="font-medium text-charcoal">{formatLKR(priceCents)} {priceLabel}</strong>.
          Any new features unlock immediately; if you're downgrading, current-period features stay available
          until the cycle rolls over.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-md border-hairline border-border px-4 py-2 text-small font-medium text-charcoal hover:bg-surface-recessed/40"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 rounded-md bg-charcoal px-4 py-2 text-small font-medium text-white hover:bg-charcoal/90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            Confirm change
          </button>
        </div>
      </div>
    </div>
  );
}
