import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Clock, Plus, Upload, Fingerprint, AlertTriangle } from "lucide-react";
import type {
  AttendanceRecord,
  Branch,
  EmployeeListRow,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatDate } from "@/lib/format";
import { AttendanceListClient } from "./list-client";

export const metadata: Metadata = { title: "Attendance" };

interface LoaderData {
  records: AttendanceRecord[];
  branches: Branch[];
  employees: EmployeeListRow[];
  exceptionsCount: number;
}

async function fetchData(params: {
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  method?: string;
  branchId?: string;
  employeeId?: string;
  hasConflict?: string;
}): Promise<LoaderData> {
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const cookie = cookies().toString();

  const qs = new URLSearchParams();
  if (params.dateFrom) qs.set("date_from", params.dateFrom);
  if (params.dateTo) qs.set("date_to", params.dateTo);
  if (params.status) qs.set("status", params.status);
  if (params.method) qs.set("method", params.method);
  if (params.branchId) qs.set("branch_id", params.branchId);
  if (params.employeeId) qs.set("employee_id", params.employeeId);
  if (params.hasConflict) qs.set("has_conflict", params.hasConflict);

  const [rRes, bRes, eRes, excRes] = await Promise.all([
    fetch(
      `${base}/attendance/records${qs.toString() ? `?${qs.toString()}` : ""}`,
      { headers: { cookie }, cache: "no-store" },
    ),
    fetch(`${base}/branches`, { headers: { cookie }, cache: "no-store" }),
    fetch(`${base}/employees`, { headers: { cookie }, cache: "no-store" }),
    fetch(`${base}/attendance/exceptions`, {
      headers: { cookie },
      cache: "no-store",
    }),
  ]);
  return {
    records: rRes.ok
      ? ((await rRes.json()) as { records: AttendanceRecord[] }).records
      : [],
    branches: bRes.ok
      ? ((await bRes.json()) as { branches: Branch[] }).branches
      : [],
    employees: eRes.ok
      ? ((await eRes.json()) as { employees: EmployeeListRow[] }).employees
      : [],
    exceptionsCount: excRes.ok
      ? (((await excRes.json()) as { exceptions: unknown[] }).exceptions
          ?.length ?? 0)
      : 0,
  };
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: {
    date_from?: string;
    date_to?: string;
    status?: string;
    method?: string;
    branch_id?: string;
    employee_id?: string;
    has_conflict?: string;
  };
}) {
  // Default window: last 7 days — keeps the table responsive even when
  // the log grows into tens of thousands of rows.
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 6);
  const dateFrom = searchParams.date_from ?? weekAgo.toISOString().slice(0, 10);
  const dateTo = searchParams.date_to ?? today.toISOString().slice(0, 10);

  const data = await fetchData({
    dateFrom,
    dateTo,
    status: searchParams.status,
    method: searchParams.method,
    branchId: searchParams.branch_id,
    employeeId: searchParams.employee_id,
    hasConflict: searchParams.has_conflict,
  });

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="HR"
        title="Attendance"
        description="Daily clock-in/out log. Four capture methods fold onto one record per (employee, day): self check-in, QR kiosk, biometric file import, and supervisor muster. Payroll pulls total minutes from here."
        action={
          <div className="flex items-center gap-2">
            <Link
              href="/app/attendance/devices"
              className="btn-ghost"
              title="Attendance devices"
            >
              <Fingerprint className="h-4 w-4" aria-hidden />
              Devices
            </Link>
            <Link href="/app/attendance/import" className="btn-ghost">
              <Upload className="h-4 w-4" aria-hidden />
              Import
            </Link>
          </div>
        }
      />

      {data.exceptionsCount > 0 && (
        <div
          role="alert"
          className="mt-6 flex items-center gap-3 rounded-card border-hairline border-warning/40 bg-warning-bg/40 px-4 py-3 text-small text-charcoal"
        >
          <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
          <span className="flex-1">
            {data.exceptionsCount} attendance record
            {data.exceptionsCount === 1 ? "" : "s"} need supervisor attention
            (method mismatch or missed check-out).
          </span>
          <Link
            href="/app/attendance?has_conflict=true"
            className="underline underline-offset-4 hover:text-warning"
          >
            Review
          </Link>
        </div>
      )}

      <AttendanceListClient
        records={data.records}
        branches={data.branches}
        employees={data.employees}
        filters={{
          dateFrom,
          dateTo,
          status: searchParams.status,
          method: searchParams.method,
          branchId: searchParams.branch_id,
          employeeId: searchParams.employee_id,
          hasConflict: searchParams.has_conflict,
        }}
      />

      {data.records.length === 0 && (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
            <Clock className="h-5 w-5" />
          </div>
          <p className="text-body text-charcoal">
            No attendance records match these filters.
          </p>
          <p className="mt-1 text-small text-text-secondary">
            Records land here from self check-ins, QR kiosks, biometric
            imports, and manual muster. From {formatDate(dateFrom)} to{" "}
            {formatDate(dateTo)}.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Link
              href="/app/attendance/import"
              className="btn-ghost inline-flex"
            >
              <Upload className="h-4 w-4" aria-hidden />
              Import file
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
