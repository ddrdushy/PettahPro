import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { PlatformStaffMember } from "@/lib/platform-api";
import { StaffClient } from "@/components/platform/staff-client";

// #56 — Platform staff management. Super-admin-only. Lists platform_users
// rows + lets you create/edit/delete. The API gates this super-admin-only
// already; the server-rendered guard here avoids flashing a "forbidden"
// error for non-super-admin users who typed the URL directly.

export const metadata: Metadata = {
  title: "Staff · Platform",
};

const API = process.env.INTERNAL_API_URL ?? "http://api:4000";

async function fetchMe(): Promise<{
  id: string;
  email: string;
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
      user: { id: string; email: string; role: string };
    };
    return body.user;
  } catch {
    return null;
  }
}

async function fetchStaff(): Promise<PlatformStaffMember[]> {
  const cookieHeader = cookies().toString();
  try {
    const res = await fetch(`${API}/platform/platform-users`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { users: PlatformStaffMember[] };
    return body.users;
  } catch {
    return [];
  }
}

export default async function PlatformStaffPage() {
  const me = await fetchMe();
  if (!me) redirect("/platform/login");
  // Non-super-admin users get bounced to the Account page with a clear
  // signal they don't have access. We don't 404 because the link exists
  // (in theory — the sidebar hides it) and 404 would be misleading.
  if (me.role !== "super_admin") redirect("/platform/account");

  const staff = await fetchStaff();

  return (
    <div className="px-6 py-10">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-h1 text-white">Staff</h1>
          <p className="mt-2 text-small text-white/70">
            Platform operators and their roles. Only super-admins can manage this list.
          </p>
        </div>
      </div>

      <StaffClient initialStaff={staff} currentUserId={me.id} />
    </div>
  );
}
