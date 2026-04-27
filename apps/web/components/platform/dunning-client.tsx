"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";
import {
  PlatformApiError,
  platformApi,
  type DunningListPayload,
  type DunningSubscriptionRow,
} from "@/lib/platform-api";

interface DunningClientProps {
  initialPayload: DunningListPayload | null;
  canMutate: boolean;
}

type ActionKind = "retry" | "markPaid" | "suspend" | "pause" | "unpause";

interface ActionDialog {
  kind: ActionKind;
  row: DunningSubscriptionRow;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-LK", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function relativeFromNow(iso: string | null): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const day = 24 * 60 * 60 * 1000;
  const hour = 60 * 60 * 1000;
  if (abs < hour) return ms >= 0 ? "in <1h" : "<1h ago";
  if (abs < day) {
    const h = Math.round(abs / hour);
    return ms >= 0 ? `in ${h}h` : `${h}h ago`;
  }
  const d = Math.round(abs / day);
  return ms >= 0 ? `in ${d}d` : `${d}d ago`;
}

const STATUS_TONE: Record<string, string> = {
  past_due:
    "bg-rose-600/20 text-rose-200 border border-rose-500/40",
  active: "bg-amber-500/20 text-amber-200 border border-amber-500/40",
};

export function DunningClient({
  initialPayload,
  canMutate,
}: DunningClientProps) {
  const router = useRouter();
  const [payload, setPayload] = useState(initialPayload);
  const [dialog, setDialog] = useState<ActionDialog | null>(null);
  const [reason, setReason] = useState("");
  const [gatewayRef, setGatewayRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!payload) {
    return (
      <div className="mt-8 rounded-xl border border-white/10 bg-white/5 px-6 py-10 text-center text-small text-white/60">
        Couldn't load dunning data. Try refreshing the page.
      </div>
    );
  }

  const rows = payload.subscriptions;
  const counts = payload.counts;

  function openDialog(kind: ActionKind, row: DunningSubscriptionRow) {
    setDialog({ kind, row });
    setReason("");
    setGatewayRef("");
    setError(null);
  }

  function closeDialog() {
    setDialog(null);
    setReason("");
    setGatewayRef("");
    setError(null);
  }

  async function submitDialog() {
    if (!dialog) return;
    if (reason.trim().length < 3) {
      setError("Reason must be at least 3 characters.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const tenantId = dialog.row.tenantId;
        if (dialog.kind === "retry") {
          await platformApi.dunningRetryNow(tenantId, { reason });
        } else if (dialog.kind === "markPaid") {
          await platformApi.dunningMarkPaid(tenantId, {
            reason,
            gatewayReference: gatewayRef || undefined,
          });
        } else if (dialog.kind === "suspend") {
          await platformApi.dunningSuspendNow(tenantId, { reason });
        } else if (dialog.kind === "pause") {
          await platformApi.dunningPause(tenantId, {
            reason,
            paused: true,
          });
        } else if (dialog.kind === "unpause") {
          await platformApi.dunningPause(tenantId, {
            reason,
            paused: false,
          });
        }
        closeDialog();
        // Hard refresh to pull latest server state.
        router.refresh();
        try {
          const fresh = await platformApi.listDunning("all");
          setPayload(fresh);
        } catch {
          /* ignore — refresh covers it */
        }
      } catch (err) {
        if (err instanceof PlatformApiError) {
          setError(err.message);
        } else {
          setError("Action failed. Please try again.");
        }
      }
    });
  }

  return (
    <div className="mt-6 space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SummaryTile label="Past-due" value={counts.pastDue} tone="rose" />
        <SummaryTile
          label="Active with failures"
          value={counts.activeWithFailures}
          tone="amber"
        />
        <SummaryTile label="In view" value={rows.length} tone="neutral" />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-10 text-center text-small text-white/60">
          Nobody is in dunning right now. Charges are flowing through cleanly.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10">
          <table className="w-full table-fixed text-small text-white/80">
            <thead className="bg-white/5 text-caption uppercase tracking-wide text-white/50">
              <tr>
                <th className="w-[24%] px-4 py-3 text-left">Tenant</th>
                <th className="w-[12%] px-4 py-3 text-left">Plan</th>
                <th className="w-[10%] px-4 py-3 text-left">Status</th>
                <th className="w-[12%] px-4 py-3 text-left">Failed</th>
                <th className="w-[16%] px-4 py-3 text-left">Next attempt</th>
                <th className="w-[26%] px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.subscriptionId}
                  className="border-t border-white/5 hover:bg-white/[0.03]"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/platform/tenants/${row.tenantId}`}
                      className="font-medium text-white hover:underline"
                    >
                      {row.tenantName}
                    </Link>
                    <div className="text-caption text-white/40">
                      {row.tenantSlug}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-white/90">{row.planName}</div>
                    <div className="text-caption text-white/40">
                      {row.billingCycle}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-caption ${
                        STATUS_TONE[row.status] ??
                        "bg-white/10 text-white/70 border border-white/20"
                      }`}
                    >
                      {row.status}
                    </span>
                    {row.policy.isPaused && (
                      <div className="mt-1 inline-flex rounded-full border border-blue-400/40 bg-blue-500/20 px-2 py-0.5 text-caption text-blue-200">
                        Paused
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-white">
                      {row.consecutiveFailedAttempts}
                    </span>
                    <span className="text-white/40">
                      {" "}
                      / {row.policy.suspendAfterAttempts}
                    </span>
                    {row.lastAttempt?.failureReason && (
                      <div
                        className="mt-1 truncate text-caption text-white/40"
                        title={row.lastAttempt.failureReason}
                      >
                        {row.lastAttempt.failureReason}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {row.nextChargeAttemptAt ? (
                      <>
                        <div className="text-white/80">
                          {formatDate(row.nextChargeAttemptAt)}
                        </div>
                        <div className="text-caption text-white/40">
                          {relativeFromNow(row.nextChargeAttemptAt)}
                        </div>
                      </>
                    ) : (
                      <span className="text-white/40">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canMutate ? (
                      <div className="inline-flex flex-wrap justify-end gap-1">
                        <ActionButton
                          onClick={() => openDialog("retry", row)}
                          tone="neutral"
                        >
                          Retry now
                        </ActionButton>
                        <ActionButton
                          onClick={() => openDialog("markPaid", row)}
                          tone="mint"
                        >
                          Mark paid
                        </ActionButton>
                        <ActionButton
                          onClick={() => openDialog("suspend", row)}
                          tone="rose"
                        >
                          Suspend
                        </ActionButton>
                        <ActionButton
                          onClick={() =>
                            openDialog(
                              row.policy.isPaused ? "unpause" : "pause",
                              row,
                            )
                          }
                          tone="blue"
                        >
                          {row.policy.isPaused ? "Resume policy" : "Pause policy"}
                        </ActionButton>
                      </div>
                    ) : (
                      <span className="text-caption text-white/30">
                        read-only
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog && (
        <ActionDialog
          dialog={dialog}
          reason={reason}
          setReason={setReason}
          gatewayRef={gatewayRef}
          setGatewayRef={setGatewayRef}
          error={error}
          pending={pending}
          onCancel={closeDialog}
          onSubmit={submitDialog}
        />
      )}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "rose" | "amber" | "neutral";
}) {
  const toneClass =
    tone === "rose"
      ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
      : tone === "amber"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
      : "border-white/10 bg-white/5 text-white/80";
  return (
    <div className={`rounded-xl border px-4 py-3 ${toneClass}`}>
      <div className="text-caption uppercase tracking-wide opacity-70">
        {label}
      </div>
      <div className="mt-1 text-h2 font-semibold">{value}</div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone: "neutral" | "mint" | "rose" | "blue";
}) {
  const toneClass =
    tone === "mint"
      ? "border-mint/40 text-mint hover:bg-mint/10"
      : tone === "rose"
      ? "border-rose-500/40 text-rose-200 hover:bg-rose-500/10"
      : tone === "blue"
      ? "border-blue-400/40 text-blue-200 hover:bg-blue-500/10"
      : "border-white/20 text-white/70 hover:bg-white/5";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2 py-1 text-caption transition-colors ${toneClass}`}
    >
      {children}
    </button>
  );
}

function ActionDialog({
  dialog,
  reason,
  setReason,
  gatewayRef,
  setGatewayRef,
  error,
  pending,
  onCancel,
  onSubmit,
}: {
  dialog: ActionDialog;
  reason: string;
  setReason: (v: string) => void;
  gatewayRef: string;
  setGatewayRef: (v: string) => void;
  error: string | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const titles: Record<ActionKind, string> = {
    retry: "Schedule immediate retry",
    markPaid: "Mark paid out-of-band",
    suspend: "Suspend subscription now",
    pause: "Pause dunning for this policy",
    unpause: "Resume dunning for this policy",
  };
  const blurbs: Record<ActionKind, string> = {
    retry:
      "Sets next-charge-attempt-at to now. Counter is unchanged. The dunning cron picks it up on its next tick.",
    markPaid:
      "Records a successful charge without calling the gateway. Use when the customer paid out-of-band (transfer, cheque cleared). Resets the failure counter and rolls the period forward.",
    suspend:
      "Skips remaining retries and cancels the subscription immediately. The customer's services stop at the next request.",
    pause:
      "Pauses dunning for the subscription's effective policy. Cron records 'skipped' attempts; counter is preserved. Use during disputes.",
    unpause:
      "Resumes dunning. Retries continue from the existing counter. Use after a dispute is resolved.",
  };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-charcoal p-5">
        <h3 className="text-h3 text-white">{titles[dialog.kind]}</h3>
        <p className="mt-1 text-small text-white/60">
          For <span className="text-white">{dialog.row.tenantName}</span>{" "}
          ({dialog.row.planName})
        </p>
        <p className="mt-3 text-small text-white/70">{blurbs[dialog.kind]}</p>

        <label className="mt-4 block text-caption uppercase tracking-wide text-white/50">
          Reason (audit-logged)
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={500}
          className="mt-1 w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-small text-white placeholder-white/30 focus:border-mint focus:outline-none"
          placeholder="e.g. customer paid by bank transfer ref TXN-12345"
        />

        {dialog.kind === "markPaid" && (
          <>
            <label className="mt-3 block text-caption uppercase tracking-wide text-white/50">
              Gateway reference (optional)
            </label>
            <input
              type="text"
              value={gatewayRef}
              onChange={(e) => setGatewayRef(e.target.value)}
              maxLength={200}
              className="mt-1 w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-small text-white placeholder-white/30 focus:border-mint focus:outline-none"
              placeholder="e.g. bank transaction ID"
            />
          </>
        )}

        {error && (
          <p className="mt-3 text-small text-rose-300">{error}</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-white/15 px-3 py-1.5 text-small text-white/80 hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={pending}
            className="rounded-md bg-mint px-3 py-1.5 text-small font-medium text-charcoal hover:bg-mint/90 disabled:opacity-60"
          >
            {pending ? "Working..." : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
