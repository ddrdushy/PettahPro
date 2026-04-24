// Roadmap #51 / gap A1 — Pre-session MFA challenge store (Redis).
//
// When a user passes password auth and has MFA enrolled, we do NOT
// mint a session — otherwise anyone with the password is effectively
// logged in for the 30-day session TTL before the MFA step verifies.
// Instead we stash a short-lived "challenge" record in Redis with
// just enough state to finish the login on the /auth/login/mfa step:
//   - userId / tenantId / email (to mint the real session after)
//   - ip + ua (to stamp on the audit record)
//   - createdAt (for telemetry / future lockout logic)
//
// TTL is 5 minutes. If the user fumbles the code for longer than
// that they restart from the password step — which is the right UX:
// the password is ambient in their manager; re-entering it is cheap,
// and it prevents a challenge ID that leaks via shared-device risk
// staying valid for hours.
//
// We intentionally DO NOT expose the TOTP secret in the challenge —
// step 2 fetches the secret from the DB via auth_get_mfa_for_user.
// Leaking Redis would leak challenge IDs (useless without the
// password step having succeeded) but not the secrets themselves.

import { randomBytes } from "node:crypto";
import IORedis from "ioredis";

const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");

const CHALLENGE_PREFIX = "mfa-challenge:";
const CHALLENGE_TTL_SECONDS = 5 * 60;

export interface MfaChallenge {
  id: string;
  userId: string;
  tenantId: string;
  email: string;
  isOwner: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: number;
}

function genChallengeId(): string {
  // Same shape as session IDs — 192 bits, base64url. Challenges are
  // one-shot and short-lived; this is overkill but costs nothing.
  return randomBytes(24).toString("base64url");
}

export async function createMfaChallenge(input: {
  userId: string;
  tenantId: string;
  email: string;
  isOwner: boolean;
  ip: string | null;
  userAgent: string | null;
}): Promise<MfaChallenge> {
  const id = genChallengeId();
  const now = Math.floor(Date.now() / 1000);
  const challenge: MfaChallenge = {
    id,
    userId: input.userId,
    tenantId: input.tenantId,
    email: input.email,
    isOwner: input.isOwner,
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

export async function readMfaChallenge(id: string): Promise<MfaChallenge | null> {
  const raw = await redis.get(CHALLENGE_PREFIX + id);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MfaChallenge;
  } catch {
    return null;
  }
}

export async function consumeMfaChallenge(id: string): Promise<void> {
  // Best-effort delete. If two tabs race on the same challenge the
  // second one will fail to find the challenge on read; the first
  // will have minted a session either way, so consumption is idempotent.
  await redis.del(CHALLENGE_PREFIX + id);
}
