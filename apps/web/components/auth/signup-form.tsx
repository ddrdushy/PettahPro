"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Field } from "./field";

export function SignupForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      await api.signup({
        businessName: String(form.get("businessName") ?? "").trim(),
        ownerName: String(form.get("ownerName") ?? "").trim(),
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? ""),
      });
      router.push("/app");
      router.refresh();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.code === "EMAIL_IN_USE"
            ? "An account with this email already exists. Try signing in."
            : err.code === "INVALID_INPUT"
              ? "Please check the fields and try again."
              : err.message || "Something went wrong. Try again."
          : "Can't reach the server. Check your connection.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <Field
        label="Business name"
        name="businessName"
        autoComplete="organization"
        required
        minLength={2}
        placeholder="Perera Textiles"
      />
      <Field
        label="Your name"
        name="ownerName"
        autoComplete="name"
        required
        minLength={2}
        placeholder="Nimal Perera"
      />
      <Field
        label="Work email"
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
        autoComplete="new-password"
        required
        minLength={8}
        hint="At least 8 characters"
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
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Creating your account…
          </>
        ) : (
          "Create account and start trial"
        )}
      </button>

      <p className="text-caption text-text-tertiary">
        By creating an account you agree to our Terms and Privacy Policy.
      </p>
    </form>
  );
}
