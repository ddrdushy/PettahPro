import { cookies } from "next/headers";
import { renderToBuffer } from "@react-pdf/renderer";
import { DeliveryNotePDF } from "@/lib/delivery-note-pdf";
import { pdfResponse } from "@/lib/pdf-response";
import { fetchTenantLogoDataUrl } from "@/lib/tenant-logo";
import type { Customer, DeliveryNoteDetail, DeliveryNoteLine, Tenant } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return new Response("Unauthorized", { status: 401 });

  const [meRes, dnRes, logoDataUrl] = await Promise.all([
    fetch(`${base}/auth/me`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
    fetch(`${base}/delivery-notes/${params.id}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }),
    fetchTenantLogoDataUrl(cookieHeader),
  ]);
  if (meRes.status === 401) return new Response("Unauthorized", { status: 401 });
  if (dnRes.status === 404) return new Response("Delivery note not found", { status: 404 });
  if (!meRes.ok || !dnRes.ok) return new Response("Couldn't load delivery note", { status: 502 });

  const me = (await meRes.json()) as { user: unknown; tenant: Tenant };
  const data = (await dnRes.json()) as {
    deliveryNote: DeliveryNoteDetail;
    lines: DeliveryNoteLine[];
    customer: Customer | null;
  };

  const pdf = await renderToBuffer(
    DeliveryNotePDF({
      tenant: { businessName: me.tenant.businessName },
      deliveryNote: data.deliveryNote,
      lines: data.lines,
      customer: data.customer,
      logoDataUrl,
    }),
  );

  const filename = `${data.deliveryNote.dnNumber ?? "delivery-note-" + data.deliveryNote.id.slice(0, 8)}.pdf`;

  return pdfResponse(pdf, filename);
}
