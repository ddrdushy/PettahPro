import { cookies } from "next/headers";
import { renderToBuffer } from "@react-pdf/renderer";
import { QuotationPDF } from "@/lib/quotation-pdf";
import { pdfResponse } from "@/lib/pdf-response";
import { fetchTenantLogoDataUrl } from "@/lib/tenant-logo";
import type { Customer, QuotationDetail, QuotationLine, Tenant } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const cookieHeader = cookies().toString();
  if (!cookieHeader) {
    return new Response("Unauthorized", { status: 401 });
  }

  const [meRes, qRes, logoDataUrl] = await Promise.all([
    fetch(`${base}/auth/me`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
    fetch(`${base}/quotations/${params.id}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }),
    fetchTenantLogoDataUrl(cookieHeader),
  ]);
  if (meRes.status === 401) return new Response("Unauthorized", { status: 401 });
  if (qRes.status === 404) return new Response("Quotation not found", { status: 404 });
  if (!meRes.ok || !qRes.ok) {
    return new Response("Couldn't load quotation", { status: 502 });
  }

  const me = (await meRes.json()) as { user: unknown; tenant: Tenant };
  const data = (await qRes.json()) as {
    quotation: QuotationDetail;
    lines: QuotationLine[];
    customer: Customer | null;
  };

  const pdf = await renderToBuffer(
    QuotationPDF({
      tenant: { businessName: me.tenant.businessName },
      quotation: data.quotation,
      lines: data.lines,
      customer: data.customer,
      logoDataUrl,
    }),
  );

  const filename = `${data.quotation.quotationNumber ?? "quotation-" + data.quotation.id.slice(0, 8)}.pdf`;

  return pdfResponse(pdf, filename);
}
