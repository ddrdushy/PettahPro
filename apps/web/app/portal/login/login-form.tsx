"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Loader2, Mail } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Field } from "@/components/auth/field";

export function PortalLoginForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    try {
      // Always-200 semantic on the server — we just advance the flow
      // regardless so attackers can't tell whether the email is a
      // customer on the platform.
      await api.portalRequestOtp({ email });
      const params = new URLSearchParams({ email });
      router.push(`/portal/verify?${params.toString()}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "RATE_LIMITED") {
        setError("Too many sign-in code requests. Please wait a bit and try again.");
      } else {
        setError(
          err instanceof ApiError
            ? err.message || "Couldn't send a sign-in code. Try again in a moment."
            : "Can't reach the server. Check your connection.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <Field
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        required
        placeholder="you@business.lk"
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
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Sending code…
          </>
        ) : (
          <>
            <Mail className="h-4 w-4" aria-hidden /> Email me a sign-in code
          </>
        )}
      </button>
    </form>
  );
}
