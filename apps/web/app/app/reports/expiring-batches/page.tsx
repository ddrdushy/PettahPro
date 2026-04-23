import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ExpiringBatchRow } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { ExpiringBatchesClient } from "./expiring-batches-client";

export const metadata: Metadata = { title: "Expiring batches" };

async function fetchReport(
  days: number,
): Promise<{ batches: ExpiringBatchRow[]; days: number; cutoff: string } | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/items/tracking/expiring?days=${days}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return null;
  return (await res.json()) as { batches: ExpiringBatchRow[]; days: number; cutoff: string };
}

const ALLOWED_WINDOWS = [7, 30, 90, 180];

export default async function ExpiringBatchesPage({
  searchParams,
}: {
  searchParams: { days?: string };
}) {
  const parsed = Number(searchParams.days);
  const days = ALLOWED_WINDOWS.includes(parsed) ? parsed : 30;
  const data = await fetchReport(days);

  if (!data) {
    return (
      <main className="container-p py-10">
        <PageHeader
          eyebrow="Reports"
          title="Expiring batches"
          description="Couldn't load the expiring-batches report."
        />
      </main>
    );
  }

  return <ExpiringBatchesClient days={days} cutoff={data.cutoff} batches={data.batches} windows={ALLOWED_WINDOWS} />;
}
