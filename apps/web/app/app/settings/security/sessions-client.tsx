"use client";

// Roadmap #52 / gap A3 — active sessions list + revoke.
//
// Natural follow-on to #51 MFA. Now that a second factor can gate
// sign-in, the next question is: "who's signed in as me right now, and
// can I kick them off?" Lives on the same /app/settings/security page
// as MFA, below the two-factor card.
//
// The server exposes session IDs via an opaque HMAC-per-row `revokeKey`
// so the real IDs never leave Redis. Revoking the current session
// clears cookies + hard-navigates to /login; revoking any other
// session just updates the list in place.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Loader2, Monitor, Smartphone, Tablet, HelpCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api";

interface SessionRow {
  revokeKey: string;
  isCurrent: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
}

// Fairly brittle UA parse — deliberate. We're labelling a card in a
// settings page, not doing analytics. "Chrome on macOS" / "Safari on
// iPhone" / "Firefox on Linux" — that level of granularity is enough
// for a user to recognise their own device. Unknown falls through to
// the raw UA snippet so debugging is still possible.
function humanUserAgent(ua: string | null): { device: string; label: string; icon: "desktop" | "mobile" | "tablet" | "unknown" } {
  if (!ua) return { device: "Unknown device", label: "Device couldn't be identified.", icon: "unknown" };
  const isMobile = /iPhone|Android.*Mobile|Windows Phone/i.test(ua);
  const isTablet = /iPad|Android(?!.*Mobile)/i.test(ua);
  const os = /Windows NT/i.test(ua)
    ? "Windows"
    : /Mac OS X/i.test(ua)
      ? "macOS"
      : /iPhone|iPad|iPod/i.test(ua)
        ? "iOS"
        : /Android/i.test(ua)
          ? "Android"
          : /Linux/i.test(ua)
            ? "Linux"
            : null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : null;
  const device = browser && os ? `${browser} on ${os}` : browser ?? os ?? "Unknown device";
  return {
    device,
    label: ua.slice(0, 140),
    icon: isTablet ? "tablet" : isMobile ? "mobile" : "desktop",
  };
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.max(0, now - then);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

function DeviceIcon({ icon }: { icon: "desktop" | "mobile" | "tablet" | "unknown" }) {
  if (icon === "mobile") return <Smartphone className="h-5 w-5 text-text-tertiary" aria-hidden />;
  if (icon === "tablet") return <Tablet className="h-5 w-5 text-text-tertiary" aria-hidden />;
  if (icon === "desktop") return <Monitor className="h-5 w-5 text-text-tertiary" aria-hidden />;
  return <HelpCircle className="h-5 w-5 text-text-tertiary" aria-hidden />;
}

export function ActiveSessionsCard() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listSessions();
      setSessions(res.sessions);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message || "Couldn't load sessions." : "Couldn't reach the server.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onRevoke(row: SessionRow) {
    setBusyKey(row.revokeKey);
    setError(null);
    try {
      const res = await api.revokeSession({ revokeKey: row.revokeKey });
      if (res.revokedCurrent) {
        // The session we were operating from is gone — the server
        // already cleared our cookies, but router.push + refresh hits
        // the middleware and redirects to /login cleanly.
        router.push("/login");
        router.refresh();
        return;
      }
      // Optimistic remove — the list is small and /sessions would just
      // return the same thing minus this row.
      setSessions((prev) => prev?.filter((s) => s.revokeKey !== row.revokeKey) ?? null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.code === "SESSION_NOT_FOUND"
            ? "That session is already gone. Refresh to see the current list."
            : err.message || "Couldn't revoke the session."
          : "Couldn't reach the server.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function onRevokeAllOthers() {
    if (!confirm("Sign out every other session? You'll stay signed in on this device.")) return;
    setRevokingAll(true);
    setError(null);
    try {
      const res = await api.revokeOtherSessions();
      setSessions((prev) => prev?.filter((s) => s.isCurrent) ?? null);
      // Soft-surface the count so the user knows something happened
      // even when the list only ever had one entry.
      if (res.revoked === 0) {
        setError("No other sessions were signed in.");
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message || "Couldn't revoke other sessions." : "Couldn't reach the server.",
      );
    } finally {
      setRevokingAll(false);
    }
  }

  const otherCount = sessions?.filter((s) => !s.isCurrent).length ?? 0;

  return (
    <section className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-body font-medium text-charcoal">Active sessions</h2>
          <p className="mt-1 text-caption text-text-secondary">
            Every device currently signed in as you. Don't recognise one? Sign it out.
          </p>
        </div>
        {otherCount > 0 && (
          <button
            type="button"
            onClick={onRevokeAllOthers}
            disabled={revokingAll}
            className="btn-secondary text-small"
          >
            {revokingAll ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Signing out…
              </>
            ) : (
              `Sign out all ${otherCount} other${otherCount === 1 ? "" : "s"}`
            )}
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-3 text-small text-danger"
        >
          {error}
        </div>
      )}

      {loading && (
        <div className="mt-4 flex items-center gap-2 text-small text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading sessions…
        </div>
      )}

      {!loading && sessions && sessions.length === 0 && (
        <p className="mt-4 text-small text-text-secondary">No active sessions — that's odd, you should be one of them. Try reloading the page.</p>
      )}

      {!loading && sessions && sessions.length > 0 && (
        <ul className="mt-4 space-y-2">
          {sessions.map((s) => {
            const ua = humanUserAgent(s.userAgent);
            return (
              <li
                key={s.revokeKey}
                className="flex items-start justify-between gap-3 rounded-md border-hairline border-border p-4"
              >
                <div className="flex items-start gap-3">
                  <DeviceIcon icon={ua.icon} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-small font-medium text-charcoal">{ua.device}</p>
                      {s.isCurrent && (
                        <span className="rounded-full border-hairline border-success/40 bg-success-bg/50 px-2 py-0.5 text-caption text-success">
                          This device
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-caption text-text-secondary">
                      {s.ip ?? "Unknown IP"} · Signed in {relativeTime(s.createdAt)} · Last seen {relativeTime(s.lastSeenAt)}
                    </p>
                    <p className="mt-1 truncate text-caption text-text-tertiary" title={ua.label}>
                      {ua.label}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRevoke(s)}
                  disabled={busyKey === s.revokeKey}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border-hairline border-border px-3 py-1.5 text-small text-danger hover:bg-danger-bg/40 disabled:opacity-50"
                  aria-label="Sign out this session"
                >
                  {busyKey === s.revokeKey ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <>
                      <LogOut className="h-4 w-4" aria-hidden /> Sign out
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
