"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClipboardCheck, Loader2 } from "lucide-react";
import {
  api,
  ApiError,
  type AttendanceRecord,
  type AttendanceStatus,
  type AttendanceMethod,
  type Branch,
  type EmployeeListRow,
} from "@/lib/api";
import { formatDate } from "@/lib/format";

export const statusStyles: Record<AttendanceStatus, string> = {
  present: "bg-mint text-mint-dark",
  absent: "bg-danger-bg/60 text-danger",
  half_day: "bg-warning-bg text-warning",
  on_leave: "bg-surface-recessed text-text-secondary",
  holiday: "bg-surface-recessed text-text-secondary",
};

export const statusLabels: Record<AttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  half_day: "Half-day",
  on_leave: "On leave",
  holiday: "Holiday",
};

export const methodLabels: Record<AttendanceMethod, string> = {
  qr: "QR kiosk",
  biometric: "Biometric",
  geofence: "Geofence",
  manual_muster: "Muster",
  self: "Self",
};

interface Filters {
  dateFrom: string;
  dateTo: string;
  status?: string;
  method?: string;
  branchId?: string;
  employeeId?: string;
  hasConflict?: string;
}

export function AttendanceListClient({
  records,
  branches,
  employees,
  filters,
}: {
  records: AttendanceRecord[];
  branches: Branch[];
  employees: EmployeeListRow[];
  filters: Filters;
}) {
  const router = useRouter();
  const [musterOpen, setMusterOpen] = useState(false);

  function applyFilters(next: Partial<Filters>) {
    const params = new URLSearchParams();
    const merged: Filters = { ...filters, ...next };
    params.set("date_from", merged.dateFrom);
    params.set("date_to", merged.dateTo);
    if (merged.status) params.set("status", merged.status);
    if (merged.method) params.set("method", merged.method);
    if (merged.branchId) params.set("branch_id", merged.branchId);
    if (merged.employeeId) params.set("employee_id", merged.employeeId);
    if (merged.hasConflict) params.set("has_conflict", merged.hasConflict);
    router.push(`/app/attendance?${params.toString()}`);
  }

  return (
    <>
      <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-4">
        <div className="grid gap-3 md:grid-cols-6">
          <label className="block text-caption text-text-secondary">
            From
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => applyFilters({ dateFrom: e.target.value })}
              className="mt-1 w-full rounded-md border-hairline border-border bg-surface-recessed px-2 py-1.5 text-small"
            />
          </label>
          <label className="block text-caption text-text-secondary">
            To
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => applyFilters({ dateTo: e.target.value })}
              className="mt-1 w-full rounded-md border-hairline border-border bg-surface-recessed px-2 py-1.5 text-small"
            />
          </label>
          <label className="block text-caption text-text-secondary">
            Employee
            <select
              value={filters.employeeId ?? ""}
              onChange={(e) =>
                applyFilters({ employeeId: e.target.value || undefined })
              }
              className="mt-1 w-full rounded-md border-hairline border-border bg-surface-recessed px-2 py-1.5 text-small"
            >
              <option value="">All</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-caption text-text-secondary">
            Branch
            <select
              value={filters.branchId ?? ""}
              onChange={(e) =>
                applyFilters({ branchId: e.target.value || undefined })
              }
              className="mt-1 w-full rounded-md border-hairline border-border bg-surface-recessed px-2 py-1.5 text-small"
            >
              <option value="">All</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-caption text-text-secondary">
            Status
            <select
              value={filters.status ?? ""}
              onChange={(e) =>
                applyFilters({ status: e.target.value || undefined })
              }
              className="mt-1 w-full rounded-md border-hairline border-border bg-surface-recessed px-2 py-1.5 text-small"
            >
              <option value="">All</option>
              {(
                [
                  "present",
                  "absent",
                  "half_day",
                  "on_leave",
                  "holiday",
                ] as AttendanceStatus[]
              ).map((s) => (
                <option key={s} value={s}>
                  {statusLabels[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-caption text-text-secondary">
            Method
            <select
              value={filters.method ?? ""}
              onChange={(e) =>
                applyFilters({ method: e.target.value || undefined })
              }
              className="mt-1 w-full rounded-md border-hairline border-border bg-surface-recessed px-2 py-1.5 text-small"
            >
              <option value="">All</option>
              {(
                [
                  "self",
                  "qr",
                  "biometric",
                  "geofence",
                  "manual_muster",
                ] as AttendanceMethod[]
              ).map((m) => (
                <option key={m} value={m}>
                  {methodLabels[m]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              applyFilters({
                hasConflict: filters.hasConflict === "true" ? undefined : "true",
              })
            }
            className={`rounded-full border-hairline px-3 py-1 text-small transition ${
              filters.hasConflict === "true"
                ? "border-warning bg-warning-bg/60 text-warning"
                : "border-border bg-surface-elevated text-text-secondary hover:border-charcoal hover:text-charcoal"
            }`}
          >
            Conflicts only
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setMusterOpen(true)}
            className="btn-primary"
          >
            <ClipboardCheck className="h-4 w-4" aria-hidden />
            Mark muster
          </button>
        </div>
      </section>

      {records.length > 0 && (
        <section className="mt-6 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="w-28 px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Employee</th>
                <th className="w-24 px-4 py-3 text-left">Check-in</th>
                <th className="w-24 px-4 py-3 text-left">Check-out</th>
                <th className="w-20 px-4 py-3 text-right">Minutes</th>
                <th className="w-28 px-4 py-3 text-left">Method</th>
                <th className="w-24 px-4 py-3 text-center">Status</th>
                <th className="w-6 px-2 py-3" aria-label="Conflict" />
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {records.map((r) => (
                <tr
                  key={r.id}
                  className="transition-colors hover:bg-surface-recessed/40"
                >
                  <td className="px-4 py-3 tabular-nums text-text-secondary">
                    {formatDate(r.attendanceDate)}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/app/attendance/${r.id}`}
                      className="text-charcoal underline-offset-4 hover:underline"
                    >
                      {r.employeeFullName ?? r.employeeId.slice(0, 8)}
                    </Link>
                    {r.employeeCode && (
                      <span className="ml-2 text-caption text-text-tertiary">
                        {r.employeeCode}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-text-secondary">
                    {r.checkInAt ? formatTime(r.checkInAt) : "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-text-secondary">
                    {r.checkOutAt ? formatTime(r.checkOutAt) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                    {r.totalMinutes ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {methodLabels[r.method]}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[r.status]}`}
                    >
                      {statusLabels[r.status]}
                    </span>
                  </td>
                  <td className="px-2 py-3 text-center">
                    {r.hasConflict && (
                      <span
                        className="inline-block h-2 w-2 rounded-full bg-warning"
                        aria-label={r.conflictReason ?? "Conflict"}
                        title={r.conflictReason ?? "Conflict"}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {musterOpen && (
        <MusterDialog
          employees={employees}
          branches={branches}
          onClose={() => setMusterOpen(false)}
          onDone={() => {
            setMusterOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("en-LK", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function MusterDialog({
  employees,
  branches,
  onClose,
  onDone,
}: {
  employees: EmployeeListRow[];
  branches: Branch[];
  onClose: () => void;
  onDone: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [branchId, setBranchId] = useState<string>("");
  const [status, setStatus] = useState<AttendanceStatus>("present");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  async function submit() {
    setError(null);
    if (picked.size === 0) {
      setError("Pick at least one employee.");
      return;
    }
    setSubmitting(true);
    try {
      await api.attendanceMuster({
        attendanceDate: date,
        branchId: branchId || null,
        employeeIds: Array.from(picked),
        status,
      });
      onDone();
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Failed to record muster.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Mark muster"
      className="fixed inset-0 z-50 grid place-items-center bg-charcoal/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-card border-hairline border-border bg-surface-elevated p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-body font-medium text-charcoal">Mark muster</h3>
        <p className="mt-1 text-small text-text-secondary">
          Supervisor sign-off for a whole branch at once. Records upsert on
          (employee, date) — re-marking is safe.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="block text-caption text-text-secondary">
            Date
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full rounded-md border-hairline border-border bg-surface-recessed px-2 py-1.5 text-small"
            />
          </label>
          <label className="block text-caption text-text-secondary">
            Branch
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="mt-1 w-full rounded-md border-hairline border-border bg-surface-recessed px-2 py-1.5 text-small"
            >
              <option value="">All</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-caption text-text-secondary">
            Status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as AttendanceStatus)}
              className="mt-1 w-full rounded-md border-hairline border-border bg-surface-recessed px-2 py-1.5 text-small"
            >
              {(
                [
                  "present",
                  "absent",
                  "half_day",
                  "on_leave",
                  "holiday",
                ] as AttendanceStatus[]
              ).map((s) => (
                <option key={s} value={s}>
                  {statusLabels[s]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 max-h-80 overflow-y-auto rounded-card border-hairline border-border">
          <table className="w-full text-small">
            <thead className="sticky top-0 bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="w-10 px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={picked.size === employees.length && employees.length > 0}
                    onChange={(e) =>
                      setPicked(
                        e.target.checked
                          ? new Set(employees.map((x) => x.id))
                          : new Set(),
                      )
                    }
                  />
                </th>
                <th className="px-3 py-2 text-left">Employee</th>
                <th className="w-28 px-3 py-2 text-left">Code</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {employees.map((e) => (
                <tr key={e.id} className="hover:bg-surface-recessed/40">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Pick ${e.fullName}`}
                      checked={picked.has(e.id)}
                      onChange={() => toggle(e.id)}
                    />
                  </td>
                  <td className="px-3 py-2 text-charcoal">{e.fullName}</td>
                  <td className="px-3 py-2 text-text-secondary">
                    {e.employeeCode ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-small text-danger">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="btn-primary"
            disabled={submitting}
          >
            {submitting && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            )}
            Save muster ({picked.size})
          </button>
        </div>
      </div>
    </div>
  );
}
