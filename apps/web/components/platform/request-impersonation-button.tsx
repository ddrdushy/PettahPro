"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlatformApiError, platformApi } from "@/lib/platform-api";

/**
 * "Request impersonation" CTA on /platform/tenants/:id (#57 / gap L1 v1).
 *
 * Opens a modal that captures (requestedMinutes, reason) and submits.
 * Nothing happens inside the tenant until the tenant's Owner approves
 * — the UX here reinforces that: success message is "waiting for
 * owner to approve," not "you're in."
 *
 * Visible only to super_admin + support (the parent page gates with
 * `canReveal`). Billing sees nothing.
 */
export function RequestImpersonationButton({
  tenantId,
  businessName,
}: {
  tenantId: string;
  businessName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState<15 | 30 | 60>(30);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function submit() {
    if (reason.trim().length < 10) {
      setError("Tell the owner why you need access (min 10 characters).");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await platformApi.createImpersonationRequest(tenantId, {
        requestedMinutes: minutes,
        reason: reason.trim(),
      });
      setOk(true);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof PlatformApiError
          ? err.message || "Request failed."
          : "Could not reach the API.",
      );
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setOk(false);
    setError(null);
    setReason("");
    setMinutes(30);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-small text-amber-200 hover:bg-amber-400/20"
      >
        Request impersonation
      </button>

      {open && (
        <div
          role="dialog"
          aria-labelledby="impersonation-heading"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-lg rounded-card border border-white/10 bg-charcoal p-6 text-white">
            <h3 id="impersonation-heading" className="text-h3">
              Request impersonation — {businessName}
            </h3>
            <p className="mt-2 text-small text-white/70">
              The tenant owner is notified immediately. Nothing happens inside
              their books until they approve. You'll see the approved request
              on <span className="font-medium">/platform/impersonation</span>.
            </p>

            {ok ? (
              <div className="mt-6 rounded-md border border-mint/40 bg-mint/10 p-4 text-small text-mint">
                Request sent. Waiting for the owner to approve.
              </div>
            ) : (
              <>
                <fieldset className="mt-6">
                  <legend className="text-caption uppercase tracking-wide text-white/60">
                    Duration
                  </legend>
                  <div className="mt-2 flex gap-2">
                    {([15, 30, 60] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMinutes(m)}
                        className={`rounded-md border px-4 py-2 text-small ${
                          minutes === m
                            ? "border-mint bg-mint/20 text-mint"
                            : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                        }`}
                      >
                        {m} min
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-caption text-white/50">
                    Owner can shorten this when they approve.
                  </p>
                </fieldset>

                <label
                  htmlFor="imp-reason"
                  className="mt-6 block text-caption uppercase tracking-wide text-white/60"
                >
                  Reason (shown to owner, logged in audit trail)
                </label>
                <textarea
                  id="imp-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  className="mt-1 block w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-body text-white placeholder:text-white/30 focus:border-mint focus:outline-none"
                  placeholder="e.g. Ticket #1234 — user reports invoice PDFs not rendering; need to reproduce."
                />

                {error && (
                  <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-small text-red-200">
                    {error}
                  </div>
                )}
              </>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={close}
                className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-small text-white hover:bg-white/10"
              >
                {ok ? "Close" : "Cancel"}
              </button>
              {!ok && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={submit}
                  className="rounded-md bg-amber-300 px-4 py-2 text-small text-charcoal hover:opacity-90 disabled:opacity-60"
                >
                  {busy ? "Sending…" : "Send request"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
