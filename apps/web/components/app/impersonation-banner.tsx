"use client";

import { useEffect, useState } from "react";

/**
 * Red persistent banner shown when the current tenant session is an
 * impersonation (#57 / gap L1 v1).
 *
 * Three responsibilities:
 *   1. Make it impossible to forget you're inside someone else's books.
 *      Red background, sticky-top, full-width, on every /app page.
 *   2. Show the countdown. Hard deadline is enforced server-side in
 *      readSession() (past ends_at = 401), but operators benefit from
 *      seeing the time remaining to wrap up before they get kicked.
 *   3. Attribute the impersonator. The audit trail has the email too,
 *      but rendering it here means nobody can later claim they "didn't
 *      notice" who was in.
 *
 * Rendered by the server layout, which already knows from /auth/me
 * whether the session is impersonated. We re-render every second on
 * the client purely for the countdown — zero API calls.
 */
export function ImpersonationBanner({
  platformUserEmail,
  endsAt,
}: {
  platformUserEmail: string;
  endsAt: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remainingMs = endsAt ? new Date(endsAt).getTime() - now : null;
  const expired = remainingMs !== null && remainingMs <= 0;

  let timeLabel = "no deadline";
  if (remainingMs !== null) {
    if (expired) {
      timeLabel = "session expired — refresh to log out";
    } else {
      const totalSeconds = Math.floor(remainingMs / 1000);
      const mm = Math.floor(totalSeconds / 60);
      const ss = totalSeconds % 60;
      timeLabel = `${mm}:${ss.toString().padStart(2, "0")} remaining`;
    }
  }

  return (
    <div
      role="alert"
      className="sticky top-0 z-40 border-b-hairline border-red-500 bg-red-600 text-white"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2 text-small">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-body">⚠</span>
          <span>
            Platform support is impersonating a user in this account:{" "}
            <span className="font-semibold">{platformUserEmail}</span>. Every
            action is attributed to them in the audit trail.
          </span>
        </div>
        <span className="rounded-full bg-black/25 px-3 py-0.5 text-caption font-medium">
          {timeLabel}
        </span>
      </div>
    </div>
  );
}
