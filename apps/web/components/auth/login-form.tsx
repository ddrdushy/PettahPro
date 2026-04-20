"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Field } from "./field";

export function LoginForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      await api.login({
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? ""),
      });
      router.push("/app");
      router.refresh();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.code === "INVALID_CREDENTIALS"
            ? "Wrong email or password."
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
