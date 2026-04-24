import type { ReactNode } from "react";
import Link from "next/link";
import { Lock, ArrowRight } from "lucide-react";
import { getPlanFeatures, PLAN_GATE_COPY, type PlanGateFeature } from "@/lib/plan-features";

/**
 * Page-level plan gate (#68).
 *
 * The sidebar already renders plan-locked nav items with a padlock
 * (#67) so tenants can see what higher tiers unlock. But nothing stops
 * someone from bookmarking `/app/payroll` on a Starter tenant and
 * hitting the page directly — on the server the mutation routes 403,
 * but the GET endpoints aren't gated, so they'd see an empty table
 * with no explanation of why. Awful UX.
 *
 * This component wraps a page's content with a feature check. If the
 * tenant has the feature, children render as usual. If not, we swap
 * the entire page body for an upgrade card that mirrors the sidebar's
 * locked-state visual language and deep-links to /app/settings/plan.
 *
 * Used as a server component so the gate decision happens during the
 * page's own render — no client flash, no data-fetch waste. The
 * per-request cache in `getPlanFeatures()` means this doesn't add a
 * round trip on top of what AppLayout already fetches.
 */
export async function PlanFeatureGate({
  feature,
  children,
}: {
  feature: PlanGateFeature;
  children: ReactNode;
}) {
  const features = await getPlanFeatures();
  if (features.includes(feature)) return <>{children}</>;

  const copy = PLAN_GATE_COPY[feature];
  return (
    <main className="container-p py-10">
      <div className="mx-auto max-w-xl rounded-card border-hairline border-border bg-surface-elevated p-8 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
          <Lock className="h-5 w-5" aria-hidden />
        </div>
        <h1 className="mt-5 text-h2 text-charcoal">{copy.title}</h1>
        <p className="mx-auto mt-3 max-w-md text-body text-text-secondary">
          {copy.description}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link href="/app/settings/plan" className="btn-primary">
            See {copy.upgradeTo} plan
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link
            href="/app"
            className="text-small text-text-secondary hover:text-charcoal"
          >
            Back to overview
          </Link>
        </div>
      </div>
    </main>
  );
}
