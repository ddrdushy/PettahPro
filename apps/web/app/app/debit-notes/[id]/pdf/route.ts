import { cookies } from "next/headers";
import { renderToBuffer } from "@react-pdf/renderer";
import { DebitNotePDF } from "@/lib/debit-note-pdf";
import { pdfResponse } from "@/lib/pdf-response";
import { fetchTenantLogoDataUrl } from "@/lib/tenant-logo";
import {
  buildDebitNoteContext,
  renderDebitNoteTemplate,
} from "@/lib/template-renderer";
import type {
  DebitNoteDetail,
  DebitNoteLine,
  DebitNoteLinkedBill,
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

  const [meRes, dnRes, tplRes, logoDataUrl] = await Promise.all([
    fetch(`${base}/auth/me`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
    fetch(`${base}/debit-notes/${params.id}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }),
    fetch(`${base}/document-templates/active?docType=debit_note&language=en`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }).catch(() => null),
    fetchTenantLogoDataUrl(cookieHeader),
  ]);
  if (meRes.status === 401) return new Response("Unauthorized", { status: 401 });
  if (dnRes.status === 404) return new Response("Debit note not found", { status: 404 });
  if (!meRes.ok || !dnRes.ok) return new Response("Couldn't load debit note", { status: 502 });

  const me = (await meRes.json()) as { user: unknown; tenant: Tenant };
  const data = (await dnRes.json()) as {
    debitNote: DebitNoteDetail;
    lines: DebitNoteLine[];
    supplier: Supplier | null;
    bill: DebitNoteLinkedBill | null;
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
      ? renderDebitNoteTemplate(
          activeTemplate.layoutJson,
          buildDebitNoteContext({
            tenant: { businessName: me.tenant.businessName },
            debitNote: data.debitNote,
            lines: data.lines,
            supplier: data.supplier,
            bill: data.bill,
            logoDataUrl,
          }),
        )
      : DebitNotePDF({
          tenant: { businessName: me.tenant.businessName },
          debitNote: data.debitNote,
          lines: data.lines,
          supplier: data.supplier,
          bill: data.bill,
          logoDataUrl,
        }),
  );

  const filename = `${data.debitNote.internalReference ?? "debit-note-" + data.debitNote.id.slice(0, 8)}.pdf`;

  return pdfResponse(pdf, filename);
}
