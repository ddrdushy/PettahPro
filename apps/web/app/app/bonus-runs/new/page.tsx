import type { Metadata } from "next";
import { cookies } from "next/headers";
import { NewBonusRunClient } from "./new-bonus-run-client";
import type { BonusScheme } from "@/lib/api";

export const metadata: Metadata = { title: "New bonus run" };

async function fetchSchemes(): Promise<BonusScheme[]> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/bonus-schemes`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { schemes: BonusScheme[] };
  return data.schemes;
}

export default async function NewBonusRunPage() {
  const schemes = await fetchSchemes();
  return <NewBonusRunClient schemes={schemes} />;
}
