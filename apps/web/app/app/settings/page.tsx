import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Hash, ArrowRight, Bell, CheckCircle2, UserCog, Coins, FileText, KeyRound, ShieldCheck, Sparkles } from "lucide-react";
import type { TenantSettingsResponse, TenantSubscriptionResponse } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";
import { SettingsFormClient } from "./settings-form-client";

export const metadata: Metadata = { title: "Settings" };

const INTERNAL_API = process.env.INTERNAL_API_URL ?? "http://api:4000";

async function fetchSettings(): Promise<TenantSettingsResponse | null> {
  const res = await fetch(`${INTERNAL_API}/settings`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as TenantSettingsResponse;
}

async function fetchSubscription(): Promise<TenantSubscriptionResponse | null> {
  const res = await fetch(`${INTERNAL_API}/subscription`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { subscription: TenantSubscriptionResponse };
  return body.subscription;
}

const STATUS_COPY: Record<TenantSubscriptionResponse["status"], { label: string; tone: string }> = {
  trial: { label: "Trial", tone: "bg-amber-100 text-amber-900" },
  active: { label: "Active", tone: "bg-emerald-100 text-emerald-900" },
  past_due: { label: "Past due", tone: "bg-rose-100 text-rose-900" },
  cancelled: { label: "Cancelled", tone: "bg-neutral-200 text-neutral-700" },
};

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export default async function SettingsPage() {
  const [data, subscription] = await Promise.all([fetchSettings(), fetchSubscription()]);

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

      {subscription ? (
        (() => {
          const { plan, status, billingCycle, trialEndsAt, currentPeriodEnd } = subscription;
          const statusCopy = STATUS_COPY[status];
          const priceCents =
            billingCycle === "yearly" ? plan.yearlyPriceCents : plan.monthlyPriceCents;
          const priceLabel = billingCycle === "yearly" ? "per year" : "per month";
          const trialDaysLeft = status === "trial" ? daysUntil(trialEndsAt) : null;
          return (
            <section className="mb-6 rounded-card border-hairline border-border bg-surface-elevated p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-text-tertiary" aria-hidden />
                    <h2 className="text-body font-medium text-charcoal">Your plan</h2>
                    <span className={`rounded-full px-2 py-0.5 text-caption font-medium ${statusCopy.tone}`}>
                      {statusCopy.label}
                    </span>
                  </div>
                  <p className="mt-2 text-h3 font-semibold text-charcoal">{plan.name}</p>
                  <p className="text-caption text-text-secondary">{plan.tagline}</p>
                  <p className="mt-3 text-small text-text-secondary">
                    {formatLKR(priceCents)} {priceLabel} · billed {billingCycle}
                  </p>
                  {status === "trial" && trialDaysLeft !== null ? (
                    <p className="mt-1 text-caption text-amber-900">
                      Trial ends {formatDate(trialEndsAt!)} ({trialDaysLeft} {trialDaysLeft === 1 ? "day" : "days"} left).
                    </p>
                  ) : status === "past_due" ? (
                    <p className="mt-1 text-caption text-rose-900">
                      Your trial ended on {formatDate(currentPeriodEnd)}. Contact support to pick a plan and keep access.
                    </p>
                  ) : status === "cancelled" ? (
                    <p className="mt-1 text-caption text-text-tertiary">
                      Cancelled. Contact support to reactivate.
                    </p>
                  ) : (
                    <p className="mt-1 text-caption text-text-tertiary">
                      Next renewal {formatDate(currentPeriodEnd)}.
                    </p>
                  )}
                </div>
                <Link
                  href="/pricing"
                  className="inline-flex items-center gap-1 rounded-md border-hairline border-border px-3 py-1.5 text-small font-medium text-charcoal hover:bg-surface-recessed/40"
                >
                  View plans
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>
              {plan.features.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {plan.features.map((f) => (
                    <span
                      key={f}
                      className="rounded-full bg-surface-recessed/60 px-2 py-0.5 text-caption text-text-secondary"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })()
      ) : null}

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
