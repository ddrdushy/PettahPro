"use client";

// Roadmap #51 — two-factor (TOTP) enrol + disable UI.
//
// State machine:
//   "idle"         → card showing either "not enrolled" (button: Enable)
//                     or "enabled" (button: Disable).
//   "enrolling"    → QR + secret + code input (after clicking Enable).
//                     Submit verifies the code and advances to "codes".
//   "codes"        → one-time backup codes displayed. User must confirm
//                     they've saved them before returning to idle.
//   "disabling"    → code input prompt for disable confirmation.
//
// Why we show backup codes only once: plaintext codes live in the DB
// only during this render, and only as hashes after that. If the user
// bounces before copying them, they can rotate by disabling and
// re-enrolling — that's a deliberate "no silent second chance" policy.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { api, ApiError } from "@/lib/api";

export interface MfaStatus {
  enabled: boolean;
  enrolledAt: string | null;
  lastUsedAt: string | null;
  backupCodesRemaining: number;
}

type Mode = "idle" | "enrolling" | "codes" | "disabling";

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

export function SecurityClient({ initialStatus }: { initialStatus: MfaStatus }) {
  const router = useRouter();
  const [status, setStatus] = useState<MfaStatus>(initialStatus);
  const [mode, setMode] = useState<Mode>("idle");
  const [enrol, setEnrol] = useState<EnrolData | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  async function beginEnrol() {
    setError(null);
    setBusy(true);
    try {
      const res = await api.mfaEnrollStart();
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
      const res = await api.mfaEnrollVerify({ tempToken: enrol.tempToken, code });
      setBackupCodes(res.backupCodes);
      setMode("codes");
      // Refresh the server-rendered status header once the enrol lands.
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
      await api.mfaDisable({ code });
      setStatus({ enabled: false, enrolledAt: null, lastUsedAt: null, backupCodesRemaining: 0 });
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

  // ------------------------------------------------------------
  // Rendering — one card per mode. Keeps the surface shallow.
  // ------------------------------------------------------------

  if (mode === "codes") {
    return (
      <div className="rounded-card border-hairline border-border bg-surface-elevated p-6">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-1 h-5 w-5 text-mint-dark" aria-hidden />
          <div>
            <h2 className="text-body-lg font-medium text-charcoal">Two-factor is on. Save your backup codes.</h2>
            <p className="mt-2 text-small text-text-secondary">
              Each code works once. If you lose your phone, use one of these to sign in — then re-enable 2FA. Don't share them; store them somewhere only you can reach (a password manager, or print and keep with important documents).
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 font-mono text-small text-charcoal">
          {backupCodes.map((c) => (
            <div key={c} className="rounded-md border-hairline border-border bg-surface px-3 py-2 text-center tracking-wider">
              {c}
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={copyCodes} className="btn-secondary text-small">
            <Copy className="h-4 w-4" aria-hidden /> {copied ? "Copied!" : "Copy all"}
          </button>
          <button type="button" onClick={finishCodes} className="btn-primary text-small">
            I've saved them
          </button>
        </div>
      </div>
    );
  }

  if (mode === "enrolling" && enrol) {
    return (
      <div className="rounded-card border-hairline border-border bg-surface-elevated p-6">
        <h2 className="text-body-lg font-medium text-charcoal">Scan and confirm</h2>
        <p className="mt-1 text-small text-text-secondary">
          Open your authenticator app and either scan the QR or paste the secret below. Then enter the 6-digit code it shows to confirm.
        </p>

        <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-start">
          {enrol.qrCodeDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={enrol.qrCodeDataUrl}
              alt="TOTP QR code"
              className="h-40 w-40 shrink-0 rounded-md border-hairline border-border bg-white p-2"
            />
          ) : (
            <div className="flex h-40 w-40 shrink-0 items-center justify-center rounded-md border-hairline border-border bg-surface text-caption text-text-tertiary">
              QR unavailable — paste the secret.
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-small font-medium text-charcoal">Manual entry secret</p>
            <code className="mt-1 block break-all rounded-md border-hairline border-border bg-surface px-3 py-2 font-mono text-small text-charcoal">
              {enrol.secret}
            </code>
            <p className="mt-3 text-caption text-text-tertiary">
              If the app asks: 6 digits, 30-second refresh, SHA1.
            </p>
          </div>
        </div>

        <div className="mt-5">
          <label htmlFor="mfa-code" className="block text-small font-medium text-charcoal">
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
            className="mt-1.5 block w-full max-w-xs rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
          />
        </div>

        {error && (
          <p role="alert" className="mt-3 text-small text-danger">
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            disabled={busy || code.replace(/\s/g, "").length < 6}
            onClick={confirmEnrol}
            className="btn-primary text-small"
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
            className="btn-secondary text-small"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (mode === "disabling") {
    return (
      <div className="rounded-card border-hairline border-border bg-surface-elevated p-6">
        <div className="flex items-start gap-3">
          <ShieldOff className="mt-1 h-5 w-5 text-danger" aria-hidden />
          <div>
            <h2 className="text-body-lg font-medium text-charcoal">Turn off two-factor?</h2>
            <p className="mt-1 text-small text-text-secondary">
              Enter a current code from your authenticator (or a backup code) to confirm. We ask for this on top of your password so a lost laptop can't disarm 2FA silently.
            </p>
          </div>
        </div>

        <div className="mt-5">
          <label htmlFor="disable-code" className="block text-small font-medium text-charcoal">
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
            className="mt-1.5 block w-full max-w-xs rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
          />
        </div>

        {error && (
          <p role="alert" className="mt-3 text-small text-danger">
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            disabled={busy || code.length < 1}
            onClick={confirmDisable}
            className="btn-danger text-small"
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
            className="btn-secondary text-small"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // idle
  const enrolledAt = formatTimestamp(status.enrolledAt);
  const lastUsedAt = formatTimestamp(status.lastUsedAt);

  return (
    <div className="rounded-card border-hairline border-border bg-surface-elevated p-6">
      {status.enabled ? (
        <>
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-1 h-5 w-5 text-mint-dark" aria-hidden />
            <div className="min-w-0 flex-1">
              <h2 className="text-body-lg font-medium text-charcoal">Two-factor is on</h2>
              <p className="mt-1 text-small text-text-secondary">
                Sign-in asks for a 6-digit code after your password.
              </p>
              <dl className="mt-3 space-y-1 text-small text-text-secondary">
                {enrolledAt && (
                  <div className="flex gap-3">
                    <dt className="text-text-tertiary">Enabled</dt>
                    <dd>{enrolledAt}</dd>
                  </div>
                )}
                {lastUsedAt && (
                  <div className="flex gap-3">
                    <dt className="text-text-tertiary">Last used</dt>
                    <dd>{lastUsedAt}</dd>
                  </div>
                )}
                <div className="flex gap-3">
                  <dt className="text-text-tertiary">Backup codes left</dt>
                  <dd>
                    {status.backupCodesRemaining}
                    {status.backupCodesRemaining <= 3 && status.backupCodesRemaining > 0 && (
                      <span className="ml-2 text-caption text-danger">
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
              className="btn-secondary text-small"
            >
              Turn off 2FA…
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-1 h-5 w-5 text-text-tertiary" aria-hidden />
            <div>
              <h2 className="text-body-lg font-medium text-charcoal">Add a second step to sign-in</h2>
              <p className="mt-1 text-small text-text-secondary">
                Best for anyone handling payroll, bank, or tax data. You'll need an authenticator app — Google Authenticator, 1Password, Authy, Bitwarden, or similar.
              </p>
            </div>
          </div>

          {error && (
            <p role="alert" className="mt-3 text-small text-danger">
              {error}
            </p>
          )}

          <div className="mt-5">
            <button
              type="button"
              disabled={busy}
              onClick={beginEnrol}
              className="btn-primary text-small"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Preparing…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" aria-hidden /> Enable two-factor
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function toMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.code === "MFA_INVALID_CODE") return "That code didn't match. Try again.";
    if (err.code === "MFA_ENROLL_EXPIRED") return "Enrolment timed out. Please start again.";
    if (err.code === "MFA_ALREADY_ENABLED") return "2FA is already on. Disable it first to re-enrol.";
    if (err.code === "RATE_LIMITED") return "Too many attempts. Wait a moment and try again.";
    if (err.code === "UNAUTHENTICATED") return "Your session expired. Sign in again.";
    return err.message || fallback;
  }
  return fallback;
}
