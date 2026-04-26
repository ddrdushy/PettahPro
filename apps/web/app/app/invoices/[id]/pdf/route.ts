import { cookies } from "next/headers";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePDF } from "@/lib/invoice-pdf";
import {
  buildInvoiceContext,
  renderInvoiceTemplate,
} from "@/lib/template-renderer";
import { pdfResponse } from "@/lib/pdf-response";
import { fetchTenantLogoDataUrl } from "@/lib/tenant-logo";
import type {
  Customer,
  DocumentTemplate,
  InvoiceDetail,
  InvoiceLine,
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

  // Active template lookup is fire-and-forget against the tenant's
  // published+default invoice template. If none exists, or if the
  // call fails (e.g. missing settings.manage permission — portal
  // users hit this route too), we silently fall back to the
  // hard-coded InvoicePDF component. This keeps behaviour identical
  // to pre-#33 for tenants that never touch the template builder.
  const [meRes, invRes, tplRes, logoDataUrl] = await Promise.all([
    fetch(`${base}/auth/me`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }),
    fetch(`${base}/invoices/${params.id}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }),
    fetch(`${base}/document-templates/active?docType=invoice&language=en`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }).catch(() => null),
    fetchTenantLogoDataUrl(cookieHeader),
  ]);
  if (meRes.status === 401) return new Response("Unauthorized", { status: 401 });
  if (invRes.status === 404)
    return new Response("Invoice not found", { status: 404 });
  if (!meRes.ok || !invRes.ok) {
    return new Response("Couldn't load invoice", { status: 502 });
  }

  const me = (await meRes.json()) as { user: unknown; tenant: Tenant };
  const invData = (await invRes.json()) as {
    invoice: InvoiceDetail;
    lines: InvoiceLine[];
    customer: Customer | null;
  };

  // Template is optional — only pull the layout if the lookup both
  // succeeded and returned a live template. Anything else (403 from
  // permission check, 404, malformed JSON) falls through to the
  // legacy component without surfacing an error.
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
      ? renderInvoiceTemplate(
          activeTemplate.layoutJson,
          buildInvoiceContext({
            tenant: { businessName: me.tenant.businessName },
            invoice: invData.invoice,
            lines: invData.lines,
            customer: invData.customer,
            logoDataUrl,
          }),
        )
      : InvoicePDF({
          tenant: { businessName: me.tenant.businessName },
          invoice: invData.invoice,
          lines: invData.lines,
          customer: invData.customer,
          logoDataUrl,
        }),
  );

  const filename = `${invData.invoice.invoiceNumber ?? "invoice-" + invData.invoice.id.slice(0, 8)}.pdf`;

  return pdfResponse(pdf, filename);
}
