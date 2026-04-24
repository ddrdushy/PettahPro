import Link from "next/link";
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

export default function PlatformLayout({ children }: { children: ReactNode }) {
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
              Tenants
            </Link>
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
