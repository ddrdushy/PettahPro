import { cookies } from "next/headers";
import { renderToBuffer } from "@react-pdf/renderer";
import { DebitNotePDF } from "@/lib/debit-note-pdf";
import { pdfResponse } from "@/lib/pdf-response";
import type {
  DebitNoteDetail,
  DebitNoteLine,
  DebitNoteLinkedBill,
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

  const [meRes, dnRes] = await Promise.all([
    fetch(`${base}/auth/me`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
    fetch(`${base}/debit-notes/${params.id}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }),
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

  const pdf = await renderToBuffer(
    DebitNotePDF({
      tenant: { businessName: me.tenant.businessName },
      debitNote: data.debitNote,
      lines: data.lines,
      supplier: data.supplier,
      bill: data.bill,
    }),
  );

  const filename = `${data.debitNote.internalReference ?? "debit-note-" + data.debitNote.id.slice(0, 8)}.pdf`;

  return pdfResponse(pdf, filename);
}
