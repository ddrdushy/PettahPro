"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PlatformApiError, platformApi } from "@/lib/platform-api";
import { PlatformMfaCard } from "./mfa-card";

export function PlatformAccountClient() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onChangePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      await platformApi.changePassword({
        currentPassword: String(form.get("currentPassword") ?? ""),
        newPassword: String(form.get("newPassword") ?? ""),
      });
      setMsg("Password updated.");
      e.currentTarget.reset();
    } catch (err) {
      setError(
        err instanceof PlatformApiError
          ? err.message || "Could not change password."
          : "Could not reach the API.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onLogout() {
    setBusy(true);
    try {
      await platformApi.logout();
    } catch {
      /* ignore — local cookies already cleared */
    }
    router.push("/platform/login");
    router.refresh();
  }

  return (
    <div className="mt-10 space-y-8">
      <section className="rounded-card border border-white/10 bg-black/20 p-6">
        <h2 className="text-h3 text-white">Change password</h2>
        <form onSubmit={onChangePassword} className="mt-4 space-y-4" noValidate>
          <div>
            <label className="block text-caption uppercase tracking-wide text-white/60">
              Current password
            </label>
            <input
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              className="mt-1 block w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-body text-white focus:border-mint focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-caption uppercase tracking-wide text-white/60">
              New password (min 12 chars)
            </label>
            <input
              name="newPassword"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              className="mt-1 block w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-body text-white focus:border-mint focus:outline-none"
            />
          </div>
          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-small text-red-200">
              {error}
            </div>
          )}
          {msg && (
            <div className="rounded-md border border-mint/40 bg-mint/10 p-2 text-small text-mint">
              {msg}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-mint px-4 py-2 text-small text-charcoal hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Update password"}
          </button>
        </form>
      </section>

      <PlatformMfaCard />

      <section className="rounded-card border border-white/10 bg-black/20 p-6">
        <h2 className="text-h3 text-white">Sign out</h2>
        <p className="mt-1 text-small text-white/70">
          Ends your platform session.
        </p>
        <button
          type="button"
          onClick={onLogout}
          disabled={busy}
          className="mt-4 rounded-md border border-white/10 bg-white/5 px-4 py-2 text-small text-white hover:bg-white/10"
        >
          Sign out
        </button>
      </section>
    </div>
  );
}
