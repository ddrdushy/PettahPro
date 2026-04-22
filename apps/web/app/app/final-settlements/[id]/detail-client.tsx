"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Ban,
  CheckCircle2,
  FileText,
  Loader2,
  Pencil,
  Save,
  Send,
} from "lucide-react";
import {
  api,
  ApiError,
  type FinalSettlementComputeResult,
  type FinalSettlementPatch,
  type FinalSettlementRow,
  type FinalSettlementStatus,
} from "@/lib/api";
import { formatDate, formatLKR } from "@/lib/format";
import { SettlementWorksheet } from "../worksheet";

const statusTone: Record<FinalSettlementStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  approved: "bg-mint-surface text-mint-dark",
  posted: "bg-mint text-mint-dark",
  paid: "bg-mint text-mint-dark",
  cancelled: "bg-danger-bg/60 text-danger",
};

const statusLabel: Record<FinalSettlementStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  posted: "Posted",
  paid: "Paid",
  cancelled: "Cancelled",
};

/**
 * Coerce a persisted `FinalSettlementRow` into the `FinalSettlementComputeResult`
 * shape the worksheet expects. Saved rows carry the denormalised totals as
 * columns plus `linesSnapshot` for per-line breakdown.
 */
function rowToCompute(row: FinalSettlementRow): FinalSettlementComputeResult {
  return {
    employeeId: row.employeeId,
    employeeFullName: row.employeeFullName,
    employeeCode: row.employeeCode,
    designation: row.designation,
    department: row.department,
    hireDate: row.hireDate,
    exitDate: row.exitDate,
    lastWorkingDay: row.lastWorkingDay,
    statusAfter: row.statusAfter,
    basicSalaryCents: row.basicSalaryCents,
    currency: row.currency,
    yearsOfService: Number(row.yearsOfService),
    gratuityYearsCompleted: row.gratuityYearsCompleted,
    proRataSalaryCents: row.proRataSalaryCents,
    // Saved rows don't store the worked/period days separately — derive what
    // we can from the basic. Displayed as N/A when we can't reconstruct.
    proRataDaysWorked: 0,
    proRataDaysInPeriod: 0,
    leaveEncashmentDays: Number(row.leaveEncashmentDays),
    leaveEncashmentCents: row.leaveEncashmentCents,
    gratuityCents: row.gratuityCents,
    noticePayInLieuCents: row.noticePayInLieuCents,
    noticeShortfallCents: row.noticeShortfallCents,
    loanPrincipalRecoveryCents: row.loanPrincipalRecoveryCents,
    loanInterestRecoveryCents: row.loanInterestRecoveryCents,
    otherEarningsCents: row.otherEarningsCents,
    otherDeductionsCents: row.otherDeductionsCents,
    epfEmployeeCents: row.epfEmployeeCents,
    epfEmployerCents: row.epfEmployerCents,
    etfEmployerCents: row.etfEmployerCents,
    payeCents: row.payeCents,
    grossCents: row.grossCents,
    totalDeductionsCents: row.totalDeductionsCents,
    netPayableCents: row.netPayableCents,
    lines: row.linesSnapshot,
  };
}

