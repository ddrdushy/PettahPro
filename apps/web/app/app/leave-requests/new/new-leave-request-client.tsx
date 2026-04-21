"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api, ApiError, type EmployeeListRow, type LeaveType, type EmployeeLeaveBalance } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";

// Inclusive day count between two YYYY-MM-DD dates.
function daysBetween(from: string, to: string): number {
  if (!from || !to || from > to) return 0;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  return Math.floor((b - a) / 86_400_000) + 1;
}

export function NewLeaveRequestClient({
  employees,
  leaveTypes,
}: {
  employees: EmployeeListRow[];
  leaveTypes: LeaveType[];
}) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [fromDate, setFromDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [daysCount, setDaysCount] = useState("1");
  const [reason, setReason] = useState("");
  const [balance, setBalance] = useState<EmployeeLeaveBalance | null>(null);
  const [submitAfterSave, setSubmitAfterSave] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-suggest the day count when the user picks a date range.
  useEffect(() => {
    const computed = daysBetween(fromDate, toDate);
    if (computed > 0) setDaysCount(String(computed));
  }, [fromDate, toDate]);

  // Pull the selected employee's balance for the selected type.
  useEffect(() => {
    setBalance(null);
    if (!employeeId || !leaveTypeId) return;
    const year = Number(fromDate.slice(0, 4));
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getEmployeeLeaveBalance(employeeId, year);
        if (cancelled) return;
        setBalance(res.balances.find((b) => b.leaveTypeId === leaveTypeId) ?? null);
      } catch {
        /* ignore; balance panel is informational */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeId, leaveTypeId, fromDate]);

  async function submit() {
    setError(null);
    if (!employeeId) { setError("Pick an employee."); return; }
    if (!leaveTypeId) { setError("Pick a leave type."); return; }
    const days = Number(daysCount);
    if (!Number.isFinite(days) || days <= 0) { setError("Enter a positive day count."); return; }
    if (fromDate > toDate) { setError("From date must be on or before To date."); return; }

    setBusy(true);
    try {
      const res = await api.createLeaveRequest({
        employeeId,
        leaveTypeId,
        fromDate,
        toDate,
        daysCount: days,
        reason: reason.trim() || undefined,
      });
      if (submitAfterSave) {
        await api.submitLeaveRequest(res.leaveRequest.id);
      }
      router.push(`/app/leave-requests/${res.leaveRequest.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save.");
      setBusy(false);
    }
  }

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/leave-requests" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to leave requests
        </Link>
      </div>

      <PageHeader
        eyebrow="HR"
        title="Apply for leave"
        description="Record leave on behalf of an employee. Save as a draft, or submit for approval in one step."
      />

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">Employee</label>
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="input mt-1.5">
            <option value="">Pick an employee…</option>
            {employees.map((e) => (<option key={e.id} value={e.id}>{e.fullName}</option>))}
          </select>
        </div>
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">Leave type</label>
          <select value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)} className="input mt-1.5">
            <option value="">Pick a type…</option>
            {leaveTypes.map((lt) => (
              <option key={lt.id} value={lt.id}>{lt.code} · {lt.name}{!lt.isPaid ? " (unpaid)" : ""}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">From</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="input mt-1.5" />
        </div>
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">To</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="input mt-1.5" />
        </div>
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">Days</label>
          <input type="number" step="0.5" min="0" value={daysCount} onChange={(e) => setDaysCount(e.target.value)} className="input mt-1.5 text-right tabular-nums" />
          <p className="mt-1 text-caption text-text-tertiary">Auto-filled from the date range — edit for half-days or working-day adjustments.</p>
        </div>
        {balance && (
          <div className="rounded-card border-hairline border-border bg-surface-recessed/40 p-4">
            <p className="text-caption uppercase tracking-wide text-text-tertiary">{balance.code} balance · {fromDate.slice(0, 4)}</p>
            <p className="mt-1 tabular-nums text-h3 text-charcoal">{balance.availableDays} days</p>
            <p className="mt-1 text-caption text-text-tertiary">
              Allocated {balance.allocatedDays}
              {balance.carriedForwardDays > 0 && <> · carried {balance.carriedForwardDays}</>}
              · used {balance.usedDays}
            </p>
            {Number(daysCount) > balance.availableDays && (
              <p className="mt-2 text-caption text-warning">
                Requested {Number(daysCount)} exceeds available — request will go through but balance will go negative if approved.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="mt-6">
        <label className="block text-caption uppercase tracking-wide text-text-tertiary">Reason</label>
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the leave is being taken — helps approvers decide" className="input mt-1.5" />
      </section>

      <section className="mt-6 flex items-center justify-between gap-4">
        <label className="flex items-center gap-2 text-small text-charcoal">
          <input type="checkbox" checked={submitAfterSave} onChange={(e) => setSubmitAfterSave(e.target.checked)} className="h-4 w-4 rounded border-border-emphasis" />
          Submit for approval now <span className="text-caption text-text-tertiary">(uncheck to save as draft)</span>
        </label>
        <div className="flex items-center gap-3">
          {error && <span className="text-small text-danger">{error}</span>}
          <button type="button" onClick={submit} disabled={busy} className="btn-primary disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {submitAfterSave ? "Save & submit" : "Save draft"}
          </button>
        </div>
      </section>
    </main>
  );
}
