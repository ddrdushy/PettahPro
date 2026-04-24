"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  PlatformApiError,
  platformApi,
  type PlatformImpersonationRequest,
  type PlatformImpersonationSession,
} from "@/lib/platform-api";

/**
 * Client-side action buttons for /platform/impersonation (#57).
 *
 * Two kinds of action:
 *   - Start: only the requesting platform user can start their own
 *     approved request. On success the API sets pp_session on /, we
 *     navigate to /app so the admin lands inside the tenant with the
 *     red impersonation banner. The platform cookie (pp_platform_session,
 *     path=/platform) stays untouched — opening a new platform tab later
 *     still works.
 *   - End: super_admin can end any session; support only their own.
 *     Owner can also end from the tenant side (/settings/security) but
 *     that lives in a different component.
 */
export function StartImpersonationButton({
  requestId,
}: {
  requestId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setError(null);
    setBusy(true);
    try {
      await platformApi.startImpersonation(requestId);
      // Tenant cookie is now set. Hard navigate — we're crossing cookie
      // realms and want a clean document load inside /app.
      window.location.href = "/app";
    } catch (err) {
      setError(
        err instanceof PlatformApiError
          ? err.message || "Could not start session."
          : "Could not reach the API.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={go}
        className="rounded-md bg-mint px-3 py-1.5 text-small font-medium text-charcoal hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "Starting…" : "Start session"}
      </button>
      {error && (
        <span className="text-caption text-red-300">{error}</span>
      )}
    </div>
  );
}

export function EndImpersonationButton({
  sessionId,
}: {
  sessionId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function end() {
    if (reason.trim().length < 5) {
      setError("Give a short reason for the audit trail.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await platformApi.endImpersonationSession(sessionId, {
        reason: reason.trim(),
      });
      setOpen(false);
      setReason("");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof PlatformApiError
          ? err.message || "Could not end session."
          : "Could not reach the API.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-red-400/40 bg-red-400/10 px-3 py-1.5 text-small text-red-200 hover:bg-red-400/20"
      >
        End session
      </button>

      {open && (
        <div
          role="dialog"
          aria-labelledby="end-imp-heading"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-md rounded-card border border-white/10 bg-charcoal p-6 text-white">
            <h3 id="end-imp-heading" className="text-h3">
              End impersonation session
            </h3>
            <p className="mt-2 text-small text-white/70">
              The operator is kicked out of the tenant immediately. Both the
              platform audit log and the tenant's audit trail capture this.
            </p>
            <label
              htmlFor="end-reason"
              className="mt-5 block text-caption uppercase tracking-wide text-white/60"
            >
              Reason
            </label>
            <textarea
              id="end-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              className="mt-1 block w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-body text-white focus:border-mint focus:outline-none"
              placeholder="e.g. Investigation complete, closing early."
            />
            {error && (
              <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-small text-red-200">
                {error}
              </div>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setReason("");
                  setError(null);
                }}
                className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-small text-white hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={end}
                className="rounded-md bg-red-400 px-4 py-2 text-small font-medium text-charcoal hover:opacity-90 disabled:opacity-60"
              >
                {busy ? "Ending…" : "End session"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Exported just so the parent server component's type references line up —
 * nothing reads these props, but keeping them exported prevents accidental
 * "unused type" regressions in the /platform-api module.
 */
export type {
  PlatformImpersonationRequest,
  PlatformImpersonationSession,
};
