import { cookies } from "next/headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Next.js route that proxies the API's CSV response. Runs server-side so the
// session cookie and INTERNAL_API_URL stay off the browser.
const KIND_TO_API: Record<string, string> = {
  epf: "epf-csv",
  etf: "etf-csv",
  paye: "paye-csv",
};

export async function GET(
  _req: Request,
  { params }: { params: { id: string; kind: string } },
) {
  const slug = KIND_TO_API[params.kind];
  if (!slug) return new Response("Unknown filing kind", { status: 404 });

  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const cookieHeader = cookies().toString();
  if (!cookieHeader) return new Response("Unauthorized", { status: 401 });

  const res = await fetch(`${base}/payroll-runs/${params.id}/${slug}`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (res.status === 401) return new Response("Unauthorized", { status: 401 });
  if (res.status === 404) return new Response("Run not found", { status: 404 });
  if (!res.ok) {
    const body = await res.text();
    return new Response(body || "Couldn't generate filing", {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await res.text();
  const disposition =
    res.headers.get("content-disposition") ??
    `attachment; filename="${params.kind}-${params.id.slice(0, 8)}.csv"`;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": disposition,
      "Cache-Control": "private, no-store",
    },
  });
}
