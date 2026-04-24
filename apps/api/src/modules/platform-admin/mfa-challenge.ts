// #55 / gap L1 v1 — Pre-session MFA challenge store for the platform console.
//
// Parallel to apps/api/src/modules/identity/mfa-challenge.ts (tenant
// side). Separate Redis keyspace (`platform-mfa-challenge:`) so a
// compromised tenant Redis blob can't be redeemed here, and vice versa.
// Smaller payload — platform users have no tenant, no isOwner flag;
// just the platform_user_id + email + IP + UA.

import { randomBytes } from "node:crypto";
import IORedis from "ioredis";

const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");

const CHALLENGE_PREFIX = "platform-mfa-challenge:";
const CHALLENGE_TTL_SECONDS = 5 * 60;

export interface PlatformMfaChallenge {
  id: string;
  platformUserId: string;
  email: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: number;
}

function genChallengeId(): string {
  return randomBytes(24).toString("base64url");
}

export async function createPlatformMfaChallenge(input: {
  platformUserId: string;
  email: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<PlatformMfaChallenge> {
  const id = genChallengeId();
  const now = Math.floor(Date.now() / 1000);
  const challenge: PlatformMfaChallenge = {
    id,
    platformUserId: input.platformUserId,
    email: input.email,
    ip: input.ip,
    userAgent: input.userAgent,
    createdAt: now,
  };
  await redis.set(
    CHALLENGE_PREFIX + id,
    JSON.stringify(challenge),
    "EX",
    CHALLENGE_TTL_SECONDS,
  );
  return challenge;
}

export async function readPlatformMfaChallenge(
  id: string,
): Promise<PlatformMfaChallenge | null> {
  const raw = await redis.get(CHALLENGE_PREFIX + id);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PlatformMfaChallenge;
  } catch {
    return null;
  }
}

export async function consumePlatformMfaChallenge(id: string): Promise<void> {
  await redis.del(CHALLENGE_PREFIX + id);
}
