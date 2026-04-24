import type { Metadata } from "next";
import { cookies } from "next/headers";
import { PageHeader } from "@/components/app/page-header";
import { SecurityClient, type MfaStatus } from "./security-client";

export const metadata: Metadata = { title: "Two-factor authentication" };

// Pre-fetch the MFA status server-side so the page renders with the
// correct "enabled" / "not enrolled" card without a client-side flash.
// Falls back to `{ enabled: false, ... }` on any error so the user still
// sees an actionable page (they can always try enrolling; if MFA is
// already on, the API will reject with MFA_ALREADY_ENABLED and the
// client surfaces that cleanly).
async function fetchStatus(): Promise<MfaStatus> {
  const fallback: MfaStatus = {
    enabled: false,
    enrolledAt: null,
    lastUsedAt: null,
    backupCodesRemaining: 0,
  };
  try {
    const res = await fetch(
      `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/auth/mfa/status`,
      { headers: { cookie: cookies().toString() }, cache: "no-store" },
    );
    if (!res.ok) return fallback;
    return (await res.json()) as MfaStatus;
  } catch {
    return fallback;
  }
}

export default async function SecurityPage() {
  const status = await fetchStatus();
  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Account"
        title="Two-factor authentication"
        description="A second step at sign-in that stops a stolen password from being enough. Uses a time-based code from an authenticator app (Google Authenticator, 1Password, Authy, Bitwarden, etc). Save your backup codes somewhere safe — they're the only way in if you lose your phone."
      />
      <section className="mt-6 max-w-2xl">
        <SecurityClient initialStatus={status} />
      </section>
    </main>
  );
}
