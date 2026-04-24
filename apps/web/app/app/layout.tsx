import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { LogoutButton } from "@/components/auth/logout-button";
import { Sidebar } from "@/components/app/sidebar";
import { NotificationBell } from "@/components/app/notification-bell";
import { PermissionsProvider } from "@/components/auth/permissions-provider";
import { ImpersonationBanner } from "@/components/app/impersonation-banner";
import type { CallerPermissions, TenantSettings } from "@/lib/api";

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
      permissions: CallerPermissions;
      impersonation: {
        platformUserEmail: string;
        endsAt: string | null;
      } | null;
    };
  } catch {
    return null;
  }
}

// Tenant settings drive feature toggles shown in the sidebar (roadmap #30).
// Failure to load settings isn't fatal — we fall back to all toggles off.
async function fetchSettings(): Promise<TenantSettings | null> {
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return null;
  try {
    const res = await fetch(
      `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/settings`,
      { headers: { cookie: cookieHeader }, cache: "no-store" },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      settings: TenantSettings;
      defaults: TenantSettings;
    };
    return body.settings;
  } catch {
    return null;
  }
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const [me, settings] = await Promise.all([fetchMe(), fetchSettings()]);
  if (!me) redirect("/login");

  return (
    <div className="min-h-screen bg-offwhite">
      {me.impersonation && (
        <ImpersonationBanner
          platformUserEmail={me.impersonation.platformUserEmail}
          endsAt={me.impersonation.endsAt}
        />
      )}
      <header className="sticky top-0 z-30 border-b-hairline border-border bg-offwhite/95 backdrop-blur">
        <div className="flex h-16 items-center justify-between px-6">
          <Link href="/app" className="flex items-center gap-3">
            <span className="text-h3 font-medium text-charcoal">
              Pettah<span className="text-mint-dark">Pro</span>
            </span>
            <span aria-hidden className="h-5 w-px bg-border" />
            <span className="text-small text-text-secondary">{me.tenant.businessName}</span>
          </Link>

          <div className="flex items-center gap-4">
            <div className="hidden text-right sm:block">
              <p className="text-small font-medium text-charcoal">{me.user.fullName}</p>
              <p className="text-caption text-text-tertiary">
                {me.user.email}
                {me.user.isOwner && (
                  <span className="ml-2 rounded-full bg-mint-surface px-2 py-0.5 text-micro text-mint-dark">
                    Owner
                  </span>
                )}
              </p>
            </div>
            <NotificationBell />
            <LogoutButton />
          </div>
        </div>
      </header>

      <div className="flex">
        <Sidebar
          featureFlags={{
            purchaseRequisitionsEnabled:
              settings?.purchaseRequisitionsEnabled ?? false,
          }}
        />
        <div className="min-w-0 flex-1">
          <PermissionsProvider value={me.permissions}>{children}</PermissionsProvider>
        </div>
      </div>
    </div>
  );
}
