import { cookies } from "next/headers";
import { renderToBuffer } from "@react-pdf/renderer";
import { CreditNotePDF } from "@/lib/credit-note-pdf";
import type {
  CreditNoteDetail,
  CreditNoteLine,
  CreditNoteLinkedInvoice,
  Customer,
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

  const [meRes, cnRes] = await Promise.all([
    fetch(`${base}/auth/me`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
    fetch(`${base}/credit-notes/${params.id}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }),
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

  const pdf = await renderToBuffer(
    CreditNotePDF({
      tenant: { businessName: me.tenant.businessName },
      creditNote: data.creditNote,
      lines: data.lines,
      customer: data.customer,
      invoice: data.invoice,
    }),
  );

  const filename = `${data.creditNote.creditNoteNumber ?? "credit-note-" + data.creditNote.id.slice(0, 8)}.pdf`;

  return new Response(pdf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
