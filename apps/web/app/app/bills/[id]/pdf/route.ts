import { cookies } from "next/headers";
import { renderToBuffer } from "@react-pdf/renderer";
import { BillPDF } from "@/lib/bill-pdf";
import { pdfResponse } from "@/lib/pdf-response";
import type { BillDetail, BillLine, Supplier, Tenant } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return new Response("Unauthorized", { status: 401 });

  const [meRes, billRes] = await Promise.all([
    fetch(`${base}/auth/me`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
    fetch(`${base}/bills/${params.id}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }),
  ]);
  if (meRes.status === 401) return new Response("Unauthorized", { status: 401 });
  if (billRes.status === 404) return new Response("Bill not found", { status: 404 });
  if (!meRes.ok || !billRes.ok) return new Response("Couldn't load bill", { status: 502 });

  const me = (await meRes.json()) as { user: unknown; tenant: Tenant };
  const data = (await billRes.json()) as {
    bill: BillDetail;
    lines: BillLine[];
    supplier: Supplier | null;
  };

  const pdf = await renderToBuffer(
    BillPDF({
      tenant: { businessName: me.tenant.businessName },
      bill: data.bill,
      lines: data.lines,
      supplier: data.supplier,
    }),
  );

  const filename = `${data.bill.internalReference ?? "bill-" + data.bill.id.slice(0, 8)}.pdf`;

  return pdfResponse(pdf, filename);
}
