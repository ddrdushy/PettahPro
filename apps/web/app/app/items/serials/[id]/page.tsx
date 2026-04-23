import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { ItemSerial } from "@/lib/api";
import { SerialTraceClient } from "./serial-trace-client";

export const metadata: Metadata = { title: "Serial trace" };

type SerialTraceResponse = {
  serial: ItemSerial;
  item: { id: string; name: string; sku: string | null } | null;
  batch: { id: string; batchNumber: string; expiryDate: string | null } | null;
};

async function fetchSerial(id: string): Promise<SerialTraceResponse | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/items/serials/${id}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return (await res.json()) as SerialTraceResponse;
}

export default async function SerialTracePage({
  params,
}: {
  params: { id: string };
}) {
  const data = await fetchSerial(params.id);
  if (!data) notFound();
  return <SerialTraceClient serial={data.serial} item={data.item} batch={data.batch} />;
}
