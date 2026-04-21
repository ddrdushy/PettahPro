import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LeaveTypesClient } from "./leave-types-client";
import type { LeaveType } from "@/lib/api";

export const metadata: Metadata = { title: "Leave types" };

async function fetchLeaveTypes(): Promise<LeaveType[]> {
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/leave-types`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { leaveTypes: LeaveType[] };
  return data.leaveTypes;
}

export default async function LeaveTypesPage() {
  const leaveTypes = await fetchLeaveTypes();
  return <LeaveTypesClient initial={leaveTypes} />;
}
