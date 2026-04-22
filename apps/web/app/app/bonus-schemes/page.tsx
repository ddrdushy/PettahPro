import type { Metadata } from "next";
import { cookies } from "next/headers";
import { BonusSchemesClient } from "./bonus-schemes-client";
import type { BonusScheme } from "@/lib/api";

export const metadata: Metadata = { title: "Bonus schemes" };

async function fetchSchemes(): Promise<BonusScheme[]> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/bonus-schemes`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { schemes: BonusScheme[] };
  return data.schemes;
}

export default async function BonusSchemesPage() {
  const schemes = await fetchSchemes();
  return <BonusSchemesClient initial={schemes} />;
}
