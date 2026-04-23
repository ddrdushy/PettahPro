import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { FixedAssetScheduleRow } from "@/lib/api";
import { ScheduleClient } from "./schedule-client";

export const metadata: Metadata = { title: "Depreciation schedule" };

async function fetchSchedule(year: number): Promise<{
  year: number;
  rows: FixedAssetScheduleRow[];
  totals: {
    costCents: number;
    bookYearCents: number;
    bookAccumulatedCents: number;
    bookNbvCents: number;
    taxYearCents: number;
    taxAccumulatedCents: number;
    taxNbvCents: number;
  };
} | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/fixed-assets/schedule?year=${year}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return null;
  return res.json();
}

export default async function DepreciationSchedulePage({
  searchParams,
}: {
  searchParams: { year?: string };
}) {
  const year = Number(searchParams.year) || new Date().getFullYear();
  const data = await fetchSchedule(year);
  return (
    <ScheduleClient
      year={year}
      rows={data?.rows ?? []}
      totals={
        data?.totals ?? {
          costCents: 0,
          bookYearCents: 0,
          bookAccumulatedCents: 0,
          bookNbvCents: 0,
          taxYearCents: 0,
          taxAccumulatedCents: 0,
          taxNbvCents: 0,
        }
      }
    />
  );
}
