"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Field } from "./field";

// #51 — two-step auth: after password succeeds, the API may return a
// challenge ID instead of a session. The form renders the MFA prompt
// inline (no page nav) so the browser never loses the "I just came
// from the login screen" state and the UX is one continuous flow.
export function LoginForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);

  async function onPasswordSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      const res = await api.login({
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? ""),
      });
      if ("mfaRequired" in res && res.mfaRequired) {
        setChallengeId(res.challengeId);
        return;
      }
      router.push("/app");
      router.refresh();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.code === "INVALID_CREDENTIALS"
            ? "Wrong email or password."
            : err.code === "RATE_LIMITED"
              ? "Too many sign-in attempts. Please wait a moment and try again."
              : err.message || "Something went wrong. Try again."
          : "Can't reach the server. Check your connection.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function onMfaSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!challengeId) return;
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const code = String(form.get("code") ?? "").trim();
    try {
      await api.loginMfa({ challengeId, code });
      router.push("/app");
      router.refresh();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.code === "MFA_CHALLENGE_EXPIRED"
            ? "This sign-in attempt expired. Please enter your password again."
            : err.code === "MFA_INVALID_CODE"
              ? "Wrong code. Try again."
              : err.code === "RATE_LIMITED"
                ? "Too many attempts. Wait a moment and try again."
                : err.message || "Something went wrong. Try again."
          : "Can't reach the server. Check your connection.";
      setError(msg);
      // Expired challenges bounce the user back to the password
      // step. No point keeping the code input live when the server
      // has forgotten the challenge.
      if (err instanceof ApiError && err.code === "MFA_CHALLENGE_EXPIRED") {
        setChallengeId(null);
      }
    } finally {
      setBusy(false);
    }
  }

  if (challengeId) {
    return (
      <form onSubmit={onMfaSubmit} className="space-y-5" noValidate>
        <div className="rounded-md border-hairline border-border bg-surface p-3 text-small text-text-secondary">
          Enter the 6-digit code from your authenticator app. Lost your phone? Paste one of your backup codes instead.
        </div>
        <Field
          label="Authentication code"
          type="text"
          name="code"
          inputMode="text"
          autoComplete="one-time-code"
          autoFocus
          required
          maxLength={20}
          placeholder="123 456"
        />

        {error && (
          <div
            role="alert"
            className="rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-3 text-small text-danger"
          >
            {error}
          </div>
        )}

        <button type="submit" disabled={busy} className="btn-primary w-full text-body-lg">
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Verifying…
            </>
          ) : (
            "Verify"
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setChallengeId(null);
            setError(null);
          }}
          className="block w-full text-small text-text-secondary underline-offset-4 hover:underline"
        >
          Back to sign in
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onPasswordSubmit} className="space-y-5" noValidate>
      <Field
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        required
        placeholder="you@business.lk"
      />
      <Field
        label="Password"
        type="password"
        name="password"
        autoComplete="current-password"
        required
      />

      {error && (
        <div
          role="alert"
          className="rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-3 text-small text-danger"
        >
          {error}
        </div>
      )}

      <button type="submit" disabled={busy} className="btn-primary w-full text-body-lg">
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Signing in…
          </>
        ) : (
          "Sign in"
        )}
      </button>
    </form>
  );
}
