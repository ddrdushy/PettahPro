import { cookies } from "next/headers";
import { renderToBuffer } from "@react-pdf/renderer";
import { ProformaInvoicePDF } from "@/lib/proforma-pdf";
import { pdfResponse } from "@/lib/pdf-response";
import { fetchTenantLogoDataUrl } from "@/lib/tenant-logo";
import {
  buildProformaInvoiceContext,
  renderProformaInvoiceTemplate,
} from "@/lib/template-renderer";
import type {
  Customer,
  DocumentTemplate,
  ProformaInvoiceDetail,
  ProformaInvoiceLine,
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

  const [meRes, pRes, tplRes, logoDataUrl] = await Promise.all([
    fetch(`${base}/auth/me`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
    fetch(`${base}/proforma-invoices/${params.id}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }),
    fetch(`${base}/document-templates/active?docType=proforma_invoice&language=en`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }).catch(() => null),
    fetchTenantLogoDataUrl(cookieHeader),
  ]);
  if (meRes.status === 401) return new Response("Unauthorized", { status: 401 });
  if (pRes.status === 404) return new Response("Proforma not found", { status: 404 });
  if (!meRes.ok || !pRes.ok) {
    return new Response("Couldn't load proforma", { status: 502 });
  }

  const me = (await meRes.json()) as { user: unknown; tenant: Tenant };
  const data = (await pRes.json()) as {
    proformaInvoice: ProformaInvoiceDetail;
    lines: ProformaInvoiceLine[];
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
      ? renderProformaInvoiceTemplate(
          activeTemplate.layoutJson,
          buildProformaInvoiceContext({
            tenant: { businessName: me.tenant.businessName },
            proformaInvoice: data.proformaInvoice,
            lines: data.lines,
            customer: data.customer,
            logoDataUrl,
          }),
        )
      : ProformaInvoicePDF({
          tenant: { businessName: me.tenant.businessName },
          proformaInvoice: data.proformaInvoice,
          lines: data.lines,
          customer: data.customer,
          logoDataUrl,
        }),
  );

  const filename = `${data.proformaInvoice.proformaNumber ?? "proforma-" + data.proformaInvoice.id.slice(0, 8)}.pdf`;

  return pdfResponse(pdf, filename);
}
