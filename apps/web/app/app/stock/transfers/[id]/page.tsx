import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type {
  StockTransferDetail,
  StockTransferLineRow,
  StockTransferWarehouse,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { TransferActionsClient } from "./actions-client";

export const metadata: Metadata = { title: "Stock transfer" };

async function fetchTransfer(id: string): Promise<{
  transfer: StockTransferDetail;
  lines: StockTransferLineRow[];
  source: StockTransferWarehouse | null;
  destination: StockTransferWarehouse | null;
} | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/stock-transfers/${id}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return (await res.json()) as {
    transfer: StockTransferDetail;
    lines: StockTransferLineRow[];
    source: StockTransferWarehouse | null;
    destination: StockTransferWarehouse | null;
  };
}

export default async function StockTransferDetailPage({ params }: { params: { id: string } }) {
  const data = await fetchTransfer(params.id);
  if (!data) notFound();
  const { transfer, lines, source, destination } = data;

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/stock/transfers" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to transfers
        </Link>
      </div>

      <PageHeader
        eyebrow="Stock"
        title={transfer.transferNumber ?? "Draft stock transfer"}
        description={transfer.notes ?? undefined}
      />

      <TransferActionsClient
        transfer={transfer}
        lines={lines}
        source={source}
        destination={destination}
      />
    </main>
  );
}
