"use client";

// #49 — live, client-side strength hint. Mirrors the server-side policy
// in apps/api/src/modules/identity/password-policy.ts so users see the
// same rules before submit that the server will check after submit.
//
// Deliberately does NOT block submission client-side — the server is the
// source of truth, and a user might want to submit even against a soft
// warning (e.g. they're past all the checks but want to see the
// breach-check result). The form's submit button stays enabled; if the
// server rejects, reasons come back through the ApiError.reasons field.

const MIN_LENGTH = 10;

interface Props {
  password: string;
  email?: string;
  name?: string;
}

interface Check {
  label: string;
  ok: boolean;
}

function evaluateChecks(password: string, email?: string, name?: string): Check[] {
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSymbol = /[^\p{L}\p{N}]/u.test(password);
  const classCount =
    (hasLower ? 1 : 0) +
    (hasUpper ? 1 : 0) +
    (hasDigit ? 1 : 0) +
    (hasSymbol ? 1 : 0);
  const normalised = password.toLowerCase();
  const emailLocal = email?.toLowerCase().split("@")[0] ?? "";
  const looksLikeIdentity =
    (email && (normalised === email.toLowerCase() || (emailLocal.length >= 4 && normalised === emailLocal))) ||
    (name && name.trim().length >= 4 && normalised === name.toLowerCase().trim());

  return [
    { label: `At least ${MIN_LENGTH} characters`, ok: password.length >= MIN_LENGTH },
    {
      label: "Mix of at least 3 of: lowercase, uppercase, digits, symbols",
      ok: classCount >= 3,
    },
    {
      label: "Not your email or name",
      ok: password.length > 0 && !looksLikeIdentity,
    },
  ];
}

export function PasswordStrengthHint({ password, email, name }: Props) {
  if (!password) return null;
  const checks = evaluateChecks(password, email, name);
  const allOk = checks.every((c) => c.ok);

  return (
    <ul className="space-y-1 text-caption">
      {checks.map((c) => (
        <li
          key={c.label}
          className={c.ok ? "text-mint-dark" : "text-text-tertiary"}
        >
          <span aria-hidden className="mr-1.5">
            {c.ok ? "✓" : "·"}
          </span>
          {c.label}
        </li>
      ))}
      {allOk && (
        <li className="mt-1 text-text-tertiary">
          <span aria-hidden className="mr-1.5">
            ·
          </span>
          We'll also check this password against public breach corpora on
          submit.
        </li>
      )}
    </ul>
  );
}
