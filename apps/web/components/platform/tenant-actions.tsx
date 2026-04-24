"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PlatformApiError, platformApi } from "@/lib/platform-api";

export function TenantActions({
  tenantId,
  businessName,
  currentStatus,
}: {
  tenantId: string;
  businessName: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState<null | "suspend" | "reactivate">(null);
  const [reason, setReason] = useState("");

  const isSuspended = currentStatus === "suspended";

  async function doAction() {
    if (!showPrompt) return;
    if (reason.trim().length < 3) {
      setError("Add a short reason (minimum 3 characters).");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (showPrompt === "suspend") {
        await platformApi.suspendTenant(tenantId, { reason: reason.trim() });
      } else {
        await platformApi.reactivateTenant(tenantId, { reason: reason.trim() });
      }
      setShowPrompt(null);
      setReason("");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof PlatformApiError
          ? err.message || "Action failed."
          : "Could not reach the API.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {isSuspended ? (
          <button
            type="button"
            onClick={() => setShowPrompt("reactivate")}
            className="rounded-md border border-mint/40 bg-mint/10 px-3 py-1.5 text-small text-mint hover:bg-mint/20"
          >
            Reactivate
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setShowPrompt("suspend")}
            className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-small text-red-200 hover:bg-red-500/20"
          >
            Suspend
          </button>
        )}
      </div>

      {showPrompt && (
        <div
          role="dialog"
          aria-labelledby="action-heading"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-md rounded-card border border-white/10 bg-charcoal p-6 text-white">
            <h3 id="action-heading" className="text-h3">
              {showPrompt === "suspend" ? "Suspend" : "Reactivate"} {businessName}?
            </h3>
            <p className="mt-2 text-small text-white/70">
              {showPrompt === "suspend"
                ? "Blocks all logins for this tenant. Users see a support-contact message until you reactivate."
                : "Tenant users can sign in again immediately."}
            </p>
            <label
              htmlFor="reason"
              className="mt-6 block text-caption uppercase tracking-wide text-white/60"
            >
              Reason (required, logged in audit trail)
            </label>
            <textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={2000}
              className="mt-1 block w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-body text-white placeholder:text-white/30 focus:border-mint focus:outline-none"
              placeholder={
                showPrompt === "suspend"
                  ? "e.g. Non-payment beyond grace period"
                  : "e.g. Payment received 2026-04-24"
              }
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
                  setShowPrompt(null);
                  setError(null);
                  setReason("");
                }}
                className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-small text-white hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={doAction}
                className={`rounded-md px-4 py-2 text-small text-charcoal hover:opacity-90 disabled:opacity-60 ${
                  showPrompt === "suspend" ? "bg-red-300" : "bg-mint"
                }`}
              >
                {busy ? "Working…" : showPrompt === "suspend" ? "Suspend tenant" : "Reactivate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
