import { cookies } from "next/headers";
import { renderToBuffer } from "@react-pdf/renderer";
import { StockTransferPDF } from "@/lib/stock-transfer-pdf";
import { pdfResponse } from "@/lib/pdf-response";
import { fetchTenantLogoDataUrl } from "@/lib/tenant-logo";
import type {
  StockTransferDetail,
  StockTransferLineRow,
  StockTransferWarehouse,
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

  const [meRes, tRes, logoDataUrl] = await Promise.all([
    fetch(`${base}/auth/me`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
    fetch(`${base}/stock-transfers/${params.id}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }),
    fetchTenantLogoDataUrl(cookieHeader),
  ]);
  if (meRes.status === 401) return new Response("Unauthorized", { status: 401 });
  if (tRes.status === 404) return new Response("Stock transfer not found", { status: 404 });
  if (!meRes.ok || !tRes.ok) {
    return new Response("Couldn't load stock transfer", { status: 502 });
  }

  const me = (await meRes.json()) as { user: unknown; tenant: Tenant };
  const data = (await tRes.json()) as {
    transfer: StockTransferDetail;
    lines: StockTransferLineRow[];
    source: StockTransferWarehouse | null;
    destination: StockTransferWarehouse | null;
  };

  const pdf = await renderToBuffer(
    StockTransferPDF({
      tenant: { businessName: me.tenant.businessName },
      transfer: data.transfer,
      lines: data.lines,
      source: data.source,
      destination: data.destination,
      logoDataUrl,
    }),
  );

  const filename = `${data.transfer.transferNumber ?? "stock-transfer-" + data.transfer.id.slice(0, 8)}.pdf`;

  return pdfResponse(pdf, filename);
}
