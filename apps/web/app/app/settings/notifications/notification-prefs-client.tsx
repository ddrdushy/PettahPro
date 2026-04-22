"use client";

import { useState } from "react";
import { api, ApiError, type NotificationPreference } from "@/lib/api";

export function NotificationPrefsClient({
  initial,
}: {
  initial: NotificationPreference[];
}) {
  const [prefs, setPrefs] = useState(initial);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  async function toggle(kind: string, nextEnabled: boolean) {
    setError(null);
    setBusy((b) => ({ ...b, [kind]: true }));
    // Optimistic
    setPrefs((p) => p.map((x) => (x.kind === kind ? { ...x, enabled: nextEnabled } : x)));
    try {
      await api.updateNotificationPreference(kind, nextEnabled);
    } catch (err) {
      // Roll back on failure.
      setPrefs((p) => p.map((x) => (x.kind === kind ? { ...x, enabled: !nextEnabled } : x)));
      setError(err instanceof ApiError ? err.message : "Couldn't save that change.");
    } finally {
      setBusy((b) => ({ ...b, [kind]: false }));
    }
  }

  const known = prefs.filter((p) => p.known);
  const unknown = prefs.filter((p) => !p.known);

  return (
    <div className="mt-8 space-y-6">
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-caption text-red-700">{error}</p>
      )}
      <section className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <table className="w-full text-small">
          <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="px-6 py-3 text-left">Event</th>
              <th className="w-28 px-6 py-3 text-right">In-app</th>
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            {known.map((p) => (
              <tr key={p.kind}>
                <td className="px-6 py-4">
                  <p className="font-medium text-charcoal">{p.label}</p>
                  <p className="text-caption text-text-tertiary">{p.description}</p>
                </td>
                <td className="px-6 py-4 text-right">
                  <Toggle
                    checked={p.enabled}
                    disabled={busy[p.kind]}
                    onChange={(v) => toggle(p.kind, v)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {unknown.length > 0 && (
        <section className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <header className="border-b-hairline border-border px-6 py-4">
            <h2 className="text-body font-medium text-charcoal">Other</h2>
            <p className="text-caption text-text-tertiary">
              Kinds you've toggled in the past that no longer have a labelled UI. Safe to leave on.
            </p>
          </header>
          <table className="w-full text-small">
            <tbody className="divide-y-hairline divide-border">
              {unknown.map((p) => (
                <tr key={p.kind}>
                  <td className="px-6 py-4 font-mono text-text-secondary">{p.kind}</td>
                  <td className="px-6 py-4 text-right">
                    <Toggle
                      checked={p.enabled}
                      disabled={busy[p.kind]}
                      onChange={(v) => toggle(p.kind, v)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="text-caption text-text-tertiary">
        Tenant-wide announcements (e.g. period closed) are broadcast to everyone and aren't user-level opt-out.
      </p>
    </div>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-none items-center rounded-full transition ${
        checked ? "bg-mint-dark" : "bg-surface-recessed"
      } ${disabled ? "opacity-50" : ""}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}
