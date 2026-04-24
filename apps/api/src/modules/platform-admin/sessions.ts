import { randomBytes } from "node:crypto";
import IORedis from "ioredis";

// Separate Redis keyspace from tenant sessions (#54 / gap L1). Platform
// sessions belong to a different principal type — we never want a tenant
// session ID to match a platform session ID (or vice versa) even by
// accident, so the prefix is distinct and the cookie name is distinct.

const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");

const SESSION_PREFIX = "platform-session:";
const USER_INDEX_PREFIX = "platform-user-sessions:";
// Shorter than tenant sessions on purpose. A platform admin session is
// high-value — it can suspend every tenant on the platform. 12 hours
// sliding balances "don't nag the operator every time they tab away"
// with "don't leave a goldmine on an unlocked laptop overnight."
const DEFAULT_TTL_SECONDS = 60 * 60 * 12;

export interface PlatformSession {
  id: string;
  platformUserId: string;
  email: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  csrfToken: string;
  ip?: string | null;
  userAgent?: string | null;
}

function genSessionId(): string {
  return randomBytes(24).toString("base64url");
}

function genCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createPlatformSession(input: {
  platformUserId: string;
  email: string;
  ttlSeconds?: number;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<PlatformSession> {
  const id = genSessionId();
  const now = Math.floor(Date.now() / 1000);
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const session: PlatformSession = {
    id,
    platformUserId: input.platformUserId,
    email: input.email,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + ttl,
    csrfToken: genCsrfToken(),
    ip: input.ip ?? null,
    userAgent: input.userAgent ? input.userAgent.slice(0, 512) : null,
  };

  const pipeline = redis.multi();
  pipeline.set(SESSION_PREFIX + id, JSON.stringify(session), "EX", ttl);
  pipeline.sadd(USER_INDEX_PREFIX + input.platformUserId, id);
  pipeline.expire(USER_INDEX_PREFIX + input.platformUserId, ttl);
  await pipeline.exec();

  return session;
}

export async function readPlatformSession(id: string): Promise<PlatformSession | null> {
  const raw = await redis.get(SESSION_PREFIX + id);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as PlatformSession;
    let mutated = false;
    if (!s.csrfToken) {
      s.csrfToken = genCsrfToken();
      mutated = true;
    }
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

export async function destroyPlatformSession(id: string): Promise<void> {
  const raw = await redis.get(SESSION_PREFIX + id);
  if (raw) {
    try {
      const s = JSON.parse(raw) as PlatformSession;
      await redis.srem(USER_INDEX_PREFIX + s.platformUserId, id);
    } catch {
      /* ignore */
    }
  }
  await redis.del(SESSION_PREFIX + id);
}
