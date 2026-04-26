"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  CircleDashed,
  Sparkles,
  X,
  Loader2,
} from "lucide-react";
import { api, type OnboardingChecklist } from "@/lib/api";

// #I2 / gaps I2 — Get-Started checklist. Drops onto the dashboard for
// new tenants. Self-healing: each step is computed from real tenant
// state on every fetch (server side), so adding a customer ticks the
// box automatically; deleting them all un-ticks it. The only persisted
// bit is "dismissed" — the tenant can restore from settings.

export function OnboardingChecklistCard({
  initial,
}: {
  initial: OnboardingChecklist;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Hide once dismissed OR every required step is done. The "all done"
  // case auto-suppresses without a dismiss click — the user has built
  // out the system, the panel has done its job.
  if (initial.dismissed || initial.allDone) {
    return null;
  }

  async function handleDismiss() {
    setBusy(true);
    try {
      await api.dismissOnboarding();
      router.refresh();
    } catch {
      // Worst case: the panel keeps rendering. The user can click
      // dismiss again. Not worth a toast.
    } finally {
      setBusy(false);
    }
  }

  const progress =
    initial.totalRequired > 0
      ? Math.round((initial.completedRequired / initial.totalRequired) * 100)
      : 0;

  return (
    <section className="mb-8 rounded-card border-hairline border-mint/40 bg-mint-surface/30 p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Sparkles
            className="mt-0.5 h-5 w-5 shrink-0 text-mint-dark"
            aria-hidden
          />
          <div>
            <p className="text-small font-medium text-charcoal">
              Get started with PettahPro
            </p>
            <p className="mt-1 text-caption text-text-secondary">
              {initial.completedRequired} of {initial.totalRequired} essentials
              done. Walk through the rest to get your books running.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={busy}
          className="rounded-md p-1 text-text-tertiary hover:bg-mint-surface/40 hover:text-charcoal disabled:opacity-50"
          title="Hide for now (restore from settings later)"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <X className="h-4 w-4" aria-hidden />
          )}
        </button>
      </header>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-mint-surface/60">
        <div
          className="h-full rounded-full bg-mint transition-all"
          style={{ width: `${progress}%` }}
          aria-label={`${progress}% complete`}
        />
      </div>

      <ul className="mt-4 space-y-2">
        {initial.steps.map((step) => (
          <li key={step.key}>
            <Link
              href={step.deepLinkPath}
              className={`group flex items-start gap-3 rounded-md border-hairline border-transparent px-3 py-2 transition hover:border-mint/40 hover:bg-mint-surface/40 ${
                step.complete ? "opacity-70" : ""
              }`}
            >
              <span className="mt-0.5 shrink-0">
                {step.complete ? (
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-mint">
                    <Check
                      className="h-3 w-3 text-white"
                      strokeWidth={3}
                      aria-hidden
                    />
                  </span>
                ) : (
                  <CircleDashed
                    className="h-5 w-5 text-text-tertiary"
                    aria-hidden
                  />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-small font-medium ${
                    step.complete
                      ? "text-text-secondary line-through"
                      : "text-charcoal"
                  }`}
                >
                  {step.label}
                  {step.optional && (
                    <span className="ml-2 rounded-full bg-surface-recessed px-2 py-0.5 align-middle text-caption font-normal text-text-tertiary">
                      Optional
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-caption text-text-secondary">
                  {step.description}
                </p>
              </div>
              {!step.complete && (
                <ArrowRight
                  className="mt-1 h-4 w-4 shrink-0 text-mint-dark opacity-0 transition group-hover:opacity-100"
                  aria-hidden
                />
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
