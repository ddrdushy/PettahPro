"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Pause, Play, Zap } from "lucide-react";
import { api, ApiError } from "@/lib/api";

export function RecurringJournalActions({
  id,
  isActive,
  autoPost,
}: {
  id: string;
  isActive: boolean;
  autoPost: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<unknown>) {
    setError(null);
    setBusy(label);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={busy !== null}
        onClick={() =>
          run("gen", async () => {
            const res = await api.generateRecurringJournalNow(id);
            if (res.entryId) {
              router.push(`/app/journals/${res.entryId}`);
            } else if (res.draftId) {
              router.push(`/app/journals/approvals`);
            }
          })
        }
        className="btn-ghost inline-flex items-center gap-1 px-2 py-1 text-caption disabled:opacity-50"
        title={
          autoPost
            ? "Generate and post a journal entry now"
            : "Generate now — drops into the approval queue"
        }
      >
        {busy === "gen" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
        Generate now
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() =>
          run(
            "toggle",
            isActive ? () => api.pauseRecurringJournal(id) : () => api.resumeRecurringJournal(id),
          )
        }
        className="btn-ghost inline-flex items-center gap-1 px-2 py-1 text-caption disabled:opacity-50"
      >
        {busy === "toggle" ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : isActive ? (
          <Pause className="h-3 w-3" />
        ) : (
          <Play className="h-3 w-3" />
        )}
        {isActive ? "Pause" : "Resume"}
      </button>
      {error && <span className="ml-2 text-caption text-danger">{error}</span>}
    </div>
  );
}
