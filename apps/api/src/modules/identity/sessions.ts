import { randomBytes } from "node:crypto";
import IORedis from "ioredis";

const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");

const SESSION_PREFIX = "session:";
const USER_INDEX_PREFIX = "user-sessions:";
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days sliding

export interface Session {
  id: string;
  userId: string;
  tenantId: string;
  email: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  // CSRF double-submit token (#50 / gap A5). Minted once per session, stored
  // inside the session blob so it lives and dies with it — no separate Redis
  // key to garbage-collect, no window where a destroyed session still has an
  // orphaned CSRF record. The matching cookie `pp_csrf` is non-HttpOnly so
  // JS can read it; the header `X-CSRF-Token` is compared against this
  // server-side value in a constant-time check. Static for the lifetime of
  // the session (no per-request rotation — the threat model is "cross-origin
  // form post", not "predict-the-next-token"). Sessions are 30 days sliding,
  // so the window is bounded by that.
  csrfToken: string;
  // #52 / gap A3 — session management UI. Captured at mint time so the
  // "active sessions" list can show "Chrome on macOS from 203.0.113.7,
  // last seen 3 minutes ago" without a separate request log. Optional on
  // read for back-compat with pre-#52 blobs (fields back-fill as null
  // there — the list page renders "Unknown device / unknown IP" and the
  // revoke button still works).
  ip?: string | null;
  userAgent?: string | null;
  // #57 / gap L1 v1 — operator impersonation. Populated by the
  // platform `/platform/impersonation-requests/:id/start` route when
  // a platform staffer starts an approved session. Presence of
  // impersonatedByPlatformUserId is the single source of truth for
  // "this tenant session is actually being driven by a platform
  // operator." Consumed by:
  //   1. readSession — refuses sliding-window TTL extension so the
  //      session dies at the hard deadline (impersonation_sessions.ends_at).
  //   2. identity/plugin.ts onRequest — populates the AsyncLocalStorage
  //      context that recordAuditEvent reads for dual-actor attribution.
  //   3. /auth/me — surfaces the impersonator to the web so it can
  //      render the red banner.
  // Stored on the session blob rather than looked up per request so
  // an impersonation_sessions DB read isn't on the hot path.
  impersonatedByPlatformUserId?: string | null;
  impersonatedByPlatformUserEmail?: string | null;
  // Hard deadline, epoch seconds. Matches impersonation_sessions.ends_at.
  // Redis TTL at mint time is already sized to fit — this field is the
  // application-level check that readSession uses to reject sliding.
  impersonationEndsAt?: number | null;
}

function genSessionId(): string {
  return randomBytes(24).toString("base64url");
}

function genCsrfToken(): string {
  // 32 bytes = 256 bits of entropy, same shape as the session ID but
  // kept distinct so a leak of one doesn't telegraph the other.
  return randomBytes(32).toString("base64url");
}

export async function createSession(input: {
  userId: string;
  tenantId: string;
  email: string;
  ttlSeconds?: number;
  ip?: string | null;
  userAgent?: string | null;
  // #57 / gap L1 v1 — impersonation stamps. Set together or not at
  // all; callers that aren't the impersonation-start route leave them
  // undefined and the session behaves like any other tenant session.
  impersonatedByPlatformUserId?: string | null;
  impersonatedByPlatformUserEmail?: string | null;
  impersonationEndsAt?: number | null;
}): Promise<Session> {
  const id = genSessionId();
  const now = Math.floor(Date.now() / 1000);
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const session: Session = {
    id,
    userId: input.userId,
    tenantId: input.tenantId,
    email: input.email,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + ttl,
    csrfToken: genCsrfToken(),
    ip: input.ip ?? null,
    // Long UA strings (>512 chars) get truncated — the index/list pages only
    // show a humanised "Chrome on macOS" summary anyway, and the raw string is
    // purely for debug detail. Cap keeps the Redis blob bounded against the
    // occasional bot UA dumping 2 KB of junk into the header.
    userAgent: input.userAgent ? input.userAgent.slice(0, 512) : null,
    impersonatedByPlatformUserId: input.impersonatedByPlatformUserId ?? null,
    impersonatedByPlatformUserEmail:
      input.impersonatedByPlatformUserEmail ?? null,
    impersonationEndsAt: input.impersonationEndsAt ?? null,
  };

  const pipeline = redis.multi();
  pipeline.set(SESSION_PREFIX + id, JSON.stringify(session), "EX", ttl);
  pipeline.sadd(USER_INDEX_PREFIX + input.userId, id);
  pipeline.expire(USER_INDEX_PREFIX + input.userId, ttl);
  await pipeline.exec();

  return session;
}

