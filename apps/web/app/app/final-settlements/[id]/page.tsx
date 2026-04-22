import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { FinalSettlementRow } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatDate } from "@/lib/format";
import { SettlementDetailClient } from "./detail-client";

export const metadata: Metadata = { title: "Final settlement" };

async function fetchSettlement(id: string): Promise<FinalSettlementRow | null> {
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const cookieHeader = cookies().toString();
  const res = await fetch(`${base}/final-settlements/${id}`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const data = (await res.json()) as { settlement: FinalSettlementRow };
  return data.settlement;
}

export default async function FinalSettlementDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const settlement = await fetchSettlement(params.id);
  if (!settlement) notFound();

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/final-settlements" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to final settlements
        </Link>
      </div>

      <PageHeader
        eyebrow={settlement.settlementNumber ?? "Draft"}
        title={`${settlement.employeeFullName} · final settlement`}
        description={`${settlement.designation ?? ""}${
          settlement.department ? ` · ${settlement.department}` : ""
        } · hired ${formatDate(settlement.hireDate)} · exited ${formatDate(settlement.exitDate)}`}
      />

      <SettlementDetailClient settlement={settlement} />
    </main>
  );
}
