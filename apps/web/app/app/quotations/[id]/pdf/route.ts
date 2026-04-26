import { cookies } from "next/headers";
import { renderToBuffer } from "@react-pdf/renderer";
import { QuotationPDF } from "@/lib/quotation-pdf";
import { pdfResponse } from "@/lib/pdf-response";
import { fetchTenantLogoDataUrl } from "@/lib/tenant-logo";
import {
  buildQuotationContext,
  renderQuotationTemplate,
} from "@/lib/template-renderer";
import type {
  Customer,
  DocumentTemplate,
  QuotationDetail,
  QuotationLine,
  Tenant,
} from "@/lib/api";

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

  // Active-template lookup races the quotation fetch. If the tenant
  // has a published+default quotation template we render through the
  // engine; otherwise we fall back to the hard-coded QuotationPDF.
  const [meRes, qRes, tplRes, logoDataUrl] = await Promise.all([
    fetch(`${base}/auth/me`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
    fetch(`${base}/quotations/${params.id}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }),
    fetch(`${base}/document-templates/active?docType=quotation&language=en`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }).catch(() => null),
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

  let activeTemplate: DocumentTemplate | null = null;
  if (tplRes && tplRes.ok) {
    try {
      const body = (await tplRes.json()) as {
        template: DocumentTemplate | null;
      };
      activeTemplate = body.template;
    } catch {
      activeTemplate = null;
    }
  }

  const pdf = await renderToBuffer(
    activeTemplate
      ? renderQuotationTemplate(
          activeTemplate.layoutJson,
          buildQuotationContext({
            tenant: { businessName: me.tenant.businessName },
            quotation: data.quotation,
            lines: data.lines,
            customer: data.customer,
            logoDataUrl,
          }),
        )
      : QuotationPDF({
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
