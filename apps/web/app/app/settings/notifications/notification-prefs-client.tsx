"use client";

import { useState } from "react";
import {
  api,
  ApiError,
  type NotificationCadence,
  type NotificationPreference,
} from "@/lib/api";

const CADENCE_OPTIONS: { value: NotificationCadence; label: string; hint: string }[] = [
  { value: "immediate", label: "Immediate", hint: "Appears in your in-app bell the moment it happens." },
  { value: "daily",     label: "Daily digest", hint: "Rolled up into one email each morning." },
  { value: "weekly",    label: "Weekly digest", hint: "Rolled up into one email every Monday morning." },
  { value: "off",       label: "Off", hint: "Don't notify me about this kind." },
];

export function NotificationPrefsClient({
  initial,
}: {
  initial: NotificationPreference[];
}) {
  const [prefs, setPrefs] = useState(initial);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  async function setCadence(kind: string, next: NotificationCadence) {
    setError(null);
    setBusy((b) => ({ ...b, [kind]: true }));
    const before = prefs.find((p) => p.kind === kind)?.cadence;
    // Optimistic — the server derives `enabled` from cadence so we mirror.
    setPrefs((p) =>
      p.map((x) =>
        x.kind === kind ? { ...x, cadence: next, enabled: next !== "off" } : x,
      ),
    );
    try {
      await api.updateNotificationPreference(kind, { cadence: next });
    } catch (err) {
      // Roll back on failure.
      if (before) {
        setPrefs((p) =>
          p.map((x) =>
            x.kind === kind ? { ...x, cadence: before, enabled: before !== "off" } : x,
          ),
        );
      }
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
              <th className="w-48 px-6 py-3 text-right">Delivery</th>
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
                  <CadenceSelect
                    value={p.cadence}
                    disabled={busy[p.kind]}
                    onChange={(v) => setCadence(p.kind, v)}
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
                    <CadenceSelect
                      value={p.cadence}
                      disabled={busy[p.kind]}
                      onChange={(v) => setCadence(p.kind, v)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="rounded-md bg-mint-surface/60 p-4 text-caption text-mint-dark">
        <p className="font-medium">About digest delivery</p>
        <ul className="mt-1 list-disc pl-4">
          <li>Daily digests go out each morning; weekly digests on Monday morning — in your tenant's timezone.</li>
          <li>Digest mode replaces the in-app bell for that kind. You'll see the summary in email instead.</li>
          <li>Switching from digest to immediate or off clears any events still waiting in the queue.</li>
          <li>Tenant-wide announcements (e.g. period closed) are broadcast to everyone and don't go through digest.</li>
        </ul>
      </div>
    </div>
  );
}

function CadenceSelect({
  value,
  disabled,
  onChange,
}: {
  value: NotificationCadence;
  disabled?: boolean;
  onChange: (v: NotificationCadence) => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as NotificationCadence)}
      className="w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal disabled:opacity-50"
      title={CADENCE_OPTIONS.find((o) => o.value === value)?.hint}
    >
      {CADENCE_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
