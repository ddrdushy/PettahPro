"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Field } from "@/components/auth/field";

export function VerifyForm({ email }: { email: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<
    { tenantSlug: string; businessName: string }[]
  >([]);
  const [chosenSlug, setChosenSlug] = useState<string | null>(null);
  const [pendingCode, setPendingCode] = useState<string>("");

  async function doVerify(code: string, tenantSlug?: string) {
    setError(null);
    setBusy(true);
    try {
      await api.portalVerify({ email, code, tenantSlug });
      router.push("/portal/invoices");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "AMBIGUOUS_TENANT") {
        const issues = err.issues as
          | { candidates?: { tenantSlug: string; businessName: string }[] }
          | undefined;
        setCandidates(issues?.candidates ?? []);
        setPendingCode(code);
        setError(err.message);
      } else {
        setError(
          err instanceof ApiError
            ? err.code === "INVALID_CODE"
              ? "That code didn't work. Double-check the email and enter the latest 6-digit code we sent."
              : err.message || "Sign-in failed. Try again."
            : "Can't reach the server. Check your connection.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const code = String(form.get("code") ?? "").trim();
    await doVerify(code);
  }

  if (candidates.length > 0) {
    return (
      <div className="space-y-4">
        <p className="text-small text-text-secondary">
          This email is linked to more than one business on PettahPro. Pick the one you want
          to sign in to:
        </p>
        <ul className="space-y-2">
          {candidates.map((c) => (
            <li key={c.tenantSlug}>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setChosenSlug(c.tenantSlug);
                  void doVerify(pendingCode, c.tenantSlug);
                }}
                className="flex w-full items-center justify-between rounded-md border-hairline border-border bg-surface-elevated px-4 py-3 text-left hover:border-border-emphasis"
              >
                <span className="text-body font-medium text-charcoal">{c.businessName}</span>
                {busy && chosenSlug === c.tenantSlug && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                )}
              </button>
            </li>
          ))}
        </ul>
        {error && (
          <div
            role="alert"
            className="rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-3 text-small text-danger"
          >
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <Field
        label="6-digit code"
        type="text"
        name="code"
        inputMode="numeric"
        pattern="[0-9]{6}"
        maxLength={6}
        autoComplete="one-time-code"
        required
        placeholder="123456"
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
