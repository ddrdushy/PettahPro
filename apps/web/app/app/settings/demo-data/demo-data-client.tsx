"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, Trash2, CheckCircle2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";

// #136 / gaps I1 — demo data load/clear control. Two buttons that
// flip based on whether seed data already exists. We refresh the
// router on success so the surrounding layout (sidebar item counts,
// etc.) re-fetches.

export function DemoDataClient({
  initialSeededCount,
}: {
  initialSeededCount: number;
}) {
  const router = useRouter();
  const [seededCount, setSeededCount] = useState(initialSeededCount);
  const [busy, setBusy] = useState<"load" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function onLoad() {
    setBusy("load");
    setError(null);
    setMessage(null);
    try {
      const { inserted } = await api.loadDemoData();
      if (inserted === 0) {
        setMessage("Demo data is already loaded.");
      } else {
        setMessage(`Loaded ${inserted} demo records.`);
      }
      const { seededRecordCount } = await api.getDemoData();
      setSeededCount(seededRecordCount);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError && err.message
          ? err.message
          : "Couldn't load demo data. Try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function onClear() {
    if (!confirm("Remove all demo records? Real data you've entered will be left alone.")) {
      return;
    }
    setBusy("clear");
    setError(null);
    setMessage(null);
    try {
      const { deleted } = await api.clearDemoData();
      setMessage(`Removed ${deleted} demo records.`);
      setSeededCount(0);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError && err.message
          ? err.message
          : "Couldn't clear demo data. Try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  const hasSeeds = seededCount > 0;

  return (
    <div className="space-y-5">
      <div className="rounded-md border-hairline border-border bg-surface-recessed/30 p-4">
        <p className="text-small font-medium text-charcoal">
          {hasSeeds
            ? `${seededCount} demo records currently in your tenant.`
            : "No demo data loaded."}
        </p>
        <p className="mt-1 text-caption text-text-secondary">
          What gets created: 5 customers, 4 suppliers, 8 items, 6 invoices (mix
          of paid / partially paid / overdue), 4 bills, and 3 customer payments.
          Dates spread across the past 60 days so dashboards and aging reports
          have something to chart.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-3 text-small text-danger"
        >
          {error}
        </div>
      )}

      {message && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border-hairline border-mint/40 bg-mint-surface/60 p-3 text-small text-mint-dark"
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          {message}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onLoad}
          disabled={busy !== null || hasSeeds}
          className="btn-primary text-body"
        >
          {busy === "load" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" aria-hidden /> Load demo data
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={busy !== null || !hasSeeds}
          className="inline-flex items-center gap-2 rounded-md border-hairline border-border bg-surface-elevated px-4 py-2 text-body text-charcoal hover:bg-surface-recessed/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === "clear" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Clearing…
            </>
          ) : (
            <>
              <Trash2 className="h-4 w-4" aria-hidden /> Clear demo data
            </>
          )}
        </button>
      </div>

      <p className="text-caption text-text-tertiary">
        Tip: if you've edited a demo record (changed a customer name, deleted a
        line, etc.) it stays — only records that are still tracked as demo data
        are removed by Clear.
      </p>
    </div>
  );
}
