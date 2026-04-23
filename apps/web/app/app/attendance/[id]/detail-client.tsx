"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Loader2, AlertTriangle, Trash2 } from "lucide-react";
import {
  api,
  ApiError,
  type AttendanceRecord,
  type AttendanceStatus,
  type Branch,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { AttachmentsPanel } from "@/components/app/attachments-panel";
import { formatDate } from "@/lib/format";
import {
  methodLabels,
  statusLabels,
  statusStyles,
} from "../list-client";

function toLocalDatetimeInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalDatetimeInput(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function AttendanceDetailClient({
  record,
  branches,
}: {
  record: AttendanceRecord;
  branches: Branch[];
}) {
  const router = useRouter();

  const [branchId, setBranchId] = useState<string>(record.branchId ?? "");
  const [checkInAt, setCheckInAt] = useState<string>(
    toLocalDatetimeInput(record.checkInAt),
  );
  const [checkOutAt, setCheckOutAt] = useState<string>(
    toLocalDatetimeInput(record.checkOutAt),
  );
  const [status, setStatus] = useState<AttendanceStatus>(record.status);
  const [notes, setNotes] = useState<string>(record.notes ?? "");
  const [clearConflict, setClearConflict] = useState(false);
  const [conflictReason, setConflictReason] = useState<string>(
    record.conflictReason ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const branchName = useMemo(
    () =>
      record.branchId
        ? (branches.find((b) => b.id === record.branchId)?.name ?? null)
        : null,
    [branches, record.branchId],
  );

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const payload: Parameters<typeof api.updateAttendanceRecord>[1] = {
        branchId: branchId || null,
        checkInAt: fromLocalDatetimeInput(checkInAt),
        checkOutAt: fromLocalDatetimeInput(checkOutAt),
        status,
        notes,
      };
      if (clearConflict) {
        payload.hasConflict = false;
        payload.conflictReason = null;
      } else if (conflictReason !== (record.conflictReason ?? "")) {
        payload.conflictReason = conflictReason || null;
      }
      await api.updateAttendanceRecord(record.id, payload);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this attendance record? This is a soft delete.")) return;
    setSaving(true);
    try {
      await api.deleteAttendanceRecord(record.id);
      router.push("/app/attendance");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to delete.");
      setSaving(false);
    }
  }

  return (
    <main className="container-p py-10">
      <div className="mb-2">
        <Link
          href="/app/attendance"
          className="inline-flex items-center gap-1 text-caption text-text-secondary hover:text-charcoal"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to attendance
        </Link>
      </div>

      <PageHeader
        eyebrow="HR · Attendance"
        title={record.employeeFullName ?? "Attendance record"}
        description={`${formatDate(record.attendanceDate)} · ${methodLabels[record.method]}${
          branchName ? ` · ${branchName}` : ""
        }`}
        action={
          <span
            className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${statusStyles[record.status]}`}
          >
            {statusLabels[record.status]}
          </span>
        }
      />

      {record.hasConflict && (
        <div
          role="alert"
          className="mt-6 flex items-start gap-3 rounded-card border-hairline border-warning/40 bg-warning-bg/40 px-4 py-3 text-small text-charcoal"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-warning"
            aria-hidden
          />
          <div className="flex-1">
            <p className="font-medium text-warning">Has conflict</p>
            <p className="mt-0.5 text-text-secondary">
              {record.conflictReason ?? "Method mismatch detected."}
            </p>
          </div>
        </div>
      )}

      <section className="mt-8 grid gap-6 md:grid-cols-2">
        <div className="rounded-card border-hairline border-border bg-surface-elevated p-5">
          <h3 className="text-small font-medium text-text-secondary">Edit</h3>
          <div className="mt-3 grid gap-3">
            <label className="block text-caption text-text-secondary">
              Check-in
              <input
                type="datetime-local"
                value={checkInAt}
                onChange={(e) => setCheckInAt(e.target.value)}
                className="mt-1 w-full rounded-md border-hairline border-border bg-surface-recessed px-2 py-1.5 text-small"
              />
            </label>
            <label className="block text-caption text-text-secondary">
              Check-out
              <input
                type="datetime-local"
                value={checkOutAt}
                onChange={(e) => setCheckOutAt(e.target.value)}
                className="mt-1 w-full rounded-md border-hairline border-border bg-surface-recessed px-2 py-1.5 text-small"
              />
            </label>
            <label className="block text-caption text-text-secondary">
              Status
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as AttendanceStatus)
                }
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
            <label className="block text-caption text-text-secondary">
              Branch
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="mt-1 w-full rounded-md border-hairline border-border bg-surface-recessed px-2 py-1.5 text-small"
              >
                <option value="">—</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-caption text-text-secondary">
              Notes
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-md border-hairline border-border bg-surface-recessed px-2 py-1.5 text-small"
              />
            </label>

            {record.hasConflict && (
              <div className="rounded-md border-hairline border-border bg-surface-recessed p-3">
                <label className="flex items-center gap-2 text-small text-charcoal">
                  <input
                    type="checkbox"
                    checked={clearConflict}
                    onChange={(e) => setClearConflict(e.target.checked)}
                  />
                  Clear conflict flag on save
                </label>
                <label className="mt-2 block text-caption text-text-secondary">
                  Conflict reason
                  <input
                    type="text"
                    value={conflictReason}
                    onChange={(e) => setConflictReason(e.target.value)}
                    className="mt-1 w-full rounded-md border-hairline border-border bg-surface-elevated px-2 py-1.5 text-small"
                  />
                </label>
              </div>
            )}

            {error && (
              <p role="alert" className="text-small text-danger">
                {error}
              </p>
            )}

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={remove}
                className="inline-flex items-center gap-1 text-caption text-danger hover:underline"
                disabled={saving}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Delete record
              </button>
              <button
                type="button"
                onClick={save}
                className="btn-primary"
                disabled={saving}
              >
                {saving && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                )}
                Save
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-card border-hairline border-border bg-surface-elevated p-5">
            <h3 className="text-small font-medium text-text-secondary">
              Details
            </h3>
            <dl className="mt-3 grid grid-cols-2 gap-y-2 text-small">
              <dt className="text-text-tertiary">Employee</dt>
              <dd className="text-charcoal">
                {record.employeeFullName ?? "—"}
                {record.employeeCode && (
                  <span className="ml-2 text-caption text-text-tertiary">
                    {record.employeeCode}
                  </span>
                )}
              </dd>
              <dt className="text-text-tertiary">Method</dt>
              <dd className="text-charcoal">
                {methodLabels[record.method]}
              </dd>
              <dt className="text-text-tertiary">Total minutes</dt>
              <dd className="tabular-nums text-charcoal">
                {record.totalMinutes ?? "—"}
              </dd>
              <dt className="text-text-tertiary">Location</dt>
              <dd className="tabular-nums text-charcoal">
                {record.locationLat && record.locationLng
                  ? `${record.locationLat}, ${record.locationLng}`
                  : "—"}
              </dd>
              <dt className="text-text-tertiary">Created</dt>
              <dd className="text-charcoal">
                {formatDate(record.createdAt)}
              </dd>
            </dl>
          </div>

          <div className="rounded-card border-hairline border-border bg-surface-elevated p-5">
            <h3 className="text-small font-medium text-text-secondary">
              Attachments
            </h3>
            <p className="mt-1 text-caption text-text-tertiary">
              Attach geofence photos, muster sheet scans, or supporting proof.
            </p>
            <div className="mt-3">
              <AttachmentsPanel
                entityType="attendance_record"
                entityId={record.id}
              />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
