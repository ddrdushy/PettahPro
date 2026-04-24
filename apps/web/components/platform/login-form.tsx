"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { PlatformApiError, platformApi } from "@/lib/platform-api";

// Two-step login for the platform console (#55).
//   Step 1 (default): email + password. If the account has MFA on, the
//     server returns { mfaRequired: true, challengeId } and NO session
//     cookie yet — we swap the form into the code-entry state.
//   Step 2 (mfa): 6-digit TOTP or a 10-char backup code. Server verifies
//     against the encrypted secret + hashed backup codes and then mints
//     the platform session.
// If the account has no MFA, step 1 mints the session directly and we
// skip step 2 entirely.

type Stage =
  | { kind: "password" }
  | { kind: "mfa"; challengeId: string; email: string };

export function PlatformLoginForm() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: "password" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmitPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    try {
      const res = await platformApi.login({
        email,
        password: String(form.get("password") ?? ""),
      });
      if ("mfaRequired" in res && res.mfaRequired) {
        setStage({ kind: "mfa", challengeId: res.challengeId, email });
        return;
      }
      router.push("/platform");
      router.refresh();
    } catch (err) {
      setError(loginErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitMfa(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (stage.kind !== "mfa") return;
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const code = String(form.get("code") ?? "").trim();
    try {
      await platformApi.loginMfa({ challengeId: stage.challengeId, code });
      router.push("/platform");
      router.refresh();
    } catch (err) {
      setError(mfaErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (stage.kind === "mfa") {
    return (
      <form onSubmit={onSubmitMfa} className="space-y-5" noValidate>
        <div className="rounded-md border border-white/10 bg-white/5 p-3 text-small text-white/80">
          Signing in as <span className="text-white">{stage.email}</span>. Enter the
          6-digit code from your authenticator app — or one of your backup codes.
        </div>
        <div>
          <label htmlFor="code" className="block text-small font-medium text-white/90">
            Authentication code
          </label>
          <input
            id="code"
            name="code"
            type="text"
            inputMode="text"
            autoComplete="one-time-code"
            autoFocus
            required
            maxLength={20}
            className="mt-1 block w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-body tracking-widest text-white placeholder:text-white/30 focus:border-mint focus:outline-none focus:ring-1 focus:ring-mint"
            placeholder="123 456"
          />
        </div>
        {error && (
          <div
            role="alert"
            className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-small text-red-200"
          >
            {error}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setStage({ kind: "password" });
              setError(null);
            }}
            className="text-small text-white/60 hover:text-white"
          >
            ← Back
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-mint px-4 py-2.5 text-body-lg font-medium text-charcoal transition-colors hover:bg-mint-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Verifying…
              </>
            ) : (
              "Verify"
            )}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmitPassword} className="space-y-5" noValidate>
      <div>
        <label htmlFor="email" className="block text-small font-medium text-white/90">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="mt-1 block w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-body text-white placeholder:text-white/30 focus:border-mint focus:outline-none focus:ring-1 focus:ring-mint"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-small font-medium text-white/90">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 block w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-body text-white placeholder:text-white/30 focus:border-mint focus:outline-none focus:ring-1 focus:ring-mint"
        />
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-small text-red-200"
        >
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={busy}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-mint px-4 py-2.5 text-body-lg font-medium text-charcoal transition-colors hover:bg-mint-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
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

function loginErrorMessage(err: unknown): string {
  if (!(err instanceof PlatformApiError)) return "Can't reach the API.";
  if (err.code === "INVALID_CREDENTIALS") return "Wrong email or password.";
  if (err.code === "RATE_LIMITED")
    return "Too many attempts. Wait a moment, then try again.";
  return err.message || "Something went wrong.";
}

function mfaErrorMessage(err: unknown): string {
  if (!(err instanceof PlatformApiError)) return "Can't reach the API.";
  if (err.code === "MFA_INVALID_CODE") return "Wrong code. Try again.";
  if (err.code === "MFA_CHALLENGE_EXPIRED")
    return "This sign-in attempt expired. Start again from email + password.";
  if (err.code === "RATE_LIMITED")
    return "Too many attempts. Wait a moment, then try again.";
  return err.message || "Something went wrong.";
}
