import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { DeliveryNoteListRow } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { BatchInvoiceClient } from "./batch-invoice-client";

export const metadata: Metadata = { title: "Consolidated invoice" };

async function fetchDNs(): Promise<DeliveryNoteListRow[]> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/delivery-notes`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return [];
  return ((await res.json()) as { deliveryNotes: DeliveryNoteListRow[] }).deliveryNotes;
}

export default async function BatchInvoicePage() {
  const dns = await fetchDNs();
  // Only DNs that are delivered and not already invoiced can be rolled
  // into a consolidated invoice.
  const available = dns.filter(
    (d) => d.status === "delivered" && !d.invoiceId,
  );

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/invoices" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to invoices
        </Link>
      </div>
      <PageHeader
        eyebrow="Sell"
        title="Consolidated invoice"
        description="Pick multiple delivered delivery notes for the same customer and roll them into one draft invoice. Useful for end-of-month billing when you've shipped throughout the month."
      />
      <BatchInvoiceClient deliveryNotes={available} />
    </main>
  );
}
