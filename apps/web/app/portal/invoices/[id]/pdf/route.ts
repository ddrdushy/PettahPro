import { cookies } from "next/headers";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePDF } from "@/lib/invoice-pdf";
import { pdfResponse } from "@/lib/pdf-response";
import type { Customer, InvoiceDetail, InvoiceLine, PortalMeResult } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Portal-scoped PDF download. Reuses the same InvoicePDF renderer as
 * the admin route but goes through /portal/* endpoints that enforce
 * the portal session's (tenant, customer) scope — a customer can never
 * render someone else's invoice.
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return new Response("Unauthorized", { status: 401 });

  const [meRes, invRes] = await Promise.all([
    fetch(`${base}/portal/auth/me`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
    fetch(`${base}/portal/invoices/${params.id}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }),
  ]);
  if (meRes.status === 401) return new Response("Unauthorized", { status: 401 });
  if (invRes.status === 404) return new Response("Invoice not found", { status: 404 });
  if (!meRes.ok || !invRes.ok) {
    return new Response("Couldn't load invoice", { status: 502 });
  }

  const me = (await meRes.json()) as PortalMeResult;
  const invData = (await invRes.json()) as {
    invoice: InvoiceDetail;
    lines: InvoiceLine[];
    customer: Customer | null;
  };

  const pdf = await renderToBuffer(
    InvoicePDF({
      tenant: { businessName: me.tenant.businessName },
      invoice: invData.invoice,
      lines: invData.lines,
      customer: invData.customer,
    }),
  );

  const filename = `${invData.invoice.invoiceNumber ?? "invoice-" + invData.invoice.id.slice(0, 8)}.pdf`;
  return pdfResponse(pdf, filename);
}
