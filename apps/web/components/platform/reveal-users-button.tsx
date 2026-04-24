"use client";

import { useState } from "react";
import { PlatformApiError, platformApi, type TenantUser } from "@/lib/platform-api";

// Reveal-user-emails flow (#54 / gap L1). Anonymous by default; clicking
// "Reveal" prompts for a reason, then re-fetches the list with reveal=1.
// The API writes an audit row at the same moment, so every reveal is
// traceable to an admin + a reason.

export function RevealUsersButton({ tenantId }: { tenantId: string }) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<TenantUser[] | null>(null);

  async function doReveal() {
    if (reason.trim().length < 3) {
      setError("Add a short reason (minimum 3 characters).");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await platformApi.listTenantUsers(tenantId, {
        reveal: true,
        reason: reason.trim(),
      });
      setRevealed(res.users);
      setShowPrompt(false);
      // Replace the table in-place via a small DOM patch — avoids a
      // hard router.refresh() that would re-hydrate the whole page
      // and risk looping a refresh/reveal cycle.
      const table = document.getElementById("tenant-users-list");
      if (table) {
        const rows = res.users
          .map(
            (u) => `
              <tr>
                <td class="px-4 py-2 text-white/90">
                  ${u.email ?? u.anonymousLabel}
                  ${u.fullName ? `<div class="text-caption text-white/50">${u.fullName}</div>` : ""}
                </td>
                <td class="px-4 py-2 text-white/70">${u.isOwner ? "Owner" : "User"}</td>
                <td class="px-4 py-2 text-white/70">${
                  u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("en-GB") : "—"
                }</td>
                <td class="px-4 py-2 text-white/70">${u.isActive ? "Yes" : "No"}</td>
              </tr>`,
          )
          .join("");
        const tbody = table.querySelector("tbody");
        if (tbody) tbody.innerHTML = rows;
      }
    } catch (err) {
      setError(
        err instanceof PlatformApiError
          ? err.message || "Reveal failed."
          : "Could not reach the API.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (revealed) {
    return (
      <span className="rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-caption text-amber-200">
        Emails revealed · audited
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowPrompt(true)}
        className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-small text-white hover:bg-white/10"
      >
        Reveal emails
      </button>
      {showPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-card border border-white/10 bg-charcoal p-6 text-white">
            <h3 className="text-h3">Reveal user emails?</h3>
            <p className="mt-2 text-small text-white/70">
              The reveal action is logged against your account. Add a reference
              (ticket number, incident ID) so the audit trail is meaningful.
            </p>
            <label
              htmlFor="reveal-reason"
              className="mt-6 block text-caption uppercase tracking-wide text-white/60"
            >
              Reason
            </label>
            <input
              id="reveal-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={2000}
              className="mt-1 block w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-body text-white focus:border-mint focus:outline-none"
              placeholder="e.g. Ticket #1234"
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
                  setShowPrompt(false);
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
                onClick={doReveal}
                className="rounded-md bg-mint px-4 py-2 text-small text-charcoal hover:opacity-90 disabled:opacity-60"
              >
                {busy ? "Revealing…" : "Reveal"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
