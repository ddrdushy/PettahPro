import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { FxRevaluation } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { FxRevaluationListClient } from "./list-client";

export const metadata: Metadata = { title: "FX revaluation" };

async function fetchRevaluations(): Promise<FxRevaluation[] | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/fx-revaluations`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return null;
  return ((await res.json()) as { revaluations: FxRevaluation[] }).revaluations;
}

export default async function FxRevaluationPage() {
  const revaluations = await fetchRevaluations();

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Accounting"
        title="FX revaluation"
        description="Re-measure open foreign-currency AR and AP at the closing rate and book the LKR delta to Unrealized FX gain (4510) / loss (5510). Each run supersedes the prior one automatically — no reversing entry needed. Run this at period close, before you lock the month."
      />
      {!revaluations ? (
        <p className="mt-6 text-body text-text-secondary">Couldn't load runs.</p>
      ) : (
        <FxRevaluationListClient initial={revaluations} />
      )}
    </main>
  );
}
