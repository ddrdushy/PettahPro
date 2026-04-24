import { cache } from "react";
import { cookies } from "next/headers";
import type { TenantSubscriptionResponse } from "@/lib/api";

/**
 * Per-request plan-feature cache (#68).
 *
 * The AppLayout + any plan-gated page both want the tenant's feature
 * array. Without caching they'd each fetch `/subscription` — two round
 * trips on every navigation. `React.cache()` dedupes across server
 * component renders within a single request, so the second caller pays
 * nothing.
 *
 * Safe-default on failure: empty array. "Unknown plan" locks everything
 * gated (same rationale as #67's sidebar fallback) — better to hide a
 * feature the user paid for than to accidentally unlock a Scale-only
 * feature for a Starter tenant on a flaky fetch.
 */
export const getPlanFeatures = cache(async (): Promise<string[]> => {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return [];
  try {
    const res = await fetch(
      `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/subscription`,
      { headers: { cookie: cookieHeader }, cache: "no-store" },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as {
      subscription: TenantSubscriptionResponse;
    };
    return body.subscription.plan.features ?? [];
  } catch {
    return [];
  }
});

/**
 * The plan feature codes that gate access to specific pages. Mirrors
 * the server-side `requireFeature()` perimeter (#62). Keeping this
 * union narrow — not every `plans.features` value needs a page-level
 * gate, only the ones whose landing page is worth showing an upgrade
 * CTA for.
 */
export type PlanGateFeature =
  | "payroll"
  | "approval_workflows"
  | "supplier_portal"
  | "ai_bill_entry";

/**
 * Copy for the upgrade CTA card. Matches the sidebar's PLAN_FEATURE_COPY
 * so the tooltip in the nav and the page card tell the same story. If
 * we add a new PlanGateFeature, TS forces an entry here.
 */
export const PLAN_GATE_COPY: Record<
  PlanGateFeature,
  { title: string; description: string; upgradeTo: string }
> = {
  payroll: {
    title: "Payroll is on the Growth plan",
    description:
      "Monthly payroll with EPF, ETF, and PAYE calculated from each employee's basic salary. Posts the journal, tracks statutory balances, and generates payslips. Upgrade to unlock.",
    upgradeTo: "Growth",
  },
  approval_workflows: {
    title: "Approval workflows are on the Scale plan",
    description:
      "Route journals, expense claims, purchase orders and more through linear approval chains. Trigger by amount or submitter; route to roles or named users. Upgrade to unlock.",
    upgradeTo: "Scale",
  },
  supplier_portal: {
    title: "Supplier portal is on the Scale plan",
    description:
      "Give suppliers their own login to view POs, upload invoices, and track payment status. Upgrade to unlock.",
    upgradeTo: "Scale",
  },
  ai_bill_entry: {
    title: "AI bill entry is on the Growth plan",
    description:
      "Photograph a supplier invoice and PettahPro reads the vendor, date, amounts, and line items — trained on Sri Lankan invoice formats. Upgrade to unlock.",
    upgradeTo: "Growth",
  },
};
