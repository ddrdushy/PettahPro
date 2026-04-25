import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import type { PlatformCoupon } from "@/lib/platform-api";
import { CouponsClient } from "@/components/platform/coupons-client";

export const metadata: Metadata = {
  title: "Coupons · Platform",
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

async function fetchCoupons(): Promise<PlatformCoupon[]> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return [];
  try {
    const res = await fetch(`${API}/platform/coupons`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { coupons: PlatformCoupon[] };
    return body.coupons;
  } catch {
    return [];
  }
}

export default async function PlatformCouponsPage() {
  const me = await fetchMe();
  if (!me) redirect("/platform/login");

  const coupons = await fetchCoupons();
  const canEdit = me.role === "super_admin";

  return (
    <div className="px-6 py-10">
      <div className="flex items-center gap-3 text-caption text-white/50">
        <Link href="/platform" className="hover:text-white">
          Overview
        </Link>
        <span aria-hidden>›</span>
        <span className="text-white/70">Coupons</span>
      </div>
      <h1 className="mt-2 text-h1 text-white">Coupon catalogue</h1>
      <p className="mt-1 text-small text-white/60">
        {canEdit
          ? "Promotional codes for marketing campaigns and partner deals. Discounts apply to the next billing cycle when real billing wires up; redemptions are tracked here regardless."
          : "Read-only — sign in as a super-admin to edit coupons."}
      </p>

      <CouponsClient initialCoupons={coupons} canEdit={canEdit} />
    </div>
  );
}
