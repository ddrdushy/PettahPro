"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, api, type TenantSubscriptionResponse } from "@/lib/api";

// Pause / resume card (#125 / pricing-spec §11.3). Shows current
// pause state if the subscription is paused; otherwise offers a
// "Pause subscription" button + optional resume-date picker.

function formatDate(s: string | null): string | null {
  if (!s) return null;
  try {
    return new Date(s).toLocaleDateString("en-LK", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return null;
  }
}

export function PauseClient({
  subscription,
}: {
  subscription: TenantSubscriptionResponse;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [resumeAt, setResumeAt] = useState("");

  const isPaused = subscription.status === "paused";
  const isCancelled = subscription.status === "cancelled";

  async function onPause() {
    if (reason.trim().length < 3) {
      setError("Pick a short reason (at least 3 characters).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.pauseMySubscription({
        reason: reason.trim(),
        resumeAt: resumeAt
          ? new Date(`${resumeAt}T00:00:00`).toISOString()
          : undefined,
      });
      router.refresh();
      setOpen(false);
      setReason("");
      setResumeAt("");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message || "Pause failed."
          : "Network error.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onResume() {
    if (
      !confirm(
        "Resume your subscription? Billing will start fresh from today; you won't be charged for the time you were paused.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.resumeMySubscription();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message || "Resume failed."
          : "Network error.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (isCancelled) return null; // Cancelled subs can't pause/resume

  if (isPaused) {
    return (
      <section className="mt-12 border-t border-border-subtle pt-10">
        <div className="rounded-card border border-amber-300 bg-amber-50/60 p-5">
          <h2 className="text-h2 text-text-primary">Subscription paused</h2>
          <p className="mt-1 text-body text-text-secondary">
            Billing is on hold. Your data is preserved but you can't use
            paid features until you resume.
          </p>
          {subscription.pause?.pausedAt && (
            <p className="mt-2 text-small text-text-secondary">
              Paused on {formatDate(subscription.pause.pausedAt)}.
              {subscription.pause.resumeAt &&
                ` Auto-resume scheduled for ${formatDate(subscription.pause.resumeAt)}.`}
            </p>
          )}
          {subscription.pause?.reason && (
            <p className="mt-1 text-small text-text-secondary italic">
              "{subscription.pause.reason}"
            </p>
          )}
          {error && (
            <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-small text-red-700">
              {error}
            </div>
          )}
          <button
            type="button"
            onClick={onResume}
            disabled={busy}
            className="btn-primary mt-4 text-small disabled:opacity-50"
          >
            {busy ? "Resuming…" : "Resume subscription"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-12 border-t border-border-subtle pt-10">
      <h2 className="text-h2 text-text-primary">Pause subscription</h2>
      <p className="mt-1 text-body text-text-secondary">
        Going on a seasonal break? Pause billing without losing your data.
        Up to 90 days; resume anytime.
      </p>

      {!open ? (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setError(null);
          }}
          className="btn-secondary mt-4 text-small"
        >
          Pause subscription
        </button>
      ) : (
        <div className="mt-4 max-w-2xl rounded-card border border-border-subtle bg-surface p-5">
          <div>
            <label
              htmlFor="pause-reason"
              className="block text-caption uppercase tracking-wide text-text-secondary"
            >
              Why are you pausing?
            </label>
            <input
              id="pause-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. monsoon off-season, store renovation"
              className="mt-1 w-full rounded-md border border-border-subtle bg-bg-base px-3 py-2 text-body text-text-primary"
            />
          </div>
          <div className="mt-4">
            <label
              htmlFor="resume-at"
              className="block text-caption uppercase tracking-wide text-text-secondary"
            >
              Auto-resume on (optional, max 90 days)
            </label>
            <input
              id="resume-at"
              type="date"
              value={resumeAt}
              onChange={(e) => setResumeAt(e.target.value)}
              className="mt-1 rounded-md border border-border-subtle bg-bg-base px-3 py-2 text-body text-text-primary"
            />
            <p className="mt-1 text-caption text-text-secondary">
              Leave blank to resume manually whenever you're ready.
            </p>
          </div>

          {error && (
            <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-small text-red-700">
              {error}
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="btn-secondary text-small"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onPause}
              disabled={busy}
              className="btn-primary text-small disabled:opacity-50"
            >
              {busy ? "Pausing…" : "Confirm pause"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
