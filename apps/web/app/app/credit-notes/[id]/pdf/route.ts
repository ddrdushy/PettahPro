import { cookies } from "next/headers";
import { renderToBuffer } from "@react-pdf/renderer";
import { CreditNotePDF } from "@/lib/credit-note-pdf";
import { pdfResponse } from "@/lib/pdf-response";
import { fetchTenantLogoDataUrl } from "@/lib/tenant-logo";
import {
  buildCreditNoteContext,
  renderCreditNoteTemplate,
} from "@/lib/template-renderer";
import type {
  CreditNoteDetail,
  CreditNoteLine,
  CreditNoteLinkedInvoice,
  Customer,
  DocumentTemplate,
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

  const [meRes, cnRes, tplRes, logoDataUrl] = await Promise.all([
    fetch(`${base}/auth/me`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
    fetch(`${base}/credit-notes/${params.id}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }),
    fetch(`${base}/document-templates/active?docType=credit_note&language=en`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }).catch(() => null),
    fetchTenantLogoDataUrl(cookieHeader),
  ]);
  if (meRes.status === 401) return new Response("Unauthorized", { status: 401 });
  if (cnRes.status === 404) return new Response("Credit note not found", { status: 404 });
  if (!meRes.ok || !cnRes.ok) return new Response("Couldn't load credit note", { status: 502 });

  const me = (await meRes.json()) as { user: unknown; tenant: Tenant };
  const data = (await cnRes.json()) as {
    creditNote: CreditNoteDetail;
    lines: CreditNoteLine[];
    customer: Customer | null;
    invoice: CreditNoteLinkedInvoice | null;
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
      ? renderCreditNoteTemplate(
          activeTemplate.layoutJson,
          buildCreditNoteContext({
            tenant: { businessName: me.tenant.businessName },
            creditNote: data.creditNote,
            lines: data.lines,
            customer: data.customer,
            invoice: data.invoice,
            logoDataUrl,
          }),
        )
      : CreditNotePDF({
          tenant: { businessName: me.tenant.businessName },
          creditNote: data.creditNote,
          lines: data.lines,
          customer: data.customer,
          invoice: data.invoice,
          logoDataUrl,
        }),
  );

  const filename = `${data.creditNote.creditNoteNumber ?? "credit-note-" + data.creditNote.id.slice(0, 8)}.pdf`;

  return pdfResponse(pdf, filename);
}
