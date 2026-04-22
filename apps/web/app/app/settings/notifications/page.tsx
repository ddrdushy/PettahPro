import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import type { NotificationPreference } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { NotificationPrefsClient } from "./notification-prefs-client";

export const metadata: Metadata = { title: "Notification preferences" };

async function fetchPrefs(): Promise<NotificationPreference[]> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/notifications/preferences`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return [];
  return ((await res.json()) as { preferences: NotificationPreference[] }).preferences;
}

export default async function NotificationPrefsPage() {
  const preferences = await fetchPrefs();

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/settings" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to settings
        </Link>
      </div>
      <PageHeader
        eyebrow="Admin"
        title="Notification preferences"
        description="Turn off the in-app notifications you don't want to see. Changes apply immediately — already-delivered items stay put in your bell."
      />
      <NotificationPrefsClient initial={preferences} />
    </main>
  );
}
