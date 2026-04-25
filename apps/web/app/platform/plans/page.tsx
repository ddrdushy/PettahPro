import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import type { PlatformPlan } from "@/lib/platform-api";
import { PlansClient } from "@/components/platform/plans-client";

export const metadata: Metadata = {
  title: "Plans · Platform",
};

const API = process.env.INTERNAL_API_URL ?? "http://api:4000";

// #61 catalogue + plan editor (this PR). The list reads any role; the
// mutation buttons render only for super_admin (role gate enforced
// server-side; the UI mirrors the gate to avoid showing buttons that
// would 403).

async function fetchMe(): Promise<{
  email: string;
  fullName: string;
  role: string;
} | null> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return null;
  try {
    const res = await fetch(`${API}/platform/auth/me`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      user: { email: string; fullName: string; role: string };
    };
    return body.user;
  } catch {
    return null;
  }
}

async function fetchPlans(): Promise<PlatformPlan[]> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return [];
  try {
    const res = await fetch(`${API}/platform/plans`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { plans: PlatformPlan[] };
    return body.plans;
  } catch {
    return [];
  }
}

export default async function PlatformPlansPage() {
  const me = await fetchMe();
  if (!me) redirect("/platform/login");

  const plans = await fetchPlans();
  const canEdit = me.role === "super_admin";

  return (
    <div className="px-6 py-10">
      <div className="flex items-center gap-3 text-caption text-white/50">
        <Link href="/platform" className="hover:text-white">
          Overview
        </Link>
        <span aria-hidden>›</span>
        <span className="text-white/70">Plans</span>
      </div>
      <h1 className="mt-2 text-h1 text-white">Plan catalogue</h1>
      <p className="mt-1 text-small text-white/60">
        {canEdit
          ? "Edit prices, caps, and features without a deploy. Existing tenants on archived plans stay grandfathered."
          : "Read-only — sign in as a super-admin to edit plans."}
      </p>

      <PlansClient initialPlans={plans} canEdit={canEdit} />
    </div>
  );
}
