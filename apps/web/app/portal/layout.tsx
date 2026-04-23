import Link from "next/link";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import type { PortalMeResult } from "@/lib/api";
import { PortalLogoutButton } from "./_components/logout-button";
import { PortalNav } from "./_components/portal-nav";

/**
 * Customer-facing portal shell (sell-module-spec §14).
 *
 * Distinct auth realm from the admin app — reads the `pp_portal_session`
 * cookie on the server, falls through to the public login page if the
 * customer isn't signed in. The login/verify pages render their own
 * content and don't call requireSession().
 *
 * Deliberately minimal chrome: a brand tag, the tenant business name
 * (once we know it), a small nav, and a logout button. Nothing that
 * would ever leak tenant internals.
 */
async function fetchPortalMe(): Promise<PortalMeResult | null> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return null;
  try {
    const res = await fetch(
      `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/portal/auth/me`,
      { headers: { cookie: cookieHeader }, cache: "no-store" },
    );
    if (!res.ok) return null;
    return (await res.json()) as PortalMeResult;
  } catch {
    return null;
  }
}

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const me = await fetchPortalMe();

  return (
    <div className="min-h-screen bg-offwhite">
      <header className="sticky top-0 z-30 border-b-hairline border-border bg-offwhite/95 backdrop-blur">
        <div className="flex h-16 items-center justify-between px-6">
          <Link href={me ? "/portal/invoices" : "/portal/login"} className="flex items-center gap-3">
            <span className="text-h3 font-medium text-charcoal">
              Pettah<span className="text-mint-dark">Pro</span>
            </span>
            {me && (
              <>
                <span aria-hidden className="h-5 w-px bg-border" />
                <span className="text-small text-text-secondary">{me.tenant.businessName}</span>
              </>
            )}
          </Link>

          {me && (
            <div className="flex items-center gap-4">
              <div className="hidden text-right sm:block">
                <p className="text-small font-medium text-charcoal">{me.customer.name}</p>
                <p className="text-caption text-text-tertiary">{me.customer.email ?? ""}</p>
              </div>
              <PortalLogoutButton />
            </div>
          )}
        </div>
        {me && <PortalNav />}
      </header>

      <div className="min-w-0">{children}</div>
    </div>
  );
}