export function SettlementDetailClient({
  settlement: initial,
}: {
  settlement: FinalSettlementRow;
}) {
  const router = useRouter();
  const [settlement, setSettlement] = useState<FinalSettlementRow>(initial);
  const [editing, setEditing] = useState(false);

  const compute = useMemo(() => rowToCompute(settlement), [settlement]);
  const isDraft = settlement.status === "draft";
  const isApproved = settlement.status === "approved";

  function onUpdated(next: FinalSettlementRow) {
    setSettlement(next);
    setEditing(false);
    router.refresh();
  }

  return (
    <div className="mt-6 space-y-6">
      {/* Status + workflow buttons */}
      <div className="flex flex-wrap items-center gap-3 rounded-card border-hairline border-border bg-surface-elevated p-4">
        <span
          className={`rounded-full px-3 py-1 text-small font-medium ${statusTone[settlement.status]}`}
        >
          {statusLabel[settlement.status]}
        </span>
        {settlement.approvedAt && (
          <span className="text-caption text-text-tertiary">
            Approved {formatDate(settlement.approvedAt)}
          </span>
        )}
        {settlement.postedAt && (
          <span className="text-caption text-text-tertiary">
            Posted {formatDate(settlement.postedAt)}
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {isDraft && (
            <>
              <EditToggle editing={editing} onToggle={setEditing} />
              <ApproveButton id={settlement.id} onDone={onUpdated} />
              <CancelButton id={settlement.id} onDone={onUpdated} />
            </>
          )}
          {isApproved && (
            <>
              <PostButton id={settlement.id} onDone={onUpdated} />
              <CancelButton id={settlement.id} onDone={onUpdated} />
            </>
          )}
          {settlement.status !== "cancelled" && (
            <a
              href={`/app/final-settlements/${settlement.id}/letter`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
            >
              <FileText className="h-4 w-4" aria-hidden />
              Settlement letter
            </a>
          )}
        </div>
      </div>

      {editing && isDraft ? (
        <OverridesEditor
          settlement={settlement}
          onSaved={(next) => {
            setSettlement(next);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <SettlementWorksheet compute={compute} />
      )}

      {settlement.notes && (
        <div className="rounded-card border-hairline border-border bg-surface-elevated p-4">
          <h3 className="text-caption font-semibold uppercase tracking-wider text-text-tertiary">
            Notes
          </h3>
          <p className="mt-1 whitespace-pre-wrap text-small text-charcoal">
            {settlement.notes}
          </p>
        </div>
      )}

      {settlement.cancelledReason && (
        <div className="rounded-card border-hairline border-danger/30 bg-danger-bg/40 p-4">
          <h3 className="text-caption font-semibold uppercase tracking-wider text-danger">
            Cancelled
          </h3>
          <p className="mt-1 text-small text-charcoal">
            {settlement.cancelledReason}
          </p>
        </div>
      )}
    </div>
  );
}

function EditToggle({
  editing,
  onToggle,
}: {
  editing: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!editing)}
      className="btn-secondary"
    >
      <Pencil className="h-4 w-4" aria-hidden />
      {editing ? "Cancel edits" : "Edit amounts"}
    </button>
  );
}

function ApproveButton({
  id,
  onDone,
}: {
  id: string;
  onDone: (next: FinalSettlementRow) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handle() {
    if (
      !confirm(
        "Approve this settlement? Amounts become locked — only posting or cancellation remain.",
      )
    )
      return;
    setBusy(true);
    try {
      const { settlement } = await api.approveFinalSettlement(id);
      onDone(settlement);
    } catch (err) {
      alert(
        err instanceof ApiError ? err.message : "Couldn't approve the settlement.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={handle} disabled={busy} className="btn-primary">
      {busy ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Approving…
        </>
      ) : (
        <>
          <CheckCircle2 className="h-4 w-4" aria-hidden /> Approve
        </>
      )}
    </button>
  );
}

function PostButton({
  id,
  onDone,
}: {
  id: string;
  onDone: (next: FinalSettlementRow) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handle() {
    if (
      !confirm(
        "Post this settlement to the ledger? A journal entry will be created and any open loans will be closed. This cannot be reversed — only cancelled in a follow-up entry.",
      )
    )
      return;
    setBusy(true);
    try {
      const { settlement } = await api.postFinalSettlement(id);
      onDone(settlement);
    } catch (err) {
      alert(
        err instanceof ApiError ? err.message : "Couldn't post the settlement.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={handle} disabled={busy} className="btn-primary">
      {busy ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Posting…
        </>
      ) : (
        <>
          <Send className="h-4 w-4" aria-hidden /> Post to ledger
        </>
      )}
    </button>
  );
}

function CancelButton({
  id,
  onDone,
}: {
  id: string;
  onDone: (next: FinalSettlementRow) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handle() {
    const reason = prompt(
      "Cancel this settlement? Optionally provide a reason for the audit trail.",
    );
    // `prompt` returns null if the user dismissed; empty string means confirmed
    // without reason. Only bail on dismissal.
    if (reason === null) return;
    setBusy(true);
    try {
      const { settlement } = await api.cancelFinalSettlement(id, {
        reason: reason.trim() || undefined,
      });
      onDone(settlement);
    } catch (err) {
      alert(
        err instanceof ApiError ? err.message : "Couldn't cancel the settlement.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={busy}
      className="inline-flex items-center gap-2 rounded-md border-hairline border-danger/30 bg-surface-elevated px-3 py-1.5 text-small font-medium text-danger hover:bg-danger-bg/40 disabled:opacity-50"
    >
      {busy ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cancelling…
        </>
      ) : (
        <>
          <Ban className="h-4 w-4" aria-hidden /> Cancel
        </>
      )}
    </button>
  );
}

/**
 * Edits the six overridable amounts on a draft. We PATCH cents values;
 * the server re-derives statutory (EPF/PAYE/ETF) and totals so the
 * worksheet stays self-consistent.
 */
function OverridesEditor({
  settlement,
  onSaved,
  onCancel,
}: {
  settlement: FinalSettlementRow;
  onSaved: (next: FinalSettlementRow) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    leaveEncashmentDays: Number(settlement.leaveEncashmentDays),
    leaveEncashmentCents: settlement.leaveEncashmentCents,
    gratuityCents: settlement.gratuityCents,
    noticePayInLieuCents: settlement.noticePayInLieuCents,
    noticeShortfallCents: settlement.noticeShortfallCents,
    otherEarningsCents: settlement.otherEarningsCents,
    otherDeductionsCents: settlement.otherDeductionsCents,
    notes: settlement.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const patch: FinalSettlementPatch = {
      leaveEncashmentDays: form.leaveEncashmentDays,
      leaveEncashmentCents: form.leaveEncashmentCents,
      gratuityCents: form.gratuityCents,
      noticePayInLieuCents: form.noticePayInLieuCents,
      noticeShortfallCents: form.noticeShortfallCents,
      otherEarningsCents: form.otherEarningsCents,
      otherDeductionsCents: form.otherDeductionsCents,
      notes: form.notes.trim() || undefined,
    };
    try {
      const { settlement: next } = await api.patchFinalSettlement(
        settlement.id,
        patch,
      );
      onSaved(next);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn't save the changes.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-card border-hairline border-border bg-surface-elevated p-4"
    >
      <div className="rounded-card border-hairline border-border bg-mint-surface/40 p-3 text-small text-text-secondary">
        Editing draft amounts. Statutory (EPF / PAYE / ETF) and totals are
        re-derived server-side from these values — you don't need to adjust them.
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <CentsInput
          label="Leave encashment days"
          unit="days"
          fractional
          value={form.leaveEncashmentDays}
          onChange={(v) => setForm((f) => ({ ...f, leaveEncashmentDays: v }))}
        />
        <CentsInput
          label="Leave encashment (LKR)"
          value={form.leaveEncashmentCents}
          onChange={(v) => setForm((f) => ({ ...f, leaveEncashmentCents: v }))}
          cents
        />
        <CentsInput
          label="Gratuity (LKR)"
          value={form.gratuityCents}
          onChange={(v) => setForm((f) => ({ ...f, gratuityCents: v }))}
          cents
        />
        <CentsInput
          label="Notice pay-in-lieu (LKR)"
          value={form.noticePayInLieuCents}
          onChange={(v) => setForm((f) => ({ ...f, noticePayInLieuCents: v }))}
          cents
        />
        <CentsInput
          label="Notice shortfall (LKR)"
          value={form.noticeShortfallCents}
          onChange={(v) => setForm((f) => ({ ...f, noticeShortfallCents: v }))}
          cents
        />
        <CentsInput
          label="Other earnings (LKR)"
          value={form.otherEarningsCents}
          onChange={(v) => setForm((f) => ({ ...f, otherEarningsCents: v }))}
          cents
        />
        <CentsInput
          label="Other deductions (LKR)"
          value={form.otherDeductionsCents}
          onChange={(v) => setForm((f) => ({ ...f, otherDeductionsCents: v }))}
          cents
        />
      </div>

      <label className="block space-y-1">
        <span className="text-caption font-medium text-charcoal">Notes</span>
        <textarea
          rows={2}
          maxLength={2000}
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          className="input w-full"
        />
      </label>

      {error && (
        <p className="text-caption text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 border-t-hairline border-border pt-3">
        <button type="button" onClick={onCancel} className="btn-link">
          Cancel
        </button>
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Saving…
            </>
          ) : (
            <>
              <Save className="h-4 w-4" aria-hidden /> Save changes
            </>
          )}
        </button>
      </div>

      <p className="text-caption text-text-tertiary">
        Current net payable: {formatLKR(settlement.netPayableCents)} · will be
        recalculated on save.
      </p>
    </form>
  );
}

function CentsInput({
  label,
  value,
  onChange,
  cents,
  fractional,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  cents?: boolean;
  fractional?: boolean;
  unit?: string;
}) {
  // Display as rupees for cents-typed fields; otherwise display raw.
  const displayValue = cents ? value / 100 : value;
  return (
    <label className="block space-y-1">
      <span className="text-caption font-medium text-charcoal">{label}</span>
      <div className="relative">
        <input
          type="number"
          step={fractional ? "0.01" : cents ? "0.01" : "1"}
          min={0}
          value={displayValue}
          onChange={(e) => {
            const n = Number(e.target.value || 0);
            onChange(cents ? Math.round(n * 100) : n);
          }}
          className="input w-full"
        />
        {unit && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-caption text-text-tertiary">
            {unit}
          </span>
        )}
      </div>
    </label>
  );
}
