import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { LogoutButton } from "@/components/auth/logout-button";

async function fetchMe() {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return null;
  try {
    const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/auth/me`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      user: { id: string; email: string; fullName: string; isOwner: boolean };
      tenant: { id: string; slug: string; businessName: string };
    };
  } catch {
    return null;
  }
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await fetchMe();
  if (!me) redirect("/login");

  return (
    <div className="min-h-screen bg-offwhite">
      <header className="sticky top-0 z-30 border-b-hairline border-border bg-offwhite/90 backdrop-blur">
        <div className="container-p flex h-16 items-center justify-between">
          <Link href="/app" className="flex items-center gap-3">
            <span className="text-h3 font-medium text-charcoal">
              Pettah<span className="text-mint-dark">Pro</span>
            </span>
            <span
              aria-hidden
              className="h-5 w-px bg-border"
            />
            <span className="text-small text-text-secondary">{me.tenant.businessName}</span>
          </Link>

          <div className="flex items-center gap-4">
            <div className="hidden text-right sm:block">
              <p className="text-small font-medium text-charcoal">{me.user.fullName}</p>
              <p className="text-caption text-text-tertiary">
                {me.user.email}
                {me.user.isOwner && <span className="ml-2 rounded-full bg-mint-surface px-2 py-0.5 text-micro text-mint-dark">Owner</span>}
              </p>
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
