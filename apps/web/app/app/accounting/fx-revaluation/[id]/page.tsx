import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { FxRevaluation, FxRevaluationLine } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { FxRevaluationDetailClient } from "./detail-client";

export const metadata: Metadata = { title: "FX revaluation" };

async function fetchDetail(id: string): Promise<{
  revaluation: FxRevaluation;
  lines: FxRevaluationLine[];
} | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/fx-revaluations/${id}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return (await res.json()) as { revaluation: FxRevaluation; lines: FxRevaluationLine[] };
}

export default async function FxRevaluationDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const data = await fetchDetail(params.id);
  if (!data) notFound();

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/accounting/fx-revaluation" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to revaluation runs
        </Link>
      </div>

      <PageHeader
        eyebrow={`As of ${data.revaluation.asOfDate}`}
        title={`FX revaluation · ${data.revaluation.asOfDate}`}
        description={
          data.revaluation.status === "draft"
            ? "Draft run. Review the per-document deltas below, then post to book the Unrealized FX journal. You can delete a draft to rerun with fresh rates."
            : data.revaluation.status === "posted"
              ? "Posted to the general ledger. The next revaluation run will naturally supersede this one — no reversing entry needed. Void it here if you need to back it out explicitly."
              : "This run has been voided. Its reversing JE is posted and its cumulative deltas no longer count as a baseline for future runs."
        }
      />

      <FxRevaluationDetailClient
        revaluation={data.revaluation}
        lines={data.lines}
      />
    </main>
  );
}
