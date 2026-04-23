import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { AttendanceRecord, Branch } from "@/lib/api";
import { AttendanceDetailClient } from "./detail-client";

export const metadata: Metadata = { title: "Attendance record" };

async function fetchRecord(id: string): Promise<{
  record: AttendanceRecord | null;
  branches: Branch[];
}> {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [rRes, bRes] = await Promise.all([
    fetch(`${base}/attendance/records/${id}`, { headers, cache: "no-store" }),
    fetch(`${base}/branches`, { headers, cache: "no-store" }),
  ]);
  if (!rRes.ok) return { record: null, branches: [] };
  const { record } = (await rRes.json()) as { record: AttendanceRecord };
  const branches = bRes.ok
    ? ((await bRes.json()) as { branches: Branch[] }).branches
    : [];
  return { record, branches };
}

export default async function AttendanceDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { record, branches } = await fetchRecord(params.id);
  if (!record) notFound();
  return <AttendanceDetailClient record={record} branches={branches} />;
}
