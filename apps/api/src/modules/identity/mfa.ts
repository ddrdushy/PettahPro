// Roadmap #51 / gap A1 — MFA (TOTP) crypto + helpers.
//
// Responsibilities:
//   - Generate TOTP secrets + otpauth:// URIs + QR data URLs for enrolment.
//   - Verify TOTP codes with a ±1 window (30s period). Window on both
//     sides covers clock-skew between the user's phone and the server.
//     Wider = friendlier, but also widens the brute-force window; one
//     step either side (so ~90s total) is the standard accepted trade.
//   - Encrypt / decrypt the TOTP secret at rest (aes-256-gcm). The DB
//     never sees plaintext.
//   - Generate + verify single-use backup codes (argon2-hashed, like
//     passwords, not cheap hashed — the hash cost is the defence against
//     "attacker steals hash array and brute-forces").
//
// Encryption key
// --------------
// Prefers `MFA_ENCRYPTION_KEY` (32 bytes, base64-encoded). If absent,
// derives a key from `SESSION_SECRET` via HKDF and logs a warning —
// the key SHOULD be set independently in prod, both so rotating the
// session secret doesn't invalidate every MFA row, and so the key
// can be held separately (e.g. loaded from a KMS at boot).
//
// Format on disk
// --------------
// Ciphertext blob = base64url( iv(12) || authTag(16) || ciphertext(n) )
// Single column, easy to rotate: re-encrypt-and-update keeps the same
// column shape. If we ever need versioned keys, prefix the blob with a
// 1-byte version — today there's only version 0.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { authenticator } from "otplib";
import QRCode from "qrcode";

// 30s period, 6 digits, SHA1 — the Google Authenticator / 1Password /
// Authy / YubiKey defaults. Matches what every TOTP app expects when
// scanning an otpauth:// URI without parameters.
authenticator.options = {
  digits: 6,
  step: 30,
  window: 1, // accept ±1 step for clock skew. See module header.
};

const AES_ALGORITHM = "aes-256-gcm";
const AES_KEY_LEN = 32;
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;

