"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  type TenantImpersonationRequest,
  type TenantImpersonationSession,
} from "@/lib/api";

/**
 * Owner-facing "Platform access" card on /app/settings/security (#57 /
 * gap L1 v1).
 *
 * Three stacks in one card:
 *   - Pending requests — Owner can approve (picks minutes ≤ asked) or
 *     refuse (with reason). Non-owners see the list read-only, which
 *     matches the "transparency, but Owner decides" principle.
 *   - Active sessions — Owner's panic button. Destroys the minted
 *     tenant session so the operator is kicked immediately.
 *   - Recent history — approved/refused/expired — read-only.
 *
 * Deliberately polls lightly (every 30 s) so a request landing from
 * platform support shows up without a refresh, but not hard enough to
 * be a cost surprise.
 */
export function ImpersonationOwnerCard({ isOwner }: { isOwner: boolean }) {
  const [requests, setRequests] = useState<TenantImpersonationRequest[]>([]);
  const [sessions, setSessions] = useState<TenantImpersonationSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([
        api.listImpersonationRequests(),
        api.listActiveImpersonationSessions(),
      ]);
      setRequests(r.requests);
      setSessions(s.sessions);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message || "Could not load impersonation state."
          : "Could not reach the API.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const pending = requests.filter((r) => r.status === "pending");
  const history = requests.filter((r) => r.status !== "pending").slice(0, 10);

  return (
    <div className="mt-6 rounded-card border border-border bg-white p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-h3 text-charcoal">Platform access</h2>
          <p className="mt-1 text-small text-text-secondary">
            If our support team needs to see inside your books to help with an
            issue, they must ask you first. Nothing happens until you approve,
            and every action they take is logged as theirs.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="mt-6 text-small text-text-tertiary">Loading…</p>
      ) : error ? (
        <p className="mt-6 rounded-md border border-red-300 bg-red-50 p-3 text-small text-red-800">
          {error}
        </p>
      ) : (
        <>
          <Section title="Pending requests" count={pending.length}>
            {pending.length === 0 ? (
              <p className="text-small text-text-tertiary">
                No pending requests.
              </p>
            ) : (
              <ul className="space-y-3">
                {pending.map((r) => (
                  <PendingRequestRow
                    key={r.id}
                    request={r}
                    isOwner={isOwner}
                    onDone={load}
                  />
                ))}
              </ul>
            )}
          </Section>

          <Section title="Active sessions" count={sessions.length}>
            {sessions.length === 0 ? (
              <p className="text-small text-text-tertiary">
                Nobody from the platform is currently signed in to your books.
              </p>
            ) : (
              <ul className="space-y-3">
                {sessions.map((s) => (
                  <ActiveSessionRow
                    key={s.id}
                    session={s}
                    isOwner={isOwner}
                    onDone={load}
                  />
                ))}
              </ul>
            )}
          </Section>

          {history.length > 0 && (
            <Section title="Recent history" count={history.length}>
              <ul className="space-y-2">
                {history.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-start justify-between gap-3 border-t-hairline border-border pt-2 text-small"
                  >
                    <div>
                      <p className="text-charcoal">
                        {r.requestingPlatformUserEmail}
                      </p>
                      <p className="text-caption text-text-tertiary">
                        {r.reason}
                      </p>
                      {r.refusedReason && (
                        <p className="text-caption text-red-700">
                          Refused: {r.refusedReason}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right text-caption text-text-tertiary">
                      <div className="capitalize">{r.status}</div>
                      <div>{new Date(r.createdAt).toLocaleDateString()}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6">
      <h3 className="text-small font-medium uppercase tracking-wide text-text-secondary">
        {title}
        {count > 0 && (
          <span className="ml-2 rounded-full bg-mint-surface px-2 py-0.5 text-micro text-mint-dark">
            {count}
          </span>
        )}
      </h3>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function PendingRequestRow({
  request,
  isOwner,
  onDone,
}: {
  request: TenantImpersonationRequest;
  isOwner: boolean;
  onDone: () => void;
}) {
  const [minutes, setMinutes] = useState<15 | 30 | 60>(
    Math.min(request.requestedMinutes, 30) as 15 | 30,
  );
  const [refusing, setRefusing] = useState(false);
  const [refuseReason, setRefuseReason] = useState("");
  const [busy, setBusy] = useState<"approve" | "refuse" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setError(null);
    setBusy("approve");
    try {
      await api.approveImpersonationRequest(request.id, { minutes });
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message || "Approval failed."
          : "Could not reach the API.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function refuse() {
    if (refuseReason.trim().length < 3) {
      setError("Give a short reason so support knows what happened.");
      return;
    }
    setError(null);
    setBusy("refuse");
    try {
      await api.refuseImpersonationRequest(request.id, {
        reason: refuseReason.trim(),
      });
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message || "Refusal failed."
          : "Could not reach the API.",
      );
    } finally {
      setBusy(null);
    }
  }

  const allowedMinutes = ([15, 30, 60] as const).filter(
    (m) => m <= request.requestedMinutes,
  );

  return (
    <li className="rounded-md border border-border bg-offwhite p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-small text-charcoal">
            <span className="font-medium">
              {request.requestingPlatformUserEmail}
            </span>{" "}
            wants access for up to {request.requestedMinutes} minutes.
          </p>
          <p className="mt-1 text-small text-text-secondary">{request.reason}</p>
          <p className="mt-1 text-caption text-text-tertiary">
            Requested {new Date(request.createdAt).toLocaleString()}
          </p>
        </div>
      </div>

      {!isOwner && (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-caption text-amber-900">
          Only the business owner can approve or refuse this. Ask them to
          sign in and respond.
        </p>
      )}

      {isOwner && !refusing && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            {allowedMinutes.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMinutes(m)}
                className={`rounded-md border px-3 py-1.5 text-small ${
                  minutes === m
                    ? "border-mint-dark bg-mint-surface text-mint-dark"
                    : "border-border bg-white text-charcoal hover:bg-offwhite"
                }`}
              >
                {m} min
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={busy !== null}
            onClick={approve}
            className="rounded-md bg-mint-dark px-4 py-1.5 text-small font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy === "approve" ? "Approving…" : `Approve for ${minutes} min`}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => setRefusing(true)}
            className="rounded-md border border-red-400 px-4 py-1.5 text-small text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            Refuse
          </button>
        </div>
      )}

      {isOwner && refusing && (
        <div className="mt-4 space-y-2">
          <textarea
            value={refuseReason}
            onChange={(e) => setRefuseReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Short reason for support"
            className="block w-full rounded-md border border-border bg-white px-3 py-2 text-small text-charcoal focus:border-mint-dark focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={refuse}
              className="rounded-md bg-red-600 px-4 py-1.5 text-small font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {busy === "refuse" ? "Refusing…" : "Confirm refuse"}
            </button>
            <button
              type="button"
              onClick={() => {
                setRefusing(false);
                setRefuseReason("");
                setError(null);
              }}
              className="rounded-md border border-border bg-white px-4 py-1.5 text-small text-charcoal hover:bg-offwhite"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-md border border-red-300 bg-red-50 p-2 text-caption text-red-800">
          {error}
        </p>
      )}
    </li>
  );
}

function ActiveSessionRow({
  session,
  isOwner,
  onDone,
}: {
  session: TenantImpersonationSession;
  isOwner: boolean;
  onDone: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    if (reason.trim().length < 3) {
      setError("Give a short reason for the audit trail.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.revokeImpersonationSession(session.id, {
        reason: reason.trim(),
      });
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message || "Revoke failed."
          : "Could not reach the API.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-md border border-red-200 bg-red-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-small text-charcoal">
            <span className="font-medium">{session.platformUserEmail}</span>{" "}
            is signed in as {session.targetUserEmail}.
          </p>
          <p className="mt-1 text-caption text-text-tertiary">
            Until {new Date(session.endsAt).toLocaleString()}
          </p>
        </div>
        {isOwner && !confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md bg-red-600 px-3 py-1.5 text-small font-medium text-white hover:opacity-90"
          >
            End now
          </button>
        )}
      </div>

      {isOwner && confirming && (
        <div className="mt-3 space-y-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Short reason"
            className="block w-full rounded-md border border-border bg-white px-3 py-2 text-small text-charcoal focus:border-mint-dark focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={revoke}
              className="rounded-md bg-red-600 px-4 py-1.5 text-small font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {busy ? "Ending…" : "Confirm end"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setReason("");
                setError(null);
              }}
              className="rounded-md border border-border bg-white px-4 py-1.5 text-small text-charcoal hover:bg-offwhite"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-md border border-red-300 bg-red-100 p-2 text-caption text-red-800">
          {error}
        </p>
      )}
    </li>
  );
}
