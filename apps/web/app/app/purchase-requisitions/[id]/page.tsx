import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { PurchaseRequisitionDetailClient } from "./detail-client";
import type {
  PurchaseRequisitionDetail,
  Supplier,
  Branch,
} from "@/lib/api";

export const metadata: Metadata = { title: "Purchase requisition" };

async function fetchAll(id: string) {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const res = await fetch(`${base}/purchase-requisitions/${id}`, {
    headers,
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const detail = (await res.json()) as PurchaseRequisitionDetail;

  // Look up optional related rows for display. Failures aren't fatal —
  // we just render "—" where they'd otherwise be shown.
  const [suppliersRes, branchesRes] = await Promise.all([
    fetch(`${base}/suppliers`, { headers, cache: "no-store" }),
    fetch(`${base}/branches`, { headers, cache: "no-store" }),
  ]);
  const suppliers = suppliersRes.ok
    ? ((await suppliersRes.json()) as { suppliers: Supplier[] }).suppliers
    : [];
  const branches = branchesRes.ok
    ? ((await branchesRes.json()) as { branches: Branch[] }).branches
    : [];
  return { detail, suppliers, branches };
}

export default async function PurchaseRequisitionDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const data = await fetchAll(params.id);
  if (!data) notFound();
  return (
    <PurchaseRequisitionDetailClient
      detail={data.detail}
      suppliers={data.suppliers}
      branches={data.branches}
    />
  );
}
