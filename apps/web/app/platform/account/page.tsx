import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { PlatformAccountClient } from "@/components/platform/account-client";

export const metadata: Metadata = {
  title: "Account · Platform",
};

const API = process.env.INTERNAL_API_URL ?? "http://api:4000";

async function fetchMe(): Promise<{
  email: string;
  fullName: string;
  role: string;
} | null> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return null;
  const res = await fetch(`${API}/platform/auth/me`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    user: { email: string; fullName: string; role: string };
  };
  return body.user;
}

// #56 — roles render as short pills so support/billing can see at a
// glance what they're signed in as (and so a super-admin can verify the
// role they think they have is the role the session actually carries).
const ROLE_LABELS: Record<string, { label: string; cls: string }> = {
  super_admin: { label: "Super admin", cls: "bg-mint/20 text-mint" },
  support: { label: "Support", cls: "bg-sky-500/20 text-sky-200" },
  billing: { label: "Billing", cls: "bg-amber-400/20 text-amber-200" },
};

export default async function PlatformAccountPage() {
  const me = await fetchMe();
  if (!me) redirect("/platform/login");

  const pill = ROLE_LABELS[me.role] ?? {
    label: me.role,
    cls: "bg-white/10 text-white/70",
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-h1 text-white">Account</h1>
      <p className="mt-2 text-small text-white/70">
        Signed in as {me.fullName} ({me.email}).
      </p>
      <div className="mt-2 text-small text-white/70">
        Role:{" "}
        <span className={`inline-flex rounded-full px-2 py-0.5 text-caption ${pill.cls}`}>
          {pill.label}
        </span>
      </div>
      <PlatformAccountClient />
    </div>
  );
}
