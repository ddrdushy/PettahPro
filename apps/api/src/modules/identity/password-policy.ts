// Roadmap #49 (gaps A2) — password policy.
//
// Design notes:
//
//  * Two independent checks. `validatePasswordPolicy` is local + instant +
//    deterministic — length, character classes, obvious-weak list, not-same-
//    as-email/name. Any tenant sees it fire the moment they submit. Runs on
//    signup + change-password + any future admin-sets-password flow.
//
//  * `checkPasswordBreached` is the HIBP k-anonymity call — hash the password
//    with SHA-1, send ONLY the first 5 hex chars to api.pwnedpasswords.com,
//    match the suffix in the response body. The server never sees the
//    password. Gated behind `PASSWORD_BREACH_CHECK_DISABLED=true` so dev
//    workstations without internet still function. Fails OPEN on any
//    network / parse error — we'd rather accept a password than lock a
//    legit signup when HIBP is down. The local policy is still the
//    load-bearing check; breach is a belt-and-braces layer on top.
//
//  * NIST SP 800-63B is the reference. Deliberate choices from there:
//    - min length 10 (spec says 8, we go one step firmer for a finance app)
//    - no mandatory rotation (NIST 2017+ explicitly recommends against it —
//      forced rotation encourages predictable mutations like "pass1" →
//      "pass2" which are weaker than a stable strong password)
//    - no character-class mandates (NIST also recommends against these)
//      HOWEVER we do require "at least 3 of 4 classes" as a cheap way to
//      reject trivial ascenders ("aaaaaaaaaa"). Not a box-ticking exercise.
//    - compare against breach corpus (NIST §5.1.1.2 "prohibited passwords")
//
//  * No reuse prevention in v1 — would need a `password_history` table +
//    retention policy + tenant-level config. Worth doing but out of scope
//    for the S-sized promotion. Captured in `_gaps.md` follow-up.
import { createHash } from "node:crypto";

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

// Low-effort guesses we reject outright regardless of length. Not an
// exhaustive dictionary — the HIBP check handles the long tail. This list
// is for strings that aren't in HIBP because they're too SL-specific or
// PettahPro-specific (i.e. an attacker's first 5 tries against our tenants
// that wouldn't show up in a generic breach corpus).
const OBVIOUSLY_WEAK = new Set([
  "password",
  "password1",
  "password123",
  "passw0rd",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty",
  "qwerty123",
  "qwertyuiop",
  "letmein",
  "welcome",
  "welcome1",
  "admin",
  "admin123",
  "iloveyou",
  "pettahpro",
  "pettahpro1",
  "pettahpro123",
  "accounting",
  "accountant",
  "payroll",
  "payroll1",
  "invoice",
  "colombo",
  "srilanka",
  "srilanka1",
  "abcd1234",
  "p@ssword",
  "p@ssw0rd",
]);

export interface PasswordPolicyResult {
  ok: boolean;
  reasons: string[];
}

export interface PasswordValidationContext {
  email?: string;
  name?: string;
}

/**
 * Validate a candidate password against the local policy. Returns
 * `{ok: true, reasons: []}` on pass, or `{ok: false, reasons: [...]}`
 * with human-readable reasons on fail. All checks run (we don't short-
 * circuit on the first failure) so the UI can surface every reason at
 * once instead of making the user play whack-a-mole.
 */
export function validatePasswordPolicy(
  password: string,
  ctx: PasswordValidationContext = {},
): PasswordPolicyResult {
  const reasons: string[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) {
    reasons.push(`At least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    reasons.push(`At most ${PASSWORD_MAX_LENGTH} characters.`);
  }

  // At least 3 of 4 character classes. Blocks trivial ascenders without
  // forcing the "must include symbol" gymnastics NIST warns against.
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  // Unicode-aware non-alphanumeric, not just ASCII symbols.
  const hasSymbol = /[^\p{L}\p{N}]/u.test(password);
  const classCount =
    (hasLower ? 1 : 0) +
    (hasUpper ? 1 : 0) +
    (hasDigit ? 1 : 0) +
    (hasSymbol ? 1 : 0);
  if (classCount < 3) {
    reasons.push(
      "Mix of at least three of: lowercase, uppercase, digits, symbols.",
    );
  }

  const normalised = password.toLowerCase();
  if (OBVIOUSLY_WEAK.has(normalised)) {
    reasons.push("This password is too common — pick something less obvious.");
  }

  // Don't let a user set their email or name as their password. Compare
  // against the local-part and the full email, and the name tokens.
  if (ctx.email) {
    const email = ctx.email.toLowerCase();
    const localPart = email.split("@")[0] ?? "";
    if (normalised === email || (localPart.length >= 4 && normalised === localPart)) {
      reasons.push("Password can't be your email.");
    }
  }
  if (ctx.name) {
    const name = ctx.name.toLowerCase().trim();
    if (name.length >= 4 && normalised === name) {
      reasons.push("Password can't be your name.");
    }
  }

  return { ok: reasons.length === 0, reasons };
}

export interface BreachCheckResult {
  breached: boolean;
  /** Number of times the password appears in the HIBP corpus, if breached. */
  count?: number;
  /** When the check could not run (network error / feature disabled / offline). */
  skipped?: boolean;
  skipReason?: string;
}

/**
 * HIBP k-anonymity breach check. Sends only the first 5 SHA-1 hex chars
 * to api.pwnedpasswords.com — the full password hash never leaves this
 * process. Fails OPEN: a network blip, disabled flag, or parse error
 * returns `{breached: false, skipped: true}` so signup isn't blocked by
 * a flaky third party. Tune `PASSWORD_BREACH_CHECK_DISABLED=true` to
 * turn it off entirely (dev / offline / air-gapped deployments).
 */
export async function checkPasswordBreached(
  password: string,
): Promise<BreachCheckResult> {
  if (process.env.PASSWORD_BREACH_CHECK_DISABLED === "true") {
    return { breached: false, skipped: true, skipReason: "disabled_by_env" };
  }
  // SHA-1 is fine here — we're not hashing for storage, we're conforming
  // to the HIBP protocol which uses SHA-1 specifically.
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const controller = new AbortController();
    // Tight budget — we don't want to delay signup noticeably if HIBP is
    // slow. 1.5s is comfortably over p99 for the API under normal load.
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(
      `https://api.pwnedpasswords.com/range/${prefix}`,
      {
        method: "GET",
        headers: {
          "Add-Padding": "true",
          "User-Agent": "PettahPro-Password-Policy/1.0",
        },
        signal: controller.signal,
      },
    );
    clearTimeout(timer);
    if (!res.ok) {
      return { breached: false, skipped: true, skipReason: `http_${res.status}` };
    }
    const body = await res.text();
    // Response is lines of "<suffix>:<count>". Match the suffix.
    for (const line of body.split("\n")) {
      const [lineSuffix, countStr] = line.split(":");
      if (lineSuffix?.trim().toUpperCase() === suffix) {
        const count = Number(countStr?.trim() ?? "0");
        // Padding rows come back with count 0 (see Add-Padding header) —
        // treat them as not-found.
        if (count > 0) return { breached: true, count };
        return { breached: false };
      }
    }
    return { breached: false };
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "AbortError" ? "timeout" : "network_error";
    return { breached: false, skipped: true, skipReason: reason };
  }
}
