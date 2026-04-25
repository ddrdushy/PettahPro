import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import type {
  ActiveAddon,
  AvailableAddon,
  AvailablePlan,
  TenantCouponRedemption,
  TenantSubscriptionResponse,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { PlanPickerClient } from "./plan-picker-client";
import { AddonsClient } from "./addons-client";
import { CouponsClient } from "./coupons-client";

export const metadata: Metadata = { title: "Change plan" };

const INTERNAL_API = process.env.INTERNAL_API_URL ?? "http://api:4000";

async function fetchPlans(): Promise<AvailablePlan[] | null> {
  const res = await fetch(`${INTERNAL_API}/subscription/plans`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { plans: AvailablePlan[] };
  return body.plans;
}

async function fetchSubscription(): Promise<TenantSubscriptionResponse | null> {
  const res = await fetch(`${INTERNAL_API}/subscription`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { subscription: TenantSubscriptionResponse };
  return body.subscription;
}

async function fetchAddons(): Promise<{
  catalog: AvailableAddon[];
  active: ActiveAddon[];
} | null> {
  const res = await fetch(`${INTERNAL_API}/subscription/addons`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as { catalog: AvailableAddon[]; active: ActiveAddon[] };
}

async function fetchCouponRedemptions(): Promise<TenantCouponRedemption[]> {
  const res = await fetch(`${INTERNAL_API}/subscription/coupons/mine`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { redemptions: TenantCouponRedemption[] };
  return body.redemptions;
}

export default async function PlanPickerPage() {
  const [plans, subscription, addons, couponRedemptions] = await Promise.all([
    fetchPlans(),
    fetchSubscription(),
    fetchAddons(),
    fetchCouponRedemptions(),
  ]);

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/settings" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to settings
        </Link>
      </div>

      <PageHeader
        eyebrow="Admin"
        title="Change plan"
        description="Pick the plan that matches how you work. Upgrades take effect immediately — you'll see new features the moment you switch. Downgrades apply to the next period; you keep whatever you've already used this cycle."
      />

      {!plans || !subscription ? (
        <p className="mt-6 text-body text-text-secondary">
          Couldn't load plans. Refresh the page, or contact support if this keeps happening.
        </p>
      ) : (
        <>
          <PlanPickerClient plans={plans} subscription={subscription} />
          {addons && (
            <AddonsClient
              initialCatalog={addons.catalog}
              initialActive={addons.active}
              currentPlanCode={subscription.plan.code}
            />
          )}
          <CouponsClient initialRedemptions={couponRedemptions} />
        </>
      )}
    </main>
  );
}
