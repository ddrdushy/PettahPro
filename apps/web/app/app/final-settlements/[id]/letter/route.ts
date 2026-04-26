import { cookies } from "next/headers";
import { renderToBuffer } from "@react-pdf/renderer";
import { SettlementLetterPDF } from "@/lib/settlement-letter-pdf";
import { pdfResponse } from "@/lib/pdf-response";
import { fetchTenantLogoDataUrl } from "@/lib/tenant-logo";
import type { FinalSettlementRow, Tenant } from "@/lib/api";

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

  const [meRes, settlementRes, logoDataUrl] = await Promise.all([
    fetch(`${base}/auth/me`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }),
    fetch(`${base}/final-settlements/${params.id}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }),
    fetchTenantLogoDataUrl(cookieHeader),
  ]);
  if (meRes.status === 401) return new Response("Unauthorized", { status: 401 });
  if (settlementRes.status === 404)
    return new Response("Settlement not found", { status: 404 });
  if (!meRes.ok || !settlementRes.ok) {
    return new Response("Couldn't load settlement", { status: 502 });
  }

  const me = (await meRes.json()) as { user: unknown; tenant: Tenant };
  const { settlement } = (await settlementRes.json()) as {
    settlement: FinalSettlementRow;
  };

  const pdf = await renderToBuffer(
    SettlementLetterPDF({
      tenant: { businessName: me.tenant.businessName },
      settlement,
      logoDataUrl,
    }),
  );

  const number = settlement.settlementNumber ?? `draft-${settlement.id.slice(0, 8)}`;
  const safeName = settlement.employeeFullName.replace(/[^a-z0-9]+/gi, "_");
  const filename = `settlement_${number}_${safeName}.pdf`;

  return pdfResponse(pdf, filename);
}
