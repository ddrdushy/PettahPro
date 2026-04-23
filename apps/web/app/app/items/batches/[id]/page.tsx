import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { BatchRecallAllocation, ItemBatch } from "@/lib/api";
import { BatchRecallClient } from "./batch-recall-client";

export const metadata: Metadata = { title: "Batch recall" };

async function fetchBatch(
  id: string,
): Promise<{ batch: ItemBatch; allocations: BatchRecallAllocation[] } | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/items/batches/${id}/recall`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return (await res.json()) as {
    batch: ItemBatch;
    allocations: BatchRecallAllocation[];
  };
}

export default async function BatchRecallPage({
  params,
}: {
  params: { id: string };
}) {
  const data = await fetchBatch(params.id);
  if (!data) notFound();
  return <BatchRecallClient batch={data.batch} allocations={data.allocations} />;
}
