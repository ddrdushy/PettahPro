import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Hash, ArrowRight, Bell, CheckCircle2, UserCog, Coins, FileText, KeyRound, ShieldCheck } from "lucide-react";
import type { TenantSettingsResponse } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { SettingsFormClient } from "./settings-form-client";

export const metadata: Metadata = { title: "Settings" };

async function fetchSettings(): Promise<TenantSettingsResponse | null> {
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/settings`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as TenantSettingsResponse;
}

export default async function SettingsPage() {
  const data = await fetchSettings();

  if (!data) {
    return (
      <main className="container-p py-10">
        <PageHeader eyebrow="Admin" title="Settings" description="Couldn't load tenant settings." />
      </main>
    );
  }

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        description="Per-tenant preferences that affect how payroll, invoices, and other workflows behave. Changes apply to new documents going forward — historical records are untouched."
      />
      <SettingsFormClient initial={data.settings} defaults={data.defaults} />

      <section className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-6">
        <h2 className="text-body font-medium text-charcoal">More settings</h2>
        <div className="mt-4 space-y-2">
          <Link
            href="/app/settings/number-series"
            className="flex items-center justify-between rounded-md border-hairline border-border px-4 py-3 hover:bg-surface-recessed/40"
          >
            <div className="flex items-start gap-3">
              <Hash className="mt-0.5 h-4 w-4 text-text-tertiary" aria-hidden />
              <div>
                <p className="text-small font-medium text-charcoal">Number series</p>
                <p className="text-caption text-text-secondary">
                  Customise invoice, bill, journal and other document number formats. Supports tokens like <code>{"{YYYY}"}</code> <code>{"{MM}"}</code> <code>{"{SEQ}"}</code>.
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-text-tertiary" aria-hidden />
          </Link>
          <Link
            href="/app/settings/notifications"
            className="flex items-center justify-between rounded-md border-hairline border-border px-4 py-3 hover:bg-surface-recessed/40"
          >
            <div className="flex items-start gap-3">
              <Bell className="mt-0.5 h-4 w-4 text-text-tertiary" aria-hidden />
              <div>
                <p className="text-small font-medium text-charcoal">Notifications</p>
                <p className="text-caption text-text-secondary">
                  Choose which in-app notifications you receive — invoices posted, payments recorded, journals pending review, and more.
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-text-tertiary" aria-hidden />
          </Link>
          <Link
            href="/app/settings/approvals"
            className="flex items-center justify-between rounded-md border-hairline border-border px-4 py-3 hover:bg-surface-recessed/40"
          >
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-text-tertiary" aria-hidden />
              <div>
                <p className="text-small font-medium text-charcoal">Approval workflows</p>
                <p className="text-caption text-text-secondary">
                  Design linear approval chains for journals, expense claims, purchase orders and more. Trigger by amount or submitter; route to roles or named users.
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-text-tertiary" aria-hidden />
          </Link>
          <Link
            href="/app/settings/roles"
            className="flex items-center justify-between rounded-md border-hairline border-border px-4 py-3 hover:bg-surface-recessed/40"
          >
            <div className="flex items-start gap-3">
              <UserCog className="mt-0.5 h-4 w-4 text-text-tertiary" aria-hidden />
              <div>
                <p className="text-small font-medium text-charcoal">Roles & permissions</p>
                <p className="text-caption text-text-secondary">
                  Pick from built-in templates (Owner, Admin, Accountant, Sales, Read-only) or create custom roles. Assign one or more roles per team member.
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-text-tertiary" aria-hidden />
          </Link>
          <Link
            href="/app/settings/document-templates"
            className="flex items-center justify-between rounded-md border-hairline border-border px-4 py-3 hover:bg-surface-recessed/40"
          >
            <div className="flex items-start gap-3">
              <FileText className="mt-0.5 h-4 w-4 text-text-tertiary" aria-hidden />
              <div>
                <p className="text-small font-medium text-charcoal">Document templates</p>
                <p className="text-caption text-text-secondary">
                  Customise the printed layout of invoices, quotations, purchase orders and other documents. Start from a library template or build your own; multi-language variants supported.
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-text-tertiary" aria-hidden />
          </Link>
          <Link
            href="/app/settings/password"
            className="flex items-center justify-between rounded-md border-hairline border-border px-4 py-3 hover:bg-surface-recessed/40"
          >
            <div className="flex items-start gap-3">
              <KeyRound className="mt-0.5 h-4 w-4 text-text-tertiary" aria-hidden />
              <div>
                <p className="text-small font-medium text-charcoal">Change password</p>
                <p className="text-caption text-text-secondary">
                  Update your sign-in password. Saving signs out every other session for your account — useful if you think someone else had access.
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-text-tertiary" aria-hidden />
          </Link>
          <Link
            href="/app/settings/security"
            className="flex items-center justify-between rounded-md border-hairline border-border px-4 py-3 hover:bg-surface-recessed/40"
          >
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 text-text-tertiary" aria-hidden />
              <div>
                <p className="text-small font-medium text-charcoal">Two-factor authentication</p>
                <p className="text-caption text-text-secondary">
                  Add a second step to sign-in using an authenticator app (Google Authenticator, 1Password, Authy, Bitwarden). Keep your backup codes somewhere safe — they're the only way back in if you lose your phone.
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-text-tertiary" aria-hidden />
          </Link>
          <Link
            href="/app/settings/fx-rates"
            className="flex items-center justify-between rounded-md border-hairline border-border px-4 py-3 hover:bg-surface-recessed/40"
          >
            <div className="flex items-start gap-3">
              <Coins className="mt-0.5 h-4 w-4 text-text-tertiary" aria-hidden />
              <div>
                <p className="text-small font-medium text-charcoal">FX rates</p>
                <p className="text-caption text-text-secondary">
                  Daily exchange rates for invoicing in foreign currencies. Used for display on USD/EUR/GBP documents; the ledger stays in LKR.
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-text-tertiary" aria-hidden />
          </Link>
        </div>
      </section>
    </main>
  );
}
