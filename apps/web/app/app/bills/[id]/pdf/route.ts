import { cookies } from "next/headers";
import { renderToBuffer } from "@react-pdf/renderer";
import { BillPDF } from "@/lib/bill-pdf";
import { pdfResponse } from "@/lib/pdf-response";
import { fetchTenantLogoDataUrl } from "@/lib/tenant-logo";
import {
  buildBillContext,
  renderBillTemplate,
} from "@/lib/template-renderer";
import type {
  BillCharge,
  BillDetail,
  BillLine,
  DocumentTemplate,
  Supplier,
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
  if (!cookieHeader) return new Response("Unauthorized", { status: 401 });

  // Active-template lookup is fire-and-forget. If the tenant has a
  // published+default bill template we render through the template
  // engine; if not (or the call errors), we fall back to the
  // hard-coded BillPDF — same behaviour as the invoice route from #33.
  const [meRes, billRes, tplRes, logoDataUrl] = await Promise.all([
    fetch(`${base}/auth/me`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
    fetch(`${base}/bills/${params.id}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }),
    fetch(`${base}/document-templates/active?docType=bill&language=en`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }).catch(() => null),
    fetchTenantLogoDataUrl(cookieHeader),
  ]);
  if (meRes.status === 401) return new Response("Unauthorized", { status: 401 });
  if (billRes.status === 404) return new Response("Bill not found", { status: 404 });
  if (!meRes.ok || !billRes.ok) return new Response("Couldn't load bill", { status: 502 });

  const me = (await meRes.json()) as { user: unknown; tenant: Tenant };
  const data = (await billRes.json()) as {
    bill: BillDetail;
    lines: BillLine[];
    charges: BillCharge[];
    supplier: Supplier | null;
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
      ? renderBillTemplate(
          activeTemplate.layoutJson,
          buildBillContext({
            tenant: { businessName: me.tenant.businessName },
            bill: data.bill,
            lines: data.lines,
            charges: data.charges,
            supplier: data.supplier,
            logoDataUrl,
          }),
        )
      : BillPDF({
          tenant: { businessName: me.tenant.businessName },
          bill: data.bill,
          lines: data.lines,
          charges: data.charges,
          supplier: data.supplier,
          logoDataUrl,
        }),
  );

  const filename = `${data.bill.internalReference ?? "bill-" + data.bill.id.slice(0, 8)}.pdf`;

  return pdfResponse(pdf, filename);
}
