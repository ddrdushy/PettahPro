import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LeaveRequestDetailClient } from "./leave-request-detail-client";
import type { LeaveRequestDetail, LeaveType, Employee } from "@/lib/api";

export const metadata: Metadata = { title: "Leave request" };

async function fetchReq(id: string): Promise<{
  leaveRequest: LeaveRequestDetail;
  employee: Employee | null;
  leaveType: LeaveType | null;
} | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/leave-requests/${id}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.json();
}

export default async function LeaveRequestPage({ params }: { params: { id: string } }) {
  const data = await fetchReq(params.id);
  if (!data) notFound();
  return <LeaveRequestDetailClient {...data} />;
}
