import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import type { TenantHealthRow } from "@/lib/platform-api";
import { TenantHealthClient } from "@/components/platform/tenant-health-client";

export const metadata: Metadata = {
  title: "Tenant health · Platform",
};

const API = process.env.INTERNAL_API_URL ?? "http://api:4000";

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

interface HealthPayload {
  tenants: TenantHealthRow[];
  byRisk: {
    low: number;
    medium: number;
    high: number;
    critical: number;
    not_scored: number;
  };
}

async function fetchHealth(): Promise<HealthPayload | null> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return null;
  try {
    const res = await fetch(`${API}/platform/health-scores?limit=200`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as HealthPayload;
  } catch {
    return null;
  }
}

export default async function TenantHealthPage() {
  const me = await fetchMe();
  if (!me) redirect("/platform/login");

  const data = await fetchHealth();
  const canRunSweep = me.role === "super_admin";

  return (
    <div className="px-6 py-10">
      <div className="flex items-center gap-3 text-caption text-white/50">
        <Link href="/platform" className="hover:text-white">
          Overview
        </Link>
        <span aria-hidden>›</span>
        <span className="text-white/70">Tenant health</span>
      </div>
      <h1 className="mt-2 text-h1 text-white">Tenant health</h1>
      <p className="mt-1 text-small text-white/60">
        Daily-recomputed churn-risk score per tenant. Sub-scores show
        why — login activity, transaction trend, subscription state,
        setup completeness. Critical and high tenants are the
        Customer Success outreach queue.
      </p>

      <TenantHealthClient
        initialPayload={data}
        canRunSweep={canRunSweep}
      />
    </div>
  );
}
