import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { BranchFormClient } from "../branch-form-client";
import type { Branch } from "@/lib/api";

export const metadata: Metadata = { title: "Branch" };

async function fetchBranch(id: string): Promise<Branch | null> {
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/branches/${id}`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const data = (await res.json()) as { branch: Branch };
  return data.branch;
}

export default async function BranchDetailPage({ params }: { params: { id: string } }) {
  const branch = await fetchBranch(params.id);
  if (!branch) notFound();
  return <BranchFormClient mode="edit" initial={branch} />;
}
