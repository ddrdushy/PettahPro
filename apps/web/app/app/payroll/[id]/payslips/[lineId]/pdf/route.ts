import { cookies } from "next/headers";
import { renderToBuffer } from "@react-pdf/renderer";
import { PayslipPDF } from "@/lib/payslip-pdf";
import { pdfResponse } from "@/lib/pdf-response";
import type { PayrollRun, PayrollRunLine, Tenant } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { id: string; lineId: string } },
) {
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const cookieHeader = cookies().toString();
  if (!cookieHeader) {
    return new Response("Unauthorized", { status: 401 });
  }

  const [meRes, runRes] = await Promise.all([
    fetch(`${base}/auth/me`, { headers: { cookie: cookieHeader }, cache: "no-store" }),
    fetch(`${base}/payroll-runs/${params.id}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }),
  ]);
  if (meRes.status === 401) return new Response("Unauthorized", { status: 401 });
  if (runRes.status === 404) return new Response("Run not found", { status: 404 });
  if (!meRes.ok || !runRes.ok) {
    return new Response("Couldn't load payroll data", { status: 502 });
  }

  const me = (await meRes.json()) as { user: unknown; tenant: Tenant };
  const runData = (await runRes.json()) as {
    run: PayrollRun;
    lines: PayrollRunLine[];
  };
  const line = runData.lines.find((l) => l.id === params.lineId);
  if (!line) return new Response("Payslip not found", { status: 404 });

  const pdf = await renderToBuffer(
    PayslipPDF({
      tenant: { businessName: me.tenant.businessName },
      run: runData.run,
      line,
    }),
  );

  const periodTag = `${runData.run.periodYear}-${String(runData.run.periodMonth).padStart(2, "0")}`;
  const safeName = line.employeeFullName.replace(/[^a-z0-9]+/gi, "_");
  const filename = `payslip_${periodTag}_${safeName}.pdf`;

  return pdfResponse(pdf, filename);
}
