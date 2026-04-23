"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Fingerprint, Loader2, Plus, Trash2 } from "lucide-react";
import {
  api,
  ApiError,
  type AttendanceDevice,
  type AttendanceDeviceType,
  type AttendanceDeviceExportFormat,
  type Branch,
  type BiometricMapRow,
  type EmployeeListRow,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatDate } from "@/lib/format";

const DEVICE_TYPE_LABELS: Record<AttendanceDeviceType, string> = {
  zkteco: "ZKTeco",
  essl: "eSSL",
  suprema: "Suprema",
  other: "Other biometric",
  qr: "QR kiosk",
  manual: "Manual",
};

const EXPORT_FORMAT_LABELS: Record<AttendanceDeviceExportFormat, string> = {
  csv: "CSV",
  xlsx: "Excel (XLSX)",
  txt: "TXT",
};

interface Props {
  devices: AttendanceDevice[];
  branches: Branch[];
}

export function DevicesClient({ devices, branches }: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AttendanceDevice | null>(null);
  const [mappingDevice, setMappingDevice] = useState<AttendanceDevice | null>(
    null,
  );

  return (
    <main className="container-p py-10">
      <Link
        href="/app/attendance"
        className="inline-flex items-center gap-1.5 text-small text-text-secondary hover:text-charcoal"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Back to attendance
      </Link>

      <PageHeader
        eyebrow="HR · Attendance"
        title="Devices"
        description="Biometric machines, QR kiosks, and manual-muster sources. Each device remembers its column layout after the first successful import, so repeat uploads are one click."
        action={
          <button
            type="button"
            className="btn-primary"
            onClick={() => setCreating(true)}
          >
            <Plus className="h-4 w-4" aria-hidden />
            New device
          </button>
        }
      />

      <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border text-left text-small text-text-secondary">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Branch</th>
              <th className="px-4 py-3 font-medium">Format</th>
              <th className="px-4 py-3 font-medium">Last import</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-12 text-center text-small text-text-secondary"
                >
                  No devices yet. Add your first biometric or QR source.
                </td>
              </tr>
            )}
            {devices.map((d) => {
              const branch = branches.find((b) => b.id === d.branchId);
              return (
                <tr
                  key={d.id}
                  className="border-b border-border last:border-0 text-body text-charcoal"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Fingerprint
                        className="h-4 w-4 text-text-secondary"
                        aria-hidden
                      />
                      <span className="font-medium">{d.name}</span>
                    </div>
                    {d.notes && (
                      <p className="mt-1 text-small text-text-secondary">
                        {d.notes}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-small">
                    {DEVICE_TYPE_LABELS[d.deviceType]}
                  </td>
                  <td className="px-4 py-3 text-small">
                    {branch?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-small">
                    {d.exportFormat
                      ? EXPORT_FORMAT_LABELS[d.exportFormat]
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-small text-text-secondary">
                    {d.lastImportAt ? formatDate(d.lastImportAt) : "Never"}
                  </td>
                  <td className="px-4 py-3 text-right text-small">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => setMappingDevice(d)}
                      >
                        Mapping
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => setEditing(d)}
                      >
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <DeviceFormModal
          device={editing}
          branches={branches}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {mappingDevice && (
        <MappingModal
          device={mappingDevice}
          onClose={() => setMappingDevice(null)}
        />
      )}
    </main>
  );
}

function DeviceFormModal({
  device,
  branches,
  onClose,
  onSaved,
}: {
  device: AttendanceDevice | null;
  branches: Branch[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = device !== null;
  const [name, setName] = useState(device?.name ?? "");
  const [deviceType, setDeviceType] = useState<AttendanceDeviceType>(
    device?.deviceType ?? "zkteco",
  );
  const [branchId, setBranchId] = useState(device?.branchId ?? "");
  const [exportFormat, setExportFormat] = useState<
    AttendanceDeviceExportFormat | ""
  >(device?.exportFormat ?? "csv");
  const [notes, setNotes] = useState(device?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (isEdit && device) {
        await api.updateAttendanceDevice(device.id, {
          name: name.trim(),
          deviceType,
          branchId: branchId || null,
          exportFormat: exportFormat || null,
          notes: notes.trim() || undefined,
        });
      } else {
        await api.createAttendanceDevice({
          name: name.trim(),
          deviceType,
          branchId: branchId || null,
          exportFormat: exportFormat || null,
          notes: notes.trim() || undefined,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!device) return;
    if (
      !confirm(
        `Delete device "${device.name}"? Existing attendance records keep their reference but this device won't accept new imports.`,
      )
    )
      return;
    setDeleting(true);
    try {
      await api.deleteAttendanceDevice(device.id);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed.");
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-card bg-surface-elevated p-6 shadow-xl"
      >
        <h2 className="text-h5 font-medium text-charcoal">
          {isEdit ? "Edit device" : "New device"}
        </h2>
        <div className="mt-4 grid gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-small text-text-secondary">Name</span>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              placeholder="Main gate ZKTeco"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-small text-text-secondary">Device type</span>
            <select
              value={deviceType}
              onChange={(e) =>
                setDeviceType(e.target.value as AttendanceDeviceType)
              }
              className="input"
            >
              {(
                [
                  "zkteco",
                  "essl",
                  "suprema",
                  "other",
                  "qr",
                  "manual",
                ] as const
              ).map((t) => (
                <option key={t} value={t}>
                  {DEVICE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-small text-text-secondary">
              Branch (optional)
            </span>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="input"
            >
              <option value="">—</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-small text-text-secondary">Export format</span>
            <select
              value={exportFormat}
              onChange={(e) =>
                setExportFormat(
                  e.target.value as AttendanceDeviceExportFormat | "",
                )
              }
              className="input"
            >
              <option value="">—</option>
              <option value="csv">CSV</option>
              <option value="xlsx">Excel (XLSX)</option>
              <option value="txt">TXT</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-small text-text-secondary">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="input"
              rows={2}
              placeholder="Any quirks worth remembering…"
            />
          </label>
        </div>

        {error && (
          <p className="mt-3 rounded border border-danger/40 bg-danger-bg/40 px-3 py-2 text-small text-danger">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-between gap-2">
          {isEdit ? (
            <button
              type="button"
              className="btn-ghost text-danger"
              onClick={onDelete}
              disabled={deleting || saving}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="h-4 w-4" aria-hidden />
              )}
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-ghost"
              onClick={onClose}
              disabled={saving || deleting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={saving || deleting}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function MappingModal({
  device,
  onClose,
}: {
  device: AttendanceDevice;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<EmployeeListRow[]>([]);
  const [rows, setRows] = useState<
    Array<{ biometricEmployeeId: string; employeeId: string }>
  >([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([api.getBiometricMap(device.id), api.listEmployees()])
      .then(([m, e]) => {
        if (!mounted) return;
        setRows(
          m.rows.map((r) => ({
            biometricEmployeeId: r.biometricEmployeeId,
            employeeId: r.employeeId,
          })),
        );
        setEmployees(e.employees);
      })
      .catch((err) => {
        if (mounted)
          setError(err instanceof ApiError ? err.message : "Load failed.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [device.id]);

  function updateRow(
    index: number,
    patch: Partial<{ biometricEmployeeId: string; employeeId: string }>,
  ) {
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index]!, ...patch };
      return next;
    });
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { biometricEmployeeId: "", employeeId: "" },
    ]);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const clean = rows
        .map((r) => ({
          biometricEmployeeId: r.biometricEmployeeId.trim(),
          employeeId: r.employeeId,
        }))
        .filter((r) => r.biometricEmployeeId && r.employeeId);
      await api.replaceBiometricMap(device.id, clean);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4">
      <div className="w-full max-w-2xl rounded-card bg-surface-elevated p-6 shadow-xl">
        <h2 className="text-h5 font-medium text-charcoal">
          Biometric ID mapping — {device.name}
        </h2>
        <p className="mt-1 text-small text-text-secondary">
          Match the device&apos;s employee IDs to your employee records.
          Unmapped IDs get skipped at import time and listed in the error log.
        </p>

        {loading ? (
          <div className="mt-6 grid place-items-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-text-secondary" />
          </div>
        ) : (
          <>
            <div className="mt-4 max-h-[50vh] overflow-y-auto rounded-card border-hairline border-border">
              <table className="w-full">
                <thead className="bg-surface-recessed">
                  <tr className="text-left text-small text-text-secondary">
                    <th className="px-3 py-2 font-medium">Device ID</th>
                    <th className="px-3 py-2 font-medium">Employee</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-3 py-6 text-center text-small text-text-secondary"
                      >
                        No mappings yet.
                      </td>
                    </tr>
                  )}
                  {rows.map((r, i) => (
                    <tr
                      key={i}
                      className="border-t border-border text-body"
                    >
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={r.biometricEmployeeId}
                          onChange={(e) =>
                            updateRow(i, {
                              biometricEmployeeId: e.target.value,
                            })
                          }
                          className="input"
                          placeholder="e.g. 1042"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={r.employeeId}
                          onChange={(e) =>
                            updateRow(i, { employeeId: e.target.value })
                          }
                          className="input"
                        >
                          <option value="">—</option>
                          {employees.map((emp) => (
                            <option key={emp.id} value={emp.id}>
                              {emp.fullName}
                              {emp.employeeCode
                                ? ` (${emp.employeeCode})`
                                : ""}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => removeRow(i)}
                          title="Remove row"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              className="btn-ghost mt-3"
              onClick={addRow}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add row
            </button>
          </>
        )}

        {error && (
          <p className="mt-3 rounded border border-danger/40 bg-danger-bg/40 px-3 py-2 text-small text-danger">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={save}
            disabled={saving || loading}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Save mapping
          </button>
        </div>
      </div>
    </div>
  );
}
