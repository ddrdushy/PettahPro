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
    const before = prefs.find((p) => p.kind === kind);
    // Optimistic — the server derives `enabled` from cadence so we mirror.
    // It also force-clears emailEnabled when cadence flips to 'off'; match
    // that here so the UI doesn't flash an impossible state.
    setPrefs((p) =>
      p.map((x) =>
        x.kind === kind
          ? {
              ...x,
              cadence: next,
              enabled: next !== "off",
              emailEnabled: next === "off" ? false : x.emailEnabled,
            }
          : x,
      ),
    );
    try {
      await api.updateNotificationPreference(kind, { cadence: next });
    } catch (err) {
      // Roll back on failure.
      if (before) {
        setPrefs((p) =>
          p.map((x) =>
            x.kind === kind
              ? { ...x, cadence: before.cadence, enabled: before.enabled, emailEnabled: before.emailEnabled }
              : x,
          ),
        );
      }
      setError(err instanceof ApiError ? err.message : "Couldn't save that change.");
    } finally {
      setBusy((b) => ({ ...b, [kind]: false }));
    }
  }

  async function setEmailEnabled(kind: string, next: boolean) {
    setError(null);
    setBusy((b) => ({ ...b, [kind]: true }));
    const before = prefs.find((p) => p.kind === kind)?.emailEnabled ?? false;
    setPrefs((p) =>
      p.map((x) => (x.kind === kind ? { ...x, emailEnabled: next } : x)),
    );
    try {
      await api.updateNotificationPreference(kind, { emailEnabled: next });
    } catch (err) {
      setPrefs((p) =>
        p.map((x) => (x.kind === kind ? { ...x, emailEnabled: before } : x)),
      );
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
              <th className="w-44 px-6 py-3 text-right">Email</th>
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
                <td className="px-6 py-4 text-right">
                  <EmailToggle
                    cadence={p.cadence}
                    emailEnabled={p.emailEnabled}
                    disabled={busy[p.kind]}
                    onChange={(v) => setEmailEnabled(p.kind, v)}
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
                  <td className="w-48 px-6 py-4 text-right">
                    <CadenceSelect
                      value={p.cadence}
                      disabled={busy[p.kind]}
                      onChange={(v) => setCadence(p.kind, v)}
                    />
                  </td>
                  <td className="w-44 px-6 py-4 text-right">
                    <EmailToggle
                      cadence={p.cadence}
                      emailEnabled={p.emailEnabled}
                      disabled={busy[p.kind]}
                      onChange={(v) => setEmailEnabled(p.kind, v)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="rounded-md bg-mint-surface/60 p-4 text-caption text-mint-dark">
        <p className="font-medium">About delivery</p>
        <ul className="mt-1 list-disc pl-4">
          <li><strong>Immediate</strong>: in-app bell. Toggle <em>Email</em> on to also get an email per event.</li>
          <li><strong>Daily</strong> / <strong>Weekly</strong>: one rollup email per window; email is always included, so the <em>Email</em> toggle is locked on.</li>
          <li>Daily digests go out each morning; weekly digests on Monday morning — in your tenant's timezone.</li>
          <li>Switching from digest to immediate or off clears any events still waiting in the queue.</li>
          <li>Tenant-wide announcements (e.g. period closed) are broadcast to everyone and don't go through digest or per-user email.</li>
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

// Email toggle semantics:
//   • cadence='immediate' → live toggle (the emailEnabled column). This
//     is the only state where the flag meaningfully changes behaviour.
//   • cadence='daily' or 'weekly' → email always fires via the digest
//     cron, so the toggle is locked on + disabled with an explanatory
//     title. Shows "Via digest" so users know *why* it's locked.
//   • cadence='off' → delivery is off entirely; toggle is locked off +
//     disabled.
function EmailToggle({
  cadence,
  emailEnabled,
  disabled,
  onChange,
}: {
  cadence: NotificationCadence;
  emailEnabled: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  const isDigest = cadence === "daily" || cadence === "weekly";
  const isOff = cadence === "off";
  const locked = isDigest || isOff;
  const effective = isDigest ? true : isOff ? false : emailEnabled;
  const title = isDigest
    ? "Digest mode always emails — this toggle is on automatically."
    : isOff
      ? "Delivery is off for this event. Set a cadence to enable email."
      : emailEnabled
        ? "Email is on. We'll send you one email per event."
        : "Email is off. You'll only see this in the in-app bell.";

  return (
    <label
      className={`inline-flex items-center gap-2 ${locked || disabled ? "opacity-60" : ""}`}
      title={title}
    >
      <span className="text-caption text-text-secondary">
        {isDigest ? "Via digest" : effective ? "On" : "Off"}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={effective}
        disabled={locked || disabled}
        onClick={() => !locked && !disabled && onChange(!emailEnabled)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:cursor-not-allowed ${effective ? "bg-charcoal" : "bg-border-emphasis"}`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${effective ? "translate-x-4" : "translate-x-0.5"}`}
        />
      </button>
    </label>
  );
}
