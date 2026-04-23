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
    // Sliding-window refresh: touch if more than a minute old
    const now = Math.floor(Date.now() / 1000);
    if (now - s.lastSeenAt > 60) {
      s.lastSeenAt = now;
      s.expiresAt = now + DEFAULT_TTL_SECONDS;
      mutated = true;
    }
    if (mutated) {
      await redis.set(SESSION_PREFIX + id, JSON.stringify(s), "EX", DEFAULT_TTL_SECONDS);
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
