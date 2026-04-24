import Link from "next/link";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import type { ReactNode } from "react";

// Deliberately separate from /app/* layout (#54 / gap L1). No tenant
// chrome, no notification bell, no permissions provider. Platform
// admins operate the platform, not the businesses — the UI should look
// and feel different so no one thinks they're inside a tenant's books.

export const metadata: Metadata = {
  title: "PettahPro Platform",
  description: "PettahPro platform administration.",
};

const API = process.env.INTERNAL_API_URL ?? "http://api:4000";

// #56 — the header fetches the current session role purely to decide
// whether to show the "Staff" link (super-admin-only). Failures are
// swallowed: on /platform/login the session doesn't exist yet, and
// we'd rather render the header without the staff entry than crash the
// layout for the login page.
async function fetchRole(): Promise<string | null> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return null;
  try {
    const res = await fetch(`${API}/platform/auth/me`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { user?: { role?: string } };
    return body.user?.role ?? null;
  } catch {
    return null;
  }
}

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const role = await fetchRole();
  const isSuperAdmin = role === "super_admin";
  // #57 — /platform/impersonation is the request queue + active session
  // dashboard. super_admin + support both live there (support sees own
  // only, super_admin sees all); billing never operates impersonation.
  const canImpersonate = role === "super_admin" || role === "support";

  return (
    <div className="min-h-screen bg-charcoal text-white">
      <header className="border-b border-white/10 bg-black/40 backdrop-blur">
        <div className="flex h-14 items-center justify-between px-6">
          <Link href="/platform" className="flex items-center gap-3">
            <span className="text-h3 font-medium text-white">
              Pettah<span className="text-mint">Pro</span>
            </span>
            <span aria-hidden className="h-4 w-px bg-white/20" />
            <span className="text-small uppercase tracking-wide text-mint">Platform</span>
          </Link>
          <nav className="flex items-center gap-4 text-small text-white/80">
            <Link href="/platform" className="hover:text-white">
              Overview
            </Link>
            <Link href="/platform/tenants" className="hover:text-white">
              Tenants
            </Link>
            <Link href="/platform/audit" className="hover:text-white">
              Audit
            </Link>
            {canImpersonate && (
              <Link href="/platform/impersonation" className="hover:text-white">
                Impersonation
              </Link>
            )}
            {isSuperAdmin && (
              <Link href="/platform/staff" className="hover:text-white">
                Staff
              </Link>
            )}
            <Link href="/platform/account" className="hover:text-white">
              Account
            </Link>
          </nav>
        </div>
      </header>
      <main className="min-h-[calc(100vh-3.5rem)]">{children}</main>
    </div>
  );
}
