import { cookies } from "next/headers";
import { renderToBuffer } from "@react-pdf/renderer";
import { PurchaseOrderPDF } from "@/lib/purchase-order-pdf";
import { pdfResponse } from "@/lib/pdf-response";
import { fetchTenantLogoDataUrl } from "@/lib/tenant-logo";
import type { PurchaseOrderDetail, PurchaseOrderLine, Supplier, Tenant } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return new Response("Unauthorized", { status: 401 });

  const [meRes, poRes, logoDataUrl] = await Promise.all([
    fetch(`${base}/auth/me`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
    fetch(`${base}/purchase-orders/${params.id}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }),
    fetchTenantLogoDataUrl(cookieHeader),
  ]);
  if (meRes.status === 401) return new Response("Unauthorized", { status: 401 });
  if (poRes.status === 404) return new Response("Purchase order not found", { status: 404 });
  if (!meRes.ok || !poRes.ok) return new Response("Couldn't load purchase order", { status: 502 });

  const me = (await meRes.json()) as { user: unknown; tenant: Tenant };
  const data = (await poRes.json()) as {
    purchaseOrder: PurchaseOrderDetail;
    lines: PurchaseOrderLine[];
    supplier: Supplier | null;
  };

  const pdf = await renderToBuffer(
    PurchaseOrderPDF({
      tenant: { businessName: me.tenant.businessName },
      purchaseOrder: data.purchaseOrder,
      lines: data.lines,
      supplier: data.supplier,
      logoDataUrl,
    }),
  );

  const filename = `${data.purchaseOrder.poNumber ?? "po-" + data.purchaseOrder.id.slice(0, 8)}.pdf`;

  return pdfResponse(pdf, filename);
}
