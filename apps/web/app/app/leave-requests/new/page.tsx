import type { Metadata } from "next";
import { cookies } from "next/headers";
import { NewLeaveRequestClient } from "./new-leave-request-client";
import type { EmployeeListRow, LeaveType } from "@/lib/api";

export const metadata: Metadata = { title: "New leave request" };

async function fetchAll() {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [e, lt] = await Promise.all([
    fetch(`${base}/employees`, { headers, cache: "no-store" }),
    fetch(`${base}/leave-types`, { headers, cache: "no-store" }),
  ]);
  return {
    employees: e.ok ? ((await e.json()) as { employees: EmployeeListRow[] }).employees : [],
    leaveTypes: lt.ok ? ((await lt.json()) as { leaveTypes: LeaveType[] }).leaveTypes.filter((t) => t.isActive) : [],
  };
}

export default async function NewLeaveRequestPage() {
  const data = await fetchAll();
  return <NewLeaveRequestClient {...data} />;
}
