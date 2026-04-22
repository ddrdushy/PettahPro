import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Hash, ArrowRight } from "lucide-react";
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
        </div>
      </section>
    </main>
  );
}
