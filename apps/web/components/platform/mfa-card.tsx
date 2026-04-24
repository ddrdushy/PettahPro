"use client";

// #55 / gap L1 v1 — Platform console MFA management card.
//
// Mirror of apps/web/app/app/settings/security/security-client.tsx, but
// restyled for the platform console's dark theme and wired to the
// platformApi.mfa* endpoints (see lib/platform-api.ts).
//
// State machine:
//   "loading"    → fetching initial status
//   "idle"       → card showing either "not enrolled" or "enabled"
//   "enrolling"  → QR + secret + code input
//   "codes"      → one-time backup codes (shown once)
//   "disabling"  → code input to confirm disable
//
// Backup codes are displayed exactly once. If the user bounces before
// copying, they rotate by disabling + re-enrolling. This matches the
// tenant-side invariant and the API contract (hashed on write).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import {
  PlatformApiError,
  platformApi,
  type PlatformMfaStatus,
} from "@/lib/platform-api";

type Mode = "loading" | "idle" | "enrolling" | "codes" | "disabling";

interface EnrolData {
  tempToken: string;
  otpauthUri: string;
  secret: string;
  qrCodeDataUrl: string | null;
}

function formatTimestamp(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return null;
  }
}

export function PlatformMfaCard() {
  const router = useRouter();
  const [status, setStatus] = useState<PlatformMfaStatus | null>(null);
  const [mode, setMode] = useState<Mode>("loading");
  const [enrol, setEnrol] = useState<EnrolData | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await platformApi.mfaStatus();
        if (cancelled) return;
        setStatus(s);
        setMode("idle");
      } catch {
        if (cancelled) return;
        // Fall back to "not enrolled" display rather than a hard error —
        // the user can still retry via the Enable button.
        setStatus({
          enabled: false,
          enrolledAt: null,
          lastUsedAt: null,
          backupCodesRemaining: 0,
        });
        setMode("idle");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function beginEnrol() {
    setError(null);
    setBusy(true);
    try {
      const res = await platformApi.mfaEnroll();
      setEnrol(res);
      setCode("");
      setMode("enrolling");
    } catch (err) {
      setError(toMessage(err, "Couldn't start enrolment. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrol() {
    if (!enrol) return;
    setError(null);
    setBusy(true);
    try {
      const res = await platformApi.mfaEnrollVerify({
        tempToken: enrol.tempToken,
        code,
      });
      setBackupCodes(res.backupCodes);
      setMode("codes");
      router.refresh();
    } catch (err) {
      setError(toMessage(err, "That code didn't match. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDisable() {
    setError(null);
    setBusy(true);
    try {
      await platformApi.mfaDisable({ code });
      setStatus({
        enabled: false,
        enrolledAt: null,
        lastUsedAt: null,
        backupCodesRemaining: 0,
      });
      setMode("idle");
      setCode("");
      router.refresh();
    } catch (err) {
      setError(toMessage(err, "That code didn't match. Try again."));
    } finally {
      setBusy(false);
    }
  }

  function finishCodes() {
    setMode("idle");
    setEnrol(null);
    setBackupCodes([]);
    setStatus({
      enabled: true,
      enrolledAt: new Date().toISOString(),
      lastUsedAt: null,
      backupCodesRemaining: 10,
    });
  }

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(backupCodes.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — user can still select-and-copy */
    }
  }

  // ---------------------------------------------------------------
  // Renders
  // ---------------------------------------------------------------

  if (mode === "loading" || status === null) {
    return (
      <section className="rounded-card border border-white/10 bg-black/20 p-6">
        <h2 className="text-h3 text-white">Two-factor authentication</h2>
        <p className="mt-2 flex items-center gap-2 text-small text-white/60">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
        </p>
      </section>
    );
  }

  if (mode === "codes") {
    return (
      <section className="rounded-card border border-white/10 bg-black/20 p-6">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-1 h-5 w-5 text-mint" aria-hidden />
          <div>
            <h2 className="text-h3 text-white">
              Two-factor is on. Save your backup codes.
            </h2>
            <p className="mt-2 text-small text-white/70">
              Each code works once. If you lose your phone, use one of these to
              sign in — then re-enable 2FA. Store them in a password manager or
              somewhere only you can reach. We won't show them again.
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 font-mono text-small text-white">
          {backupCodes.map((c) => (
            <div
              key={c}
              className="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-center tracking-wider"
            >
              {c}
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={copyCodes}
            className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-4 py-2 text-small text-white hover:bg-white/10"
          >
            <Copy className="h-4 w-4" aria-hidden /> {copied ? "Copied!" : "Copy all"}
          </button>
          <button
            type="button"
            onClick={finishCodes}
            className="rounded-md bg-mint px-4 py-2 text-small text-charcoal hover:opacity-90"
          >
            I've saved them
          </button>
        </div>
      </section>
    );
  }

  if (mode === "enrolling" && enrol) {
    return (
      <section className="rounded-card border border-white/10 bg-black/20 p-6">
        <h2 className="text-h3 text-white">Scan and confirm</h2>
        <p className="mt-1 text-small text-white/70">
          Open your authenticator app and either scan the QR or paste the
          secret. Then enter the 6-digit code it shows to confirm.
        </p>

        <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-start">
          {enrol.qrCodeDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={enrol.qrCodeDataUrl}
              alt="TOTP QR code"
              className="h-40 w-40 shrink-0 rounded-md border border-white/10 bg-white p-2"
            />
          ) : (
            <div className="flex h-40 w-40 shrink-0 items-center justify-center rounded-md border border-white/10 bg-black/40 text-caption text-white/50">
              QR unavailable — paste the secret.
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-small font-medium text-white">Manual entry secret</p>
            <code className="mt-1 block break-all rounded-md border border-white/10 bg-black/40 px-3 py-2 font-mono text-small text-white">
              {enrol.secret}
            </code>
            <p className="mt-3 text-caption text-white/50">
              If the app asks: 6 digits, 30-second refresh, SHA1.
            </p>
          </div>
        </div>

        <div className="mt-5">
          <label htmlFor="mfa-code" className="block text-small font-medium text-white/90">
            6-digit code from your app
          </label>
          <input
            id="mfa-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={10}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123 456"
            className="mt-1.5 block w-full max-w-xs rounded-md border border-white/10 bg-black/30 px-3 py-2 text-body tracking-widest text-white focus:border-mint focus:outline-none focus:ring-1 focus:ring-mint"
          />
        </div>

        {error && (
          <p role="alert" className="mt-3 text-small text-red-300">
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            disabled={busy || code.replace(/\s/g, "").length < 6}
            onClick={confirmEnrol}
            className="inline-flex items-center gap-2 rounded-md bg-mint px-4 py-2 text-small text-charcoal hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Verifying…
              </>
            ) : (
              "Turn on 2FA"
            )}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setMode("idle");
              setEnrol(null);
              setCode("");
              setError(null);
            }}
            className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-small text-white hover:bg-white/10"
          >
            Cancel
          </button>
        </div>
      </section>
    );
  }

  if (mode === "disabling") {
    return (
      <section className="rounded-card border border-white/10 bg-black/20 p-6">
        <div className="flex items-start gap-3">
          <ShieldOff className="mt-1 h-5 w-5 text-red-400" aria-hidden />
          <div>
            <h2 className="text-h3 text-white">Turn off two-factor?</h2>
            <p className="mt-1 text-small text-white/70">
              Enter a current code from your authenticator (or a backup code)
              to confirm. We ask for this on top of your session so a stolen
              laptop can't disarm 2FA silently.
            </p>
          </div>
        </div>

        <div className="mt-5">
          <label
            htmlFor="disable-code"
            className="block text-small font-medium text-white/90"
          >
            Code
          </label>
          <input
            id="disable-code"
            type="text"
            inputMode="text"
            autoComplete="one-time-code"
            maxLength={20}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123 456"
            className="mt-1.5 block w-full max-w-xs rounded-md border border-white/10 bg-black/30 px-3 py-2 text-body tracking-widest text-white focus:border-mint focus:outline-none focus:ring-1 focus:ring-mint"
          />
        </div>

        {error && (
          <p role="alert" className="mt-3 text-small text-red-300">
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            disabled={busy || code.length < 1}
            onClick={confirmDisable}
            className="inline-flex items-center gap-2 rounded-md bg-red-500/80 px-4 py-2 text-small text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Disabling…
              </>
            ) : (
              "Turn off 2FA"
            )}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setMode("idle");
              setCode("");
              setError(null);
            }}
            className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-small text-white hover:bg-white/10"
          >
            Cancel
          </button>
        </div>
      </section>
    );
  }

  // idle
  const enrolledAt = formatTimestamp(status.enrolledAt);
  const lastUsedAt = formatTimestamp(status.lastUsedAt);

  return (
    <section className="rounded-card border border-white/10 bg-black/20 p-6">
      {status.enabled ? (
        <>
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-1 h-5 w-5 text-mint" aria-hidden />
            <div className="min-w-0 flex-1">
              <h2 className="text-h3 text-white">Two-factor is on</h2>
              <p className="mt-1 text-small text-white/70">
                Sign-in asks for a 6-digit code after your password.
              </p>
              <dl className="mt-3 space-y-1 text-small text-white/80">
                {enrolledAt && (
                  <div className="flex gap-3">
                    <dt className="text-white/50">Enabled</dt>
                    <dd>{enrolledAt}</dd>
                  </div>
                )}
                {lastUsedAt && (
                  <div className="flex gap-3">
                    <dt className="text-white/50">Last used</dt>
                    <dd>{lastUsedAt}</dd>
                  </div>
                )}
                <div className="flex gap-3">
                  <dt className="text-white/50">Backup codes left</dt>
                  <dd>
                    {status.backupCodesRemaining}
                    {status.backupCodesRemaining <= 3 &&
                      status.backupCodesRemaining > 0 && (
                        <span className="ml-2 text-caption text-red-300">
                          Low — consider rotating (disable, then re-enable).
                        </span>
                      )}
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="mt-5">
            <button
              type="button"
              onClick={() => {
                setMode("disabling");
                setCode("");
                setError(null);
              }}
              className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-small text-white hover:bg-white/10"
            >
              Turn off 2FA…
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-1 h-5 w-5 text-white/40" aria-hidden />
            <div>
              <h2 className="text-h3 text-white">
                Add a second step to sign-in
              </h2>
              <p className="mt-1 text-small text-white/70">
                Platform operators have access to every tenant — 2FA is
                strongly recommended. You'll need an authenticator app
                (Google Authenticator, 1Password, Authy, Bitwarden, or
                similar).
              </p>
            </div>
          </div>

          {error && (
            <p role="alert" className="mt-3 text-small text-red-300">
              {error}
            </p>
          )}

          <div className="mt-5">
            <button
              type="button"
              disabled={busy}
              onClick={beginEnrol}
              className="inline-flex items-center gap-2 rounded-md bg-mint px-4 py-2 text-small text-charcoal hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />{" "}
                  Preparing…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" aria-hidden /> Enable
                  two-factor
                </>
              )}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function toMessage(err: unknown, fallback: string): string {
  if (err instanceof PlatformApiError) {
    if (err.code === "MFA_INVALID_CODE") return "That code didn't match. Try again.";
    if (err.code === "MFA_ENROLL_EXPIRED")
      return "Enrolment timed out. Please start again.";
    if (err.code === "MFA_ALREADY_ENABLED")
      return "2FA is already on. Disable it first to re-enrol.";
    if (err.code === "RATE_LIMITED")
      return "Too many attempts. Wait a moment and try again.";
    if (err.code === "UNAUTHENTICATED")
      return "Your session expired. Sign in again.";
    return err.message || fallback;
  }
  return fallback;
}
