"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertCircle, Clock, X } from "lucide-react";
import type { TenantSubscriptionResponse } from "@/lib/api";

/**
 * App-wide trial / grace banner (#70).
 *
 * #63 shipped the trial expiry + grace machinery server-side; the
 * tenant can see their state on `/settings/plan` but nowhere else.
 * The net effect was that a tenant whose trial ends tomorrow gets no
 * nudge while using the product — they have to go looking. This
 * banner puts the countdown above the header on every /app page so
 * conversion conversations happen on their own.
 *
 * Four render branches driven by `status`:
 *
 *   - trial, > 3 days    → mint info banner, dismissible for the day
 *   - trial, <= 3 days   → amber warning, NOT dismissible (too close)
 *   - past_due           → orange grace-period warning, NOT dismissible
 *   - cancelled          → red terminal banner, NOT dismissible
 *   - active (or null)   → renders nothing
 *
 * Dismiss-for-the-day: localStorage key `pp_trial_banner_dismissed_*`
 * keyed by today's YYYY-MM-DD. Tomorrow the banner reappears. We don't
 * hide it forever — the point is to make the trial status impossible
 * to forget, not impossible to close.
 *
 * Rendered by the server layout with data already in hand from the
 * cached /subscription fetch — no extra client round trip. The "days
 * remaining" number is computed client-side off the ISO dates so a
 * tenant who leaves a tab open overnight sees the countdown tick.
 */
export function TrialStatusBanner({
  subscription,
}: {
  // Full subscription shape or null. Null = unknown state, render
  // nothing (layout already falls back to an empty feature list in
  // that case per #67's safe-default policy).
  subscription: TenantSubscriptionResponse | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState(false);

  // Recompute remaining days once an hour — enough for the tab-left-
  // open case without burning a timer unnecessarily. Trial ticks are
  // day-granular, so per-second updates (like the impersonation
  // banner) would be wasted work.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Restore today's dismissal on mount. Using a per-day key means we
  // never need a cleanup job — stale keys just sit unread.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = dismissKey();
    if (window.localStorage.getItem(key) === "1") setDismissed(true);
  }, []);

  if (!subscription) return null;
  if (subscription.status === "active") return null;

  const state = deriveState(subscription, now);
  if (!state) return null;

  // Only the low-urgency "you have lots of time" variant can be
  // dismissed. Any warning/terminal state stays pinned.
  if (state.dismissible && dismissed) return null;

  const tone = TONE[state.variant];

  return (
    <div
      role="status"
      className={`border-b-hairline ${tone.container}`}
      data-testid="trial-status-banner"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2 text-small">
        <div className="flex items-center gap-2">
          {state.variant === "info" ? (
            <Clock className={`h-4 w-4 shrink-0 ${tone.icon}`} aria-hidden />
          ) : (
            <AlertCircle
              className={`h-4 w-4 shrink-0 ${tone.icon}`}
              aria-hidden
            />
          )}
          <span className={tone.text}>{state.message}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/app/settings/plan"
            className={`rounded-full px-3 py-0.5 text-caption font-medium ${tone.cta}`}
          >
            {state.ctaLabel}
          </Link>
          {state.dismissible && (
            <button
              type="button"
              aria-label="Dismiss for today"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.localStorage.setItem(dismissKey(), "1");
                }
                setDismissed(true);
              }}
              className={`rounded-full p-1 ${tone.dismiss}`}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Tone palette indexed by variant. Inline map rather than dynamic
// classnames so Tailwind's JIT doesn't miss any (the whole set shows
// up in source as string literals).
const TONE = {
  info: {
    container: "border-mint bg-mint-surface",
    icon: "text-mint-dark",
    text: "text-charcoal",
    cta: "bg-charcoal text-white hover:bg-charcoal/90",
    dismiss: "text-text-secondary hover:bg-black/5",
  },
  warning: {
    container: "border-warning bg-warning-bg",
    icon: "text-warning",
    text: "text-charcoal",
    cta: "bg-charcoal text-white hover:bg-charcoal/90",
    dismiss: "text-text-secondary hover:bg-black/5",
  },
  danger: {
    container: "border-red-500 bg-red-600",
    icon: "text-white",
    text: "text-white",
    cta: "bg-white text-red-700 hover:bg-white/90",
    dismiss: "text-white/90 hover:bg-black/15",
  },
} as const;

type BannerState = {
  variant: "info" | "warning" | "danger";
  message: string;
  ctaLabel: string;
  dismissible: boolean;
};

function deriveState(
  sub: TenantSubscriptionResponse,
  now: number,
): BannerState | null {
  if (sub.status === "trial") {
    const ends = sub.trialEndsAt ? new Date(sub.trialEndsAt).getTime() : null;
    if (ends === null) return null;
    const days = daysUntil(ends, now);
    if (days <= 0) {
      // Trial technically expired but status hasn't flipped yet (the
      // cron runs daily — there's a window between expiry and
      // past_due). Treat as urgent.
      return {
        variant: "warning",
        message: `Your trial ends today. Upgrade to keep using ${sub.plan.name}.`,
        ctaLabel: "Choose a plan",
        dismissible: false,
      };
    }
    if (days <= 3) {
      return {
        variant: "warning",
        message: `Your trial ends in ${days} day${days === 1 ? "" : "s"}. Upgrade to keep your data and team seats.`,
        ctaLabel: "Choose a plan",
        dismissible: false,
      };
    }
    return {
      variant: "info",
      message: `${days} days left in your ${sub.plan.name} trial.`,
      ctaLabel: "See plans",
      dismissible: true,
    };
  }

  if (sub.status === "past_due") {
    // Two reasons to be past_due:
    //   1. Trial expired (#63 grace window) — consecutiveFailedAttempts is 0
    //   2. Subscription charge failed (L2 dunning) — counter > 0
    // Different messaging for each. Trial-expiry message is the
    // existing one; dunning message tells the tenant their next retry
    // and when to update their payment method.
    const isDunning = (sub.consecutiveFailedAttempts ?? 0) > 0;
    if (isDunning) {
      const nextRetry = sub.nextChargeAttemptAt
        ? new Date(sub.nextChargeAttemptAt)
        : null;
      const retryStr = nextRetry
        ? nextRetry.toLocaleDateString("en-LK", {
            day: "2-digit",
            month: "short",
          })
        : "soon";
      return {
        variant: "warning",
        message: `Your last payment failed. We'll retry on ${retryStr} — please update your payment method to avoid service disruption.`,
        ctaLabel: "Update payment",
        dismissible: false,
      };
    }
    const graceEnds = new Date(sub.currentPeriodEnd).getTime();
    const days = daysUntil(graceEnds, now);
    return {
      variant: "warning",
      message:
        days > 0
          ? `Your trial ended. Your data stays editable for ${days} more day${days === 1 ? "" : "s"} — upgrade now to avoid disruption.`
          : "Your grace period has ended. Upgrade now to restore full access.",
      ctaLabel: "Choose a plan",
      dismissible: false,
    };
  }

  if (sub.status === "cancelled") {
    return {
      variant: "danger",
      message:
        "Your subscription is cancelled. Contact support to reactivate.",
      ctaLabel: "See plans",
      dismissible: false,
    };
  }

  return null;
}

function daysUntil(futureMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((futureMs - nowMs) / (1000 * 60 * 60 * 24)));
}

function dismissKey(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `pp_trial_banner_dismissed_${today}`;
}
