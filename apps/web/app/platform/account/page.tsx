import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { PlatformAccountClient } from "@/components/platform/account-client";

export const metadata: Metadata = {
  title: "Account · Platform",
};

const API = process.env.INTERNAL_API_URL ?? "http://api:4000";

async function fetchMe(): Promise<{ email: string; fullName: string } | null> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return null;
  const res = await fetch(`${API}/platform/auth/me`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { user: { email: string; fullName: string } };
  return body.user;
}

export default async function PlatformAccountPage() {
  const me = await fetchMe();
  if (!me) redirect("/platform/login");

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-h1 text-white">Account</h1>
      <p className="mt-2 text-small text-white/70">
        Signed in as {me.fullName} ({me.email}).
      </p>
      <PlatformAccountClient />
    </div>
  );
}
