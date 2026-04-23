import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { AttendanceDevice, AttendanceImport } from "@/lib/api";
import { ImportClient } from "./import-client";

export const metadata: Metadata = { title: "Import attendance" };

async function fetchAll(): Promise<{
  devices: AttendanceDevice[];
  imports: AttendanceImport[];
}> {
  const headers = { cookie: cookies().toString() };
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const [d, i] = await Promise.all([
    fetch(`${base}/attendance/devices`, { headers, cache: "no-store" }),
    fetch(`${base}/attendance/imports`, { headers, cache: "no-store" }),
  ]);
  return {
    devices: d.ok
      ? ((await d.json()) as { devices: AttendanceDevice[] }).devices
      : [],
    imports: i.ok
      ? ((await i.json()) as { imports: AttendanceImport[] }).imports
      : [],
  };
}

export default async function ImportPage() {
  const data = await fetchAll();
  return <ImportClient devices={data.devices} imports={data.imports} />;
}
