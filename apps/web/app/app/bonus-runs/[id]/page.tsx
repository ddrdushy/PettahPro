import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { BonusRunDetailClient } from "./bonus-run-detail-client";
import type { BonusRunLine, BonusRunRow } from "@/lib/api";

export const metadata: Metadata = { title: "Bonus run" };

async function fetchRun(
  id: string,
): Promise<{ run: BonusRunRow; lines: BonusRunLine[] } | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/bonus-runs/${id}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return null;
  return (await res.json()) as { run: BonusRunRow; lines: BonusRunLine[] };
}

export default async function BonusRunDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const data = await fetchRun(params.id);
  if (!data) return notFound();
  return <BonusRunDetailClient run={data.run} lines={data.lines} />;
}
