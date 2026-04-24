"use client";

import Link from "next/link";
import { AlertCircle, ArrowRight, Lock } from "lucide-react";
import { ApiError } from "@/lib/api";

/**
 * Client-side plan/quota error banner (#69).
 *
 * The API surfaces three plan-shaped errors:
 *
 *   - PLAN_REQUIRED (#62)        — feature not in tenant's plan
 *   - QUOTA_EXCEEDED (#65)       — resource cap hit this period
 *   - SUBSCRIPTION_CANCELLED     — grace window elapsed, tenant is locked out
 *
 * The invoice + branch forms previously rendered `err.message` as flat
 * text when any of these came back — correct but dead-end. The server
 * already hands us enough structured detail to do better: current
 * plan, cap values, a list of qualifying upgrade plans. This banner
 * reads that detail off `ApiError` and renders an inline upgrade CTA
 * that deep-links to `/app/settings/plan`.
 *
 * For non-plan errors (validation, network, generic 500) the banner
 * falls back to a plain danger message — callers get one consistent
 * error surface without having to branch in every form's JSX.
 *
 * Design choice: mirror the sidebar's (#67) and page gate's (#68)
 * visual vocabulary — padlock icon for plan misses, arrow CTA to
 * /settings/plan — so users see the same motif no matter where they
 * hit the wall. The goal is a single mental model: "that lock means
 * upgrade."
 */
export function PlanErrorBanner({
  error,
  fallbackMessage,
}: {
  error: unknown;
  // When the caller has a friendlier default than ApiError.message for
  // non-plan failures ("Couldn't save the invoice."). Only used when
  // the error isn't recognised as a plan error.
  fallbackMessage?: string;
}) {
  if (!error) return null;

  // String errors are client-side validation ("Pick a customer first.")
  // — render flat, no upgrade CTA.
  if (typeof error === "string") {
    return <FlatBanner message={error} />;
  }

  if (error instanceof ApiError) {
    if (error.code === "QUOTA_EXCEEDED") return <QuotaBanner error={error} />;
    if (error.code === "PLAN_REQUIRED") return <PlanRequiredBanner error={error} />;
    if (error.code === "SUBSCRIPTION_CANCELLED")
      return <CancelledBanner error={error} />;
    return <FlatBanner message={error.message} />;
  }

  return <FlatBanner message={fallbackMessage ?? "Something went wrong."} />;
}

function FlatBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-3 text-small text-danger">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

// Human-readable resource labels for the quota banner. Mirrors the
// server's `quotaMessage()` vocabulary in plan-gate.ts so a tenant
// sees the same words in the usage chip on /settings, the server
// error message, and this banner.
const RESOURCE_LABEL: Record<string, { singular: string; plural: string }> = {
  invoices_monthly: { singular: "monthly invoice", plural: "monthly invoices" },
  branches: { singular: "branch", plural: "branches" },
  warehouses: { singular: "warehouse", plural: "warehouses" },
};

function titleCase(code: string | null | undefined): string | null {
  if (!code) return null;
  return code.charAt(0).toUpperCase() + code.slice(1);
}

function QuotaBanner({ error }: { error: ApiError }) {
  const label = (error.resource ? RESOURCE_LABEL[error.resource] : undefined) ?? {
    singular: "resource",
    plural: "resources",
  };
  const upgradeTo = titleCase(error.upgradeToPlanCodes?.[0]);
  const currentPlan = titleCase(error.currentPlanCode);

  // When we have both current/max, lead with the hard number —
  // "500 / 500 monthly invoices" conveys the state faster than prose.
  const stats =
    error.quotaCurrent !== undefined && error.quotaMax !== undefined
      ? `${error.quotaCurrent} / ${error.quotaMax} ${label.plural}`
      : null;

  return (
    <div className="flex flex-col gap-3 rounded-md border-hairline border-warning/40 bg-warning-bg/50 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-2.5">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <div className="space-y-1">
          <p className="text-small font-medium text-charcoal">
            You've hit your {label.singular} limit
            {currentPlan ? ` on the ${currentPlan} plan` : ""}.
          </p>
          {stats && (
            <p className="text-caption tabular-nums text-text-secondary">
              {stats} used this period.
            </p>
          )}
          {upgradeTo && (
            <p className="text-caption text-text-secondary">
              Upgrade to {upgradeTo} for a higher cap.
            </p>
          )}
        </div>
      </div>
      <Link
        href="/app/settings/plan"
        className="btn-primary shrink-0 self-start"
      >
        {upgradeTo ? `See ${upgradeTo} plan` : "Upgrade plan"}
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
}

function PlanRequiredBanner({ error }: { error: ApiError }) {
  // PLAN_REQUIRED shouldn't usually land on a form — the sidebar + page
  // gate (#67/#68) keep users off gated pages in the first place. But a
  // page we haven't gated yet could still 403, or a bulk action could
  // trip the gate. Handle it gracefully.
  const upgradeTo = titleCase(error.upgradeToPlanCodes?.[0]);
  return (
    <div className="flex flex-col gap-3 rounded-md border-hairline border-border bg-surface-elevated p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-2.5">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
        <div>
          <p className="text-small font-medium text-charcoal">
            {error.message}
          </p>
          {upgradeTo && (
            <p className="mt-0.5 text-caption text-text-secondary">
              Available on the {upgradeTo} plan and above.
            </p>
          )}
        </div>
      </div>
      <Link
        href="/app/settings/plan"
        className="btn-primary shrink-0 self-start"
      >
        {upgradeTo ? `See ${upgradeTo} plan` : "Upgrade plan"}
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
}

function CancelledBanner({ error }: { error: ApiError }) {
  // Cancelled state is terminal for self-serve (#63): picking a plan from
  // here doesn't restart billing automatically. Route to the plan page
  // anyway so the user can see the options, but lead with contact-support
  // copy so they don't click the CTA expecting an instant fix.
  return (
    <div className="rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-4">
      <div className="flex items-start gap-2.5">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
        <div className="space-y-1">
          <p className="text-small font-medium text-charcoal">
            {error.message}
          </p>
          <p className="text-caption text-text-secondary">
            Email{" "}
            <a href="mailto:support@pettahpro.lk" className="underline">
              support@pettahpro.lk
            </a>{" "}
            to reactivate.
          </p>
        </div>
      </div>
    </div>
  );
}
