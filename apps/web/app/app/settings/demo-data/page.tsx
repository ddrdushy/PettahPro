import type { Metadata } from "next";
import { cookies } from "next/headers";
import { PageHeader } from "@/components/app/page-header";
import { DemoDataClient } from "./demo-data-client";

export const metadata: Metadata = { title: "Demo data" };

const INTERNAL_API = process.env.INTERNAL_API_URL ?? "http://api:4000";

async function fetchSeededCount(): Promise<number> {
  // The endpoint is permission-gated; on FORBIDDEN we render the page
  // anyway with a visible "needs settings.manage" hint instead of 404.
  try {
    const res = await fetch(`${INTERNAL_API}/demo-data`, {
      headers: { cookie: cookies().toString() },
      cache: "no-store",
    });
    if (!res.ok) return 0;
    const body = (await res.json()) as { seededRecordCount: number };
    return body.seededRecordCount;
  } catch {
    return 0;
  }
}

export default async function DemoDataPage() {
  const seededCount = await fetchSeededCount();

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Admin"
        title="Demo data"
        description="Load a small set of realistic sample customers, suppliers, items, invoices and bills to explore PettahPro before you start entering real data. You can clear it with one click — your real records are never touched."
      />
      <section className="mt-6 max-w-2xl rounded-card border-hairline border-border bg-surface-elevated p-6">
        <DemoDataClient initialSeededCount={seededCount} />
      </section>
    </main>
  );
}
