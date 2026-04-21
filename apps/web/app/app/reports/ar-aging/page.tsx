import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { AgingDetailReport } from "@/lib/api";
import { AgingDetailView } from "@/components/reports/aging-detail";
import { PageHeader } from "@/components/app/page-header";

export const metadata: Metadata = { title: "Receivables aging" };

async function fetchReport(): Promise<AgingDetailReport | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/reports/ar-aging`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return null;
  return (await res.json()) as AgingDetailReport;
}

export default async function ArAgingPage() {
  const data = await fetchReport();
  if (!data) {
    return (
      <main className="container-p py-10">
        <PageHeader eyebrow="Reports" title="Receivables aging" description="Couldn't load the aging report." />
      </main>
    );
  }
  return <AgingDetailView mode="ar" data={data} />;
}
