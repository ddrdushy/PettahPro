import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import type { PlatformAddon } from "@/lib/platform-api";
import { AddonsClient } from "@/components/platform/addons-client";

export const metadata: Metadata = {
  title: "Add-ons · Platform",
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

async function fetchAddons(): Promise<PlatformAddon[]> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return [];
  try {
    const res = await fetch(`${API}/platform/addons`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { addons: PlatformAddon[] };
    return body.addons;
  } catch {
    return [];
  }
}

export default async function PlatformAddonsPage() {
  const me = await fetchMe();
  if (!me) redirect("/platform/login");

  const addons = await fetchAddons();
  const canEdit = me.role === "super_admin";

  return (
    <div className="px-6 py-10">
      <div className="flex items-center gap-3 text-caption text-white/50">
        <Link href="/platform" className="hover:text-white">
          Overview
        </Link>
        <span aria-hidden>›</span>
        <span className="text-white/70">Add-ons</span>
      </div>
      <h1 className="mt-2 text-h1 text-white">Add-on catalogue</h1>
      <p className="mt-1 text-small text-white/60">
        {canEdit
          ? "Individual gated features tenants can buy without upgrading their full tier. Auto-removed when the tenant's plan starts including the same feature."
          : "Read-only — sign in as a super-admin to edit add-ons."}
      </p>

      <AddonsClient initialAddons={addons} canEdit={canEdit} />
    </div>
  );
}
