"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { PlatformApiError, platformApi } from "@/lib/platform-api";

export function PlatformLoginForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      await platformApi.login({
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? ""),
      });
      router.push("/platform");
      router.refresh();
    } catch (err) {
      const msg =
        err instanceof PlatformApiError
          ? err.code === "INVALID_CREDENTIALS"
            ? "Wrong email or password."
            : err.code === "RATE_LIMITED"
              ? "Too many attempts. Wait a moment, then try again."
              : err.message || "Something went wrong."
          : "Can't reach the API.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
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
