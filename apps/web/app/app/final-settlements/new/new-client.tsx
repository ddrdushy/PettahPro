"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import {
  api,
  ApiError,
  type FinalSettlementComputeResult,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { SettlementWorksheet } from "../worksheet";

/**
 * Preview + create flow. We compute fresh on the server (no persistence),
 * show the worksheet read-only with the computed lines, and let the user
 * save it as a draft. Edits happen after creation on the detail page —
 * the draft is the source of truth once it exists.
 */
export function NewSettlementClient({ employeeId }: { employeeId: string }) {
  const router = useRouter();
  const [compute, setCompute] = useState<FinalSettlementComputeResult | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .computeFinalSettlement(employeeId, {})
      .then(({ compute: result }) => {
        if (!cancelled) setCompute(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? computeErrorMessage(err)
              : "Couldn't compute the settlement preview.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  async function onSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const { settlement } = await api.createFinalSettlement(employeeId, {
        notes: notes.trim() || undefined,
      });
      router.push(`/app/final-settlements/${settlement.id}`);
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? err.message
          : "Couldn't create the settlement.",
      );
      setSaving(false);
    }
  }

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/final-settlements" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to final settlements
        </Link>
      </div>

      <PageHeader
        eyebrow="HR"
        title="New final settlement"
        description={
          compute
            ? `${compute.employeeFullName} · exited ${compute.exitDate}`
            : "Computing preview…"
        }
      />

      <div className="mt-6 space-y-6">
        {loading && (
          <div className="flex items-center gap-2 text-small text-text-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Computing…
          </div>
        )}

        {error && (
          <div
            className="rounded-card border-hairline border-danger/30 bg-danger-bg/40 p-4 text-small text-danger"
            role="alert"
          >
            {error}
          </div>
        )}

        {compute && (
          <>
            <SettlementWorksheet compute={compute} />

            <div className="rounded-card border-hairline border-border bg-surface-elevated p-4 space-y-3">
              <label className="block space-y-1">
                <span className="text-caption font-medium text-charcoal">
                  Notes
                </span>
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="input w-full"
                  placeholder="Optional — shown on the settlement letter and audit trail"
                />
              </label>
              {saveError && (
                <p className="text-caption text-danger" role="alert">
                  {saveError}
                </p>
              )}
              <div className="flex justify-end gap-2 border-t-hairline border-border pt-3">
                <Link
                  href="/app/final-settlements"
                  className="btn-link"
                >
                  Cancel
                </Link>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={saving}
                  className="btn-primary"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" aria-hidden />
                      Save as draft
                    </>
                  )}
                </button>
              </div>
              <p className="text-caption text-text-tertiary">
                Saved as a draft. You can edit amounts, approve, and post to the
                ledger on the next screen.
              </p>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function computeErrorMessage(err: ApiError): string {
  switch (err.code) {
    case "EMPLOYEE_NOT_FOUND":
      return "Employee not found.";
    case "NOT_EXITED":
      return "This employee hasn't been marked exited yet. Record the exit first.";
    case "NO_BASIC_SALARY":
      return "This employee has no basic salary on file.";
    case "SETTLEMENT_ALREADY_EXISTS":
      return "A settlement already exists for this employee. Open the existing one.";
    default:
      return err.message || "Couldn't compute the settlement preview.";
  }
}
