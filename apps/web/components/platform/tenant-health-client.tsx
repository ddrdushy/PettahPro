"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  PlatformApiError,
  platformApi,
  type TenantHealthRow,
} from "@/lib/platform-api";

interface HealthPayload {
  tenants: TenantHealthRow[];
  byRisk: {
    low: number;
    medium: number;
    high: number;
    critical: number;
    not_scored: number;
  };
}

const RISK_COPY = {
  low: { label: "Low", tone: "bg-mint/20 text-mint border border-mint/40" },
  medium: {
    label: "Medium",
    tone: "bg-amber-500/20 text-amber-200 border border-amber-500/40",
  },
  high: {
    label: "High",
    tone: "bg-orange-500/20 text-orange-200 border border-orange-500/40",
  },
  critical: {
    label: "Critical",
    tone: "bg-rose-600/30 text-rose-200 border border-rose-500/40",
  },
} as const;

function formatDate(iso: string | null): string {
  if (!iso) return "Not scored yet";
  try {
    return new Date(iso).toLocaleDateString("en-LK", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function TenantHealthClient({
  initialPayload,
  canRunSweep,
}: {
  initialPayload: HealthPayload | null;
  canRunSweep: boolean;
}) {
  const router = useRouter();
  const [payload, setPayload] = useState(initialPayload);
  const [filter, setFilter] = useState<
    "all" | "low" | "medium" | "high" | "critical"
  >("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSweep, setLastSweep] = useState<string | null>(null);

  function refresh() {
    router.refresh();
    platformApi
      .listTenantHealth({ limit: 200 })
      .then((r) => setPayload(r))
      .catch(() => {});
  }

  async function onRunSweep() {
    setBusy(true);
    setError(null);
    try {
      const { result } = await platformApi.runTenantHealth();
      setLastSweep(
        `${result.tenantsScored} scored — ${result.byRisk.critical} critical, ${result.byRisk.high} high, ${result.byRisk.medium} medium, ${result.byRisk.low} low`,
      );
      refresh();
    } catch (err) {
      setError(
        err instanceof PlatformApiError
          ? err.message || "Sweep failed."
          : "Could not reach the API.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!payload) {
    return (
      <p className="mt-10 rounded-md border border-red-500/30 bg-red-500/10 p-4 text-small text-red-200">
        Couldn't load tenant health. The cron may not have run yet — try
        the manual sweep below.
      </p>
    );
  }

  const filtered =
    filter === "all"
      ? payload.tenants
      : payload.tenants.filter((t) => t.riskLevel === filter);

  return (
    <>
      {/* Risk-summary row */}
      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-5">
        {(["critical", "high", "medium", "low"] as const).map((risk) => (
          <button
            key={risk}
            type="button"
            onClick={() => setFilter(risk)}
            className={`rounded-card border p-5 text-left transition ${
              filter === risk
                ? "border-mint/60 bg-mint/10"
                : "border-white/10 bg-black/20 hover:bg-black/30"
            }`}
          >
            <div className="text-caption uppercase tracking-wide text-white/50">
              {RISK_COPY[risk].label} risk
            </div>
            <div className="mt-2 text-h1 text-white">
              {payload.byRisk[risk]}
            </div>
            <div className="mt-1 text-caption text-white/40">
              tenant{payload.byRisk[risk] === 1 ? "" : "s"}
            </div>
          </button>
        ))}
        <div className="rounded-card border border-white/10 bg-black/20 p-5">
          <div className="text-caption uppercase tracking-wide text-white/50">
            Not scored yet
          </div>
          <div className="mt-2 text-h1 text-white/60">
            {payload.byRisk.not_scored}
          </div>
          <div className="mt-1 text-caption text-white/40">
            fresh signups before next cron tick
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`rounded-md border px-3 py-1.5 text-small ${
              filter === "all"
                ? "border-mint/40 bg-mint/10 text-mint"
                : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
            }`}
          >
            All ({payload.tenants.length})
          </button>
          {(["critical", "high", "medium", "low"] as const).map((risk) => (
            <button
              key={risk}
              type="button"
              onClick={() => setFilter(risk)}
              className={`rounded-md border px-3 py-1.5 text-small ${
                filter === risk
                  ? "border-mint/40 bg-mint/10 text-mint"
                  : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
              }`}
            >
              {RISK_COPY[risk].label} ({payload.byRisk[risk]})
            </button>
          ))}
        </div>
        {canRunSweep && (
          <button
            type="button"
            onClick={onRunSweep}
            disabled={busy}
            className="rounded-md border border-mint/40 bg-mint/10 px-4 py-2 text-small text-mint hover:bg-mint/20 disabled:opacity-50"
          >
            {busy ? "Recomputing…" : "Run sweep now"}
          </button>
        )}
      </div>

      {lastSweep && (
        <div className="mt-4 rounded-md border border-mint/40 bg-mint/10 p-3 text-small text-mint">
          {lastSweep}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-small text-red-200">
          {error}
        </div>
      )}

      {/* Tenant table */}
      <div className="mt-6 overflow-hidden rounded-card border border-white/10 bg-black/20">
        <table className="w-full text-small">
          <thead className="bg-white/5 text-caption uppercase tracking-wide text-white/50">
            <tr>
              <th className="px-4 py-2 text-left">Tenant</th>
              <th className="px-4 py-2 text-center">Score</th>
              <th className="px-4 py-2 text-left">Risk</th>
              <th className="px-4 py-2 text-left">Why</th>
              <th className="px-4 py-2 text-right">Last calc</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-caption text-white/50"
                >
                  No tenants match this filter.
                </td>
              </tr>
            ) : (
              filtered.map((t) => (
                <tr key={t.tenantId}>
                  <td className="px-4 py-3 text-white">
                    <div>{t.tenantName}</div>
                    <div className="text-caption text-white/40 font-mono">
                      {t.tenantSlug}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center text-h3 text-white">
                    {t.score == null ? "—" : t.score}
                    {t.score != null && (
                      <div className="mt-1 flex justify-center gap-1 text-caption text-white/40">
                        <span title="Login">{t.loginScore}</span>·
                        <span title="Transactions">{t.transactionScore}</span>·
                        <span title="Subscription">{t.subscriptionScore}</span>·
                        <span title="Setup">{t.setupScore}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {t.riskLevel ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-caption ${
                          RISK_COPY[t.riskLevel].tone
                        }`}
                      >
                        {RISK_COPY[t.riskLevel].label}
                      </span>
                    ) : (
                      <span className="text-caption text-white/40">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {t.reasons.length === 0 ? (
                        <span className="text-caption text-white/40">
                          {t.score != null ? "Healthy" : "Awaiting first sweep"}
                        </span>
                      ) : (
                        t.reasons.map((r) => (
                          <span
                            key={r}
                            className="rounded-full bg-white/5 border border-white/10 px-2 py-0.5 text-caption text-white/70"
                          >
                            {r}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-caption text-white/40">
                    {formatDate(t.calculatedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-caption text-white/40">
        Score = login (25) + transactions (25) + subscription (25) + setup (25).
        Sub-scores in the Score column are read left → right in that order.
      </p>
    </>
  );
}
