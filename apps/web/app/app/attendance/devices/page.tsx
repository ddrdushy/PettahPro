import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { AttendanceDevice, Branch } from "@/lib/api";
import { DevicesClient } from "./devices-client";

export const metadata: Metadata = { title: "Attendance devices" };

async function fetchAll(): Promise<{
  devices: AttendanceDevice[];
  branches: Branch[];
}> {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [d, b] = await Promise.all([
    fetch(`${base}/attendance/devices`, { headers, cache: "no-store" }),
    fetch(`${base}/branches`, { headers, cache: "no-store" }),
  ]);
  return {
    devices: d.ok
      ? ((await d.json()) as { devices: AttendanceDevice[] }).devices
      : [],
    branches: b.ok
      ? ((await b.json()) as { branches: Branch[] }).branches
      : [],
  };
}

export default async function DevicesPage() {
  const data = await fetchAll();
  return <DevicesClient devices={data.devices} branches={data.branches} />;
}
