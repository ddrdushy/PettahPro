import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import type { DunningListPayload } from "@/lib/platform-api";
import { DunningClient } from "@/components/platform/dunning-client";

export const metadata: Metadata = {
  title: "Dunning · Platform",
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

async function fetchDunning(): Promise<DunningListPayload | null> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return null;
  try {
    const res = await fetch(`${API}/platform/dunning?status=all&limit=200`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as DunningListPayload;
  } catch {
    return null;
  }
}

export default async function DunningPage() {
  const me = await fetchMe();
  if (!me) redirect("/platform/login");

  const data = await fetchDunning();
  // Mutations require super_admin or billing. Support gets read-only.
  const canMutate = me.role === "super_admin" || me.role === "billing";

  return (
    <div className="px-6 py-10">
      <div className="flex items-center gap-3 text-caption text-white/50">
        <Link href="/platform" className="hover:text-white">
          Overview
        </Link>
        <span aria-hidden>›</span>
        <span className="text-white/70">Dunning</span>
      </div>
      <h1 className="mt-2 text-h1 text-white">Dunning</h1>
      <p className="mt-1 text-small text-white/60">
        Subscriptions whose last charge attempt failed, plus active
        subscriptions with at least one failure in the current period.
        Use this view to retry, mark paid out-of-band, suspend, or pause
        the dunning policy when a tenant is in dispute.
      </p>

      <DunningClient initialPayload={data} canMutate={canMutate} />
    </div>
  );
}