export async function readSession(id: string): Promise<Session | null> {
  const raw = await redis.get(SESSION_PREFIX + id);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Session;
    // Back-fill CSRF token for sessions minted before #50. First read after
    // the deploy mints the token and persists it — the very next mutating
    // request from this tab can validate. Without this, every pre-#50
    // session would have to log-in-again for mutations to work.
    let mutated = false;
    if (!s.csrfToken) {
      s.csrfToken = genCsrfToken();
      mutated = true;
    }
    // Sliding-window refresh: touch if more than a minute old.
    //
    // #57 — impersonation sessions are HARD-DEADLINED. Refuse to slide
    // the TTL if this blob is an impersonation; the Redis key TTL was
    // already sized to fit impersonation_sessions.ends_at at mint time.
    // If we're past the deadline, destroy the session and return null
    // so the request is treated as unauthenticated.
    const now = Math.floor(Date.now() / 1000);
    if (s.impersonatedByPlatformUserId) {
      if (s.impersonationEndsAt && now >= s.impersonationEndsAt) {
        await redis.del(SESSION_PREFIX + id);
        await redis.srem(USER_INDEX_PREFIX + s.userId, id);
        return null;
      }
      // Skip sliding; impersonation sessions don't extend on activity.
    } else if (now - s.lastSeenAt > 60) {
      s.lastSeenAt = now;
      s.expiresAt = now + DEFAULT_TTL_SECONDS;
      mutated = true;
    }
    if (mutated) {
      // Keep the existing TTL for impersonation sessions; otherwise
      // rearm the default window.
      const ttl = s.impersonatedByPlatformUserId
        ? Math.max(1, (s.impersonationEndsAt ?? now) - now)
        : DEFAULT_TTL_SECONDS;
      await redis.set(SESSION_PREFIX + id, JSON.stringify(s), "EX", ttl);
    }
    return s;
  } catch {
    return null;
  }
}

export async function destroySession(id: string): Promise<void> {
  const raw = await redis.get(SESSION_PREFIX + id);
  if (raw) {
    try {
      const s = JSON.parse(raw) as Session;
      await redis.srem(USER_INDEX_PREFIX + s.userId, id);
    } catch {
      /* ignore */
    }
  }
  await redis.del(SESSION_PREFIX + id);
}

export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  const ids = await redis.smembers(USER_INDEX_PREFIX + userId);
  if (ids.length === 0) return;
  const keys = ids.map((id) => SESSION_PREFIX + id);
  await redis.del(...keys, USER_INDEX_PREFIX + userId);
}

// #52 / gap A3 — session management UI helpers.
//
// The secondary index `user-sessions:{userId}` is a Redis SET of session
// IDs, maintained by createSession (SADD) / destroySession (SREM). Listing
// does an MGET against the blobs in one round-trip; entries that come back
// null are orphans (session expired but the set entry didn't get cleaned
// up — possible when Redis evicts the blob before this helper notices, or
// when a prior version didn't SREM on destroy). We opportunistically clean
// those up on read so the set doesn't grow unbounded.

export async function listSessionsForUser(userId: string): Promise<Session[]> {
  const ids = await redis.smembers(USER_INDEX_PREFIX + userId);
  if (ids.length === 0) return [];
  const keys = ids.map((id) => SESSION_PREFIX + id);
  const blobs = await redis.mget(...keys);
  const sessions: Session[] = [];
  const orphans: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    const raw = blobs[i];
    const id = ids[i];
    if (!id) continue;
    if (!raw) {
      orphans.push(id);
      continue;
    }
    try {
      sessions.push(JSON.parse(raw) as Session);
    } catch {
      orphans.push(id);
    }
  }
  if (orphans.length > 0) {
    await redis.srem(USER_INDEX_PREFIX + userId, ...orphans);
  }
  // Most-recent-first so the current device tends to land at the top of
  // the list — but the caller decides display order, the helper is
  // deterministic but unopinionated.
  sessions.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  return sessions;
}

// Revoke a specific session. Returns true if we actually destroyed
// something (useful to tell "someone clicked twice on a stale UI" from
// "session didn't belong to this user"). Enforces ownership — the caller
// passes their userId and we only act if the session's userId matches.
// A session ID from a different user silently no-ops (returns false);
// callers should treat that as a 404.
export async function destroySessionForUser(
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const raw = await redis.get(SESSION_PREFIX + sessionId);
  if (!raw) {
    // Opportunistically prune the index entry if it's lingering.
    await redis.srem(USER_INDEX_PREFIX + userId, sessionId);
    return false;
  }
  try {
    const s = JSON.parse(raw) as Session;
    if (s.userId !== userId) return false;
    await redis.del(SESSION_PREFIX + sessionId);
    await redis.srem(USER_INDEX_PREFIX + userId, sessionId);
    return true;
  } catch {
    // Malformed blob — clean up and report no-op.
    await redis.del(SESSION_PREFIX + sessionId);
    await redis.srem(USER_INDEX_PREFIX + userId, sessionId);
    return false;
  }
}

// Revoke every session for this user except the one the caller is
// currently using. Returns the count of sessions destroyed so the UI can
// show "Signed out 3 other devices." If keepId doesn't belong to the
// user (or is expired) we still revoke the others — this is the panic
// button, not a normal flow.
export async function destroyOtherSessionsForUser(
  userId: string,
  keepId: string,
): Promise<number> {
  const ids = await redis.smembers(USER_INDEX_PREFIX + userId);
  const toKill = ids.filter((id) => id !== keepId);
  if (toKill.length === 0) return 0;
  const blobKeys = toKill.map((id) => SESSION_PREFIX + id);
  const pipeline = redis.multi();
  pipeline.del(...blobKeys);
  pipeline.srem(USER_INDEX_PREFIX + userId, ...toKill);
  await pipeline.exec();
  return toKill.length;
}
