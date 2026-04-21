import type { Metadata } from "next";
import { cookies } from "next/headers";
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
    </main>
  );
}