// Issuer label shown inside the user's TOTP app. Kept static here so a
// dev instance and prod instance both show "PettahPro" and not the
// hostname — otherwise a user scanning the dev QR sees a different
// issuer label than prod and thinks it's a different account.
const OTPAUTH_ISSUER = "PettahPro";

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.MFA_ENCRYPTION_KEY;
  if (fromEnv) {
    // Accept both base64 and base64url — either encoding is fine, we
    // decode them the same way.
    const buf = Buffer.from(fromEnv, "base64");
    if (buf.length !== AES_KEY_LEN) {
      throw new Error(
        `MFA_ENCRYPTION_KEY must decode to ${AES_KEY_LEN} bytes (got ${buf.length}). ` +
          `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
      );
    }
    cachedKey = buf;
    return cachedKey;
  }
  // Dev fallback: derive from SESSION_SECRET via HKDF with a fixed
  // salt + info label so the derivation is deterministic and different
  // from any other key derived from SESSION_SECRET. NOT suitable for
  // prod (see module header) — log a loud warning at boot by the
  // caller.
  const sessionSecret = process.env.SESSION_SECRET ?? "dev-session-secret-change-me";
  const derived = hkdfSync(
    "sha256",
    sessionSecret,
    "pettahpro-mfa-v0", // salt
    "pettahpro-mfa-totp-encryption-v0", // info
    AES_KEY_LEN,
  );
  cachedKey = Buffer.from(derived);
  return cachedKey;
}

export function hasDedicatedMfaKey(): boolean {
  return Boolean(process.env.MFA_ENCRYPTION_KEY);
}

export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(AES_ALGORITHM, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decryptSecret(blob: string): string {
  const key = loadKey();
  const raw = Buffer.from(blob, "base64url");
  if (raw.length < IV_LEN + AUTH_TAG_LEN + 1) {
    throw new Error("MFA ciphertext blob too short");
  }
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
  const ciphertext = raw.subarray(IV_LEN + AUTH_TAG_LEN);
  const decipher = createDecipheriv(AES_ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function generateTotpSecret(): string {
  // otplib's generateSecret returns a base32-encoded string, the
  // canonical TOTP secret format.
  return authenticator.generateSecret();
}

export function buildOtpauthUri(email: string, secret: string): string {
  return authenticator.keyuri(email, OTPAUTH_ISSUER, secret);
}

export async function buildQrCodeDataUrl(otpauthUri: string): Promise<string> {
  // PNG data URL is the easiest "just drop this in an <img>" shape for
  // the web client. Errors here should bubble — if we can't render the
  // QR, the otpauth URI fallback ("enter this code manually") is still
  // returned by the enrol endpoint.
  return QRCode.toDataURL(otpauthUri, { margin: 1, width: 240 });
}

export function verifyTotp(secret: string, code: string): boolean {
  // authenticator.check is constant-time internally, and returns false
  // for malformed codes instead of throwing.
  try {
    return authenticator.check(code.replace(/\s+/g, ""), secret);
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------
// Backup codes
// --------------------------------------------------------------------
//
// 10 single-use codes, each 10 characters drawn from an unambiguous
// alphabet (no 0/O, no 1/I) — meant to be printed or pasted into a
// password manager. Displayed once at enrol time; the DB only stores
// argon2 hashes. Consumption removes a code's hash from the array (the
// "used" state is implicit).
//
// We hash even though collisions are cryptographically impossible at
// this alphabet size (62^10 ≈ 8.4×10^17 — a 1-in-10^14 collision for
// 10 codes) because:
//  1) a stolen DB dump shouldn't hand attackers working codes, even if
//     the encryption key is rotated afterwards.
//  2) consistent with how the password module treats stored secrets.
//
// Argon2 cost is the same as password-policy.ts (via @node-rs/argon2's
// defaults) — verifying 10 hashes on each login attempt is <100ms on a
// modern box, and only happens when a user falls through TOTP.

const BACKUP_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const BACKUP_CODE_LENGTH = 10;
const BACKUP_CODE_COUNT = 10;

export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const buf = randomBytes(BACKUP_CODE_LENGTH);
    let code = "";
    for (let j = 0; j < BACKUP_CODE_LENGTH; j++) {
      // Modulo bias on 32-letter alphabet vs 256-value byte: 256 / 32 = 8
      // exactly, so there's zero bias here — every letter has exactly 8
      // byte values mapping to it.
      const byte = buf[j] ?? 0;
      code += BACKUP_CODE_ALPHABET[byte % BACKUP_CODE_ALPHABET.length];
    }
    codes.push(code);
  }
  return codes;
}

export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => argon2Hash(c)));
}

/**
 * Verify a user-submitted backup code against the stored hash array.
 * Returns the remaining hash array with the consumed hash removed,
 * or null if no hash matched. Caller is responsible for writing the
 * shortened array back to the DB.
 */
export async function consumeBackupCode(
  submitted: string,
  storedHashes: string[],
): Promise<string[] | null> {
  const normalized = submitted.replace(/\s+/g, "").toUpperCase();
  // Linear scan — up to 10 argon2 verifies. Not great for
  // throughput, but the call path is "user typed a backup code on
  // login," which is inherently interactive and rate-limited.
  for (let i = 0; i < storedHashes.length; i++) {
    const h = storedHashes[i];
    if (!h) continue;
    try {
      if (await argon2Verify(h, normalized)) {
        // Consume: return the array minus the matched hash.
        return [...storedHashes.slice(0, i), ...storedHashes.slice(i + 1)];
      }
    } catch {
      // argon2Verify throws on malformed stored hashes. Skip; don't
      // let a single bad row kill the whole verification.
      continue;
    }
  }
  return null;
}
