import { randomBytes } from "node:crypto";
import IORedis from "ioredis";

/**
 * Portal sessions are a separate realm from the admin `pp_session` — a
 * customer logging into the portal must never see admin endpoints, and
 * a logged-in admin must never accidentally auth against a portal data
 * endpoint. Different Redis prefix, different cookie, different cookie
 * name, different onRequest handler.
 */

const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");

const SESSION_PREFIX = "portal-session:";
const CUSTOMER_INDEX_PREFIX = "portal-customer-sessions:";
// Portal sessions are shorter-lived than admin sessions — the customer
// re-logs in with a fresh OTP every 14 days. Balances convenience vs.
// the fact that OTP is the only factor.
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 14;

const OTP_RATE_PREFIX = "portal-otp-rate:";
// Rate-limit: max 5 OTP requests per email per hour.
const OTP_RATE_WINDOW_SECONDS = 60 * 60;
const OTP_RATE_MAX = 5;

const VERIFY_RATE_PREFIX = "portal-verify-rate:";
// Rate-limit: max 10 verify attempts per email per hour. 6-digit codes
// have 1M combinations and expire in 10 minutes, so 10/hour is far
// below the 1-in-100k-ish probability of a successful brute force while
// still leaving generous headroom for mistyped digits.
const VERIFY_RATE_WINDOW_SECONDS = 60 * 60;
const VERIFY_RATE_MAX = 10;

export interface PortalSession {
  id: string;
  tenantId: string;
  customerId: string;
  email: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

function genSessionId(): string {
  return randomBytes(24).toString("base64url");
}

export async function createPortalSession(input: {
  tenantId: string;
  customerId: string;
  email: string;
  ttlSeconds?: number;
}): Promise<PortalSession> {
  const id = genSessionId();
  const now = Math.floor(Date.now() / 1000);
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const session: PortalSession = {
    id,
    tenantId: input.tenantId,
    customerId: input.customerId,
    email: input.email,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + ttl,
  };

  const pipeline = redis.multi();
  pipeline.set(SESSION_PREFIX + id, JSON.stringify(session), "EX", ttl);
  pipeline.sadd(CUSTOMER_INDEX_PREFIX + input.customerId, id);
  pipeline.expire(CUSTOMER_INDEX_PREFIX + input.customerId, ttl);
  await pipeline.exec();

  return session;
}

export async function readPortalSession(id: string): Promise<PortalSession | null> {
  const raw = await redis.get(SESSION_PREFIX + id);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as PortalSession;
    const now = Math.floor(Date.now() / 1000);
    // Sliding refresh — touch if more than a minute old so an idle tab
    // doesn't expire on the customer mid-read.
    if (now - s.lastSeenAt > 60) {
      s.lastSeenAt = now;
      s.expiresAt = now + DEFAULT_TTL_SECONDS;
      await redis.set(SESSION_PREFIX + id, JSON.stringify(s), "EX", DEFAULT_TTL_SECONDS);
    }
    return s;
  } catch {
    return null;
  }
}

export async function destroyPortalSession(id: string): Promise<void> {
  const raw = await redis.get(SESSION_PREFIX + id);
  if (raw) {
    try {
      const s = JSON.parse(raw) as PortalSession;
      await redis.srem(CUSTOMER_INDEX_PREFIX + s.customerId, id);
    } catch {
      /* ignore */
    }
  }
  await redis.del(SESSION_PREFIX + id);
}

/**
 * Checks whether this email has exceeded its OTP request budget. Returns
 * { ok: true } if the caller may mint another code, or { ok: false,
 * retryAfterSeconds } to tell the UI how long to wait. Uses INCR with a
 * set-expiry-on-first-increment pattern so the window rolls off on its
 * own without a scheduled flush.
 */
export async function tryConsumeOtpRateBudget(
  email: string,
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const key = OTP_RATE_PREFIX + email.toLowerCase();
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, OTP_RATE_WINDOW_SECONDS);
  }
  if (count > OTP_RATE_MAX) {
    const ttl = await redis.ttl(key);
    return {
      ok: false,
      retryAfterSeconds: ttl > 0 ? ttl : OTP_RATE_WINDOW_SECONDS,
    };
  }
  return { ok: true };
}

/**
 * Gates brute-force attempts against /portal/auth/verify. Counts every
 * attempt (success or failure), same rolling window as OTP requests, so
 * an attacker can't burn the code space by hammering verify. We don't
 * reset on success — a legitimate user retries at most a handful of
 * times before they're in, so 10/hour is plenty.
 */
export async function tryConsumeVerifyRateBudget(
  email: string,
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const key = VERIFY_RATE_PREFIX + email.toLowerCase();
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, VERIFY_RATE_WINDOW_SECONDS);
  }
  if (count > VERIFY_RATE_MAX) {
    const ttl = await redis.ttl(key);
    return {
      ok: false,
      retryAfterSeconds: ttl > 0 ? ttl : VERIFY_RATE_WINDOW_SECONDS,
    };
  }
  return { ok: true };
}
