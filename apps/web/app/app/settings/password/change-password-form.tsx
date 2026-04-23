"use client";

// #49 — change own password. Calls POST /auth/change-password, which:
//  * verifies the current password,
//  * validates the new password against the server-side policy + HIBP,
//  * updates the hash,
//  * destroys every session for this user (so an attacker with a
//    parallel session is booted) and mints a fresh session for this
//    tab (so the user stays signed in here).
//
// The same ApiError.reasons plumbing used by signup surfaces the
// WEAK_PASSWORD reasons inline under the error banner.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { PasswordStrengthHint } from "@/components/auth/password-strength-hint";

export function ChangePasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<string[] | null>(null);
  const [ok, setOk] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setReasons(null);
    setOk(false);

    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match.");
      return;
    }

    setBusy(true);
    try {
      await api.changePassword({ currentPassword, newPassword });
      setOk(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      // Refresh so any stale server-rendered state (unlikely here, but
      // harmless) is reloaded under the new session cookie.
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "WEAK_PASSWORD") {
          setError(err.message || "New password doesn't meet policy.");
          setReasons(err.reasons && err.reasons.length > 0 ? err.reasons : null);
        } else if (err.code === "WRONG_CURRENT_PASSWORD") {
          setError("Current password didn't match.");
        } else if (err.code === "RATE_LIMITED") {
          setError("Too many attempts. Please wait a few minutes.");
        } else if (err.code === "UNAUTHENTICATED") {
          setError("Your session expired. Sign in and try again.");
        } else {
          setError(err.message || "Something went wrong. Try again.");
        }
      } else {
        setError("Can't reach the server. Check your connection.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div>
        <label htmlFor="currentPassword" className="block text-small font-medium text-charcoal">
          Current password
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="mt-1.5 block w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
        />
      </div>
      <div>
        <label htmlFor="newPassword" className="block text-small font-medium text-charcoal">
          New password
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="mt-1.5 block w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
        />
        <div className="mt-2">
          <PasswordStrengthHint password={newPassword} />
        </div>
      </div>
      <div>
        <label htmlFor="confirmPassword" className="block text-small font-medium text-charcoal">
          Confirm new password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="mt-1.5 block w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
        />
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-3 text-small text-danger"
        >
          <p>{error}</p>
          {reasons && reasons.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-small text-danger/90">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {ok && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border-hairline border-mint/40 bg-mint-surface/60 p-3 text-small text-mint-dark"
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          Password changed. Other sessions for your account were signed out.
        </div>
      )}

      <button type="submit" disabled={busy} className="btn-primary text-body">
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Changing password…
          </>
        ) : (
          "Change password"
        )}
      </button>
    </form>
  );
}
