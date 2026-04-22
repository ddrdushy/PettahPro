import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import type { FxRate } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { FxRatesClient } from "./fx-rates-client";

export const metadata: Metadata = { title: "FX rates" };

async function fetchRates(): Promise<FxRate[] | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/fx-rates`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return null;
  return ((await res.json()) as { rates: FxRate[] }).rates;
}

export default async function FxRatesPage() {
  const rates = await fetchRates();

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
        title="FX rates"
        description="Capture the daily exchange rates you use when invoicing in USD / EUR / GBP or paying foreign suppliers. Rates are for display on documents — the ledger continues to post in LKR. You'll usually enter today's rate from cbsl.gov.lk or your bank's advice."
      />

      {!rates ? (
        <p className="mt-6 text-body text-text-secondary">Couldn't load FX rates.</p>
      ) : (
        <FxRatesClient initial={rates} />
      )}
    </main>
  );
}
