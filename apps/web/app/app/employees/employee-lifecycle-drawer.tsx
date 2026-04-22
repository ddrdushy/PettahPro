"use client";

import { useState, type FormEvent } from "react";
import { Loader2, LogOut, CheckCircle2 } from "lucide-react";
import { Drawer } from "@/components/app/drawer";
import { api, ApiError, type EmployeeListRow } from "@/lib/api";
import { formatDate } from "@/lib/format";

/**
 * Employee lifecycle transitions — probation confirmation and exit.
 *
 * Per payroll-module-spec §14.1 / §14.2 / §14.3 these status changes
 * materially affect the next payroll run:
 *   · Confirming probation flips status → active (same payroll treatment,
 *     just removes the PROBATION badge on the payslip).
 *   · Recording an exit sets status → resigned/terminated/retired/deceased
 *     and stamps last_working_day. If the exit falls inside an open run
 *     period, the employee still appears in that run with a pro-rated
 *     basic (N of M days worked).
 *
 * Back-dated exits that would retroactively change a posted run are
 * blocked server-side — HR must void and recreate the run.
 */
export function EmployeeLifecycleDrawer({
  employee,
  onClose,
  onUpdated,
}: {
  employee: EmployeeListRow;
  onClose: () => void;
  onUpdated: (next: EmployeeListRow) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const isOnProbation = employee.status === "on_probation";
  const isExited = ["resigned", "terminated", "retired", "deceased"].includes(
    employee.status,
  );

  const [mode, setMode] = useState<"exit" | "confirm">(
    isOnProbation ? "confirm" : "exit",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Exit form state
  const [exitDate, setExitDate] = useState(today);
  const [lastWorkingDay, setLastWorkingDay] = useState("");
  const [noticePeriodDays, setNoticePeriodDays] = useState<number>(30);
  const [statusAfter, setStatusAfter] =
    useState<"resigned" | "terminated" | "retired" | "deceased">("resigned");
  const [reason, setReason] = useState("");

  // Confirm-probation form state
  const [confirmationDate, setConfirmationDate] = useState(today);
  const [confirmNotes, setConfirmNotes] = useState("");

  async function onExit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { employee: next } = await api.exitEmployee(employee.id, {
        exitDate,
        lastWorkingDay: lastWorkingDay.trim() || undefined,
        noticePeriodDays,
        statusAfter,
        reason: reason.trim() || undefined,
      });
      onUpdated({
        ...employee,
        status: next.status,
      });
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(exitErrorMessage(err));
      } else {
        setError("Couldn't record exit.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { employee: next } = await api.confirmProbation(employee.id, {
        confirmationDate,
        notes: confirmNotes.trim() || undefined,
      });
      onUpdated({
        ...employee,
        status: next.status,
      });
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(confirmErrorMessage(err));
      } else {
        setError("Couldn't confirm probation.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Lifecycle"
      description={`${employee.fullName} · hired ${formatDate(employee.hireDate)}`}
    >
      {isExited && (
        <div className="rounded-card border-hairline border-border bg-surface-recessed p-4 text-small text-text-secondary">
          This employee is already marked <strong className="text-charcoal capitalize">{employee.status}</strong>.
          Lifecycle changes are locked.
        </div>
      )}

      {!isExited && (
        <>
          {isOnProbation && (
            <div className="mb-4 flex gap-2 rounded-full bg-surface-recessed p-1 text-caption">
              <button
                type="button"
                onClick={() => setMode("confirm")}
                className={`flex-1 rounded-full px-3 py-1.5 font-medium ${
                  mode === "confirm"
                    ? "bg-surface-elevated text-charcoal shadow-sm"
                    : "text-text-secondary"
                }`}
              >
                Confirm probation
              </button>
              <button
                type="button"
                onClick={() => setMode("exit")}
                className={`flex-1 rounded-full px-3 py-1.5 font-medium ${
                  mode === "exit"
                    ? "bg-surface-elevated text-charcoal shadow-sm"
                    : "text-text-secondary"
                }`}
              >
                Record exit
              </button>
            </div>
          )}

          {mode === "confirm" && isOnProbation && (
            <form onSubmit={onConfirm} className="space-y-4">
              <div className="rounded-card border-hairline border-border bg-mint-surface/50 p-3 text-small text-text-secondary">
                Confirming promotes <strong className="text-charcoal">{employee.fullName}</strong> from{" "}
                <em>on probation</em> to <em>active</em>. No change to pay — this is a paper-trail entry.
              </div>
              <Field label="Confirmation date" required>
                <input
                  type="date"
                  required
                  value={confirmationDate}
                  min={employee.hireDate}
                  max={today}
                  onChange={(e) => setConfirmationDate(e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Notes" hint="Optional — shown in the audit trail.">
                <textarea
                  rows={2}
                  value={confirmNotes}
                  maxLength={500}
                  onChange={(e) => setConfirmNotes(e.target.value)}
                  className="input"
                  placeholder="e.g. Completed 3-month probation with distinction"
                />
              </Field>
              {error && (
                <p className="text-caption text-danger" role="alert">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2 border-t-hairline border-border pt-4">
                <button type="button" onClick={onClose} className="btn-link">
                  Cancel
                </button>
                <button type="submit" disabled={busy} className="btn-primary">
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      Confirming…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" aria-hidden />
                      Confirm probation
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {mode === "exit" && (
            <form onSubmit={onExit} className="space-y-4">
              <div className="rounded-card border-hairline border-border bg-warning-bg/40 p-3 text-small text-text-secondary">
                Recording an exit stops future payroll runs for this employee.
                If the exit date falls inside the <em>next</em> run, the employee
                still appears with pro-rated basic.
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Exit date" required>
                  <input
                    type="date"
                    required
                    value={exitDate}
                    min={employee.hireDate}
                    onChange={(e) => setExitDate(e.target.value)}
                    className="input"
                  />
                </Field>
                <Field
                  label="Status after exit"
                  required
                  hint="Determines the label on historical payslips."
                >
                  <select
                    value={statusAfter}
                    onChange={(e) => setStatusAfter(e.target.value as typeof statusAfter)}
                    className="input"
                  >
                    <option value="resigned">Resigned</option>
                    <option value="terminated">Terminated</option>
                    <option value="retired">Retired</option>
                    <option value="deceased">Deceased</option>
                  </select>
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Last working day"
                  hint="Leave blank if same as exit date (e.g. garden leave)."
                >
                  <input
                    type="date"
                    value={lastWorkingDay}
                    min={employee.hireDate}
                    max={exitDate}
                    onChange={(e) => setLastWorkingDay(e.target.value)}
                    className="input"
                  />
                </Field>
                <Field
                  label="Notice period (days)"
                  hint="Contractual. Surfaces in final-settlement computation later."
                >
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={noticePeriodDays}
                    onChange={(e) => setNoticePeriodDays(Number(e.target.value || 0))}
                    className="input"
                  />
                </Field>
              </div>
              <Field label="Reason" hint="Optional — stored in the audit trail.">
                <textarea
                  rows={2}
                  value={reason}
                  maxLength={1000}
                  onChange={(e) => setReason(e.target.value)}
                  className="input"
                  placeholder="e.g. Resigned to pursue graduate studies"
                />
              </Field>
              {error && (
                <p className="text-caption text-danger" role="alert">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2 border-t-hairline border-border pt-4">
                <button type="button" onClick={onClose} className="btn-link">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-md bg-danger px-4 py-2 text-small font-medium text-white hover:bg-danger/90 disabled:opacity-50"
                >
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      Recording…
                    </>
                  ) : (
                    <>
                      <LogOut className="h-4 w-4" aria-hidden />
                      Record exit
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </Drawer>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-caption font-medium text-charcoal">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      {children}
      {hint && <span className="block text-caption text-text-tertiary">{hint}</span>}
    </label>
  );
}

function exitErrorMessage(err: ApiError): string {
  switch (err.code) {
    case "ALREADY_EXITED":
      return "This employee is already marked exited.";
    case "BEFORE_HIRE":
      return "Exit date can't be before the hire date.";
    case "INVALID_DATES":
      return "Last working day must be on or before the exit date.";
    case "EMPLOYEE_NOT_FOUND":
      return "Employee not found.";
    default:
      return err.message || "Couldn't record exit.";
  }
}

function confirmErrorMessage(err: ApiError): string {
  switch (err.code) {
    case "NOT_ON_PROBATION":
      return "This employee is not currently on probation.";
    case "BEFORE_HIRE":
      return "Confirmation date can't be before the hire date.";
    case "EMPLOYEE_NOT_FOUND":
      return "Employee not found.";
    default:
      return err.message || "Couldn't confirm probation.";
  }
}
