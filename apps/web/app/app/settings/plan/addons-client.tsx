"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, api, type ActiveAddon, type AvailableAddon } from "@/lib/api";

// Tenant-side add-on picker (#120). Shows what's active + what's
// available. Self-serve purchase + cancel routes are gated server-side
// on SUBSCRIPTION_PAYMENT_STUB=1; if it's not set, the API returns
// PAYMENT_PROVIDER_UNAVAILABLE and we surface the same "contact support"
// message as the plan picker.

function formatMoney(cents: number, currency = "LKR"): string {
  return `${currency} ${(cents / 100).toLocaleString("en-LK", {
    maximumFractionDigits: currency === "LKR" ? 0 : 2,
  })}`;
}

function formatDate(s: string | null): string | null {
  if (!s) return null;
  try {
    return new Date(s).toLocaleDateString("en-LK", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return null;
  }
}

export function AddonsClient({
  initialCatalog,
  initialActive,
  currentPlanCode,
}: {
  initialCatalog: AvailableAddon[];
  initialActive: ActiveAddon[];
  currentPlanCode: string;
}) {
  const router = useRouter();
  const [catalog, setCatalog] = useState(initialCatalog);
  const [active, setActive] = useState(initialActive);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function refresh() {
    router.refresh();
    api
      .listMyAddons()
      .then((r) => {
        setCatalog(r.catalog);
        setActive(r.active);
      })
      .catch(() => {});
  }

  async function onPurchase(addon: AvailableAddon) {
    if (
      !confirm(
        `Activate ${addon.name} for ${formatMoney(addon.monthlyPriceCents)}/mo? You'll start using the new features immediately.`,
      )
    ) {
      return;
    }
    setBusy(addon.code);
    setError(null);
    try {
      await api.purchaseAddon({ addonCode: addon.code });
      refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message || "Purchase failed."
          : "Network error.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function onCancel(tenantAddon: ActiveAddon) {
    if (
      !confirm(
        `Cancel ${tenantAddon.addon.name}? You'll keep the features through the end of this billing period (${formatDate(tenantAddon.currentPeriodEnd)}), then they turn off.`,
      )
    ) {
      return;
    }
    setBusy(tenantAddon.id);
    setError(null);
    try {
      await api.cancelAddon(tenantAddon.id);
      refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message || "Cancellation failed."
          : "Network error.",
      );
    } finally {
      setBusy(null);
    }
  }

  // Filter catalog: hide addons the tenant already has active and
  // ones whose eligibility excludes the current plan.
  const activeAddonCodes = new Set(active.filter((a) => a.status !== "cancelled").map((a) => a.addon.code));
  const eligible = catalog.filter((a) => {
    if (activeAddonCodes.has(a.code)) return false;
    if (a.eligiblePlanCodes.length === 0) return true;
    return a.eligiblePlanCodes.includes(currentPlanCode);
  });

  return (
    <section className="mt-12 border-t border-border-subtle pt-10">
      <h2 className="text-h2 text-text-primary">Add-ons</h2>
      <p className="mt-1 text-body text-text-secondary">
        Buy individual features without changing your plan. Auto-removed if you
        upgrade to a tier that already includes them.
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-small text-red-700">
          {error}
        </div>
      )}

      {/* Active addons */}
      {active.length > 0 && (
        <div className="mt-6">
          <h3 className="text-h3 text-text-primary">Active</h3>
          <div className="mt-3 space-y-3">
            {active.map((ta) => (
              <div
                key={ta.id}
                className="flex items-center justify-between rounded-card border border-border-subtle bg-surface p-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-body text-text-primary font-medium">
                      {ta.addon.name}
                    </p>
                    {ta.status === "pending_removal" && (
                      <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-caption">
                        Ending {formatDate(ta.currentPeriodEnd)}
                      </span>
                    )}
                    {ta.status === "cancelled" && ta.autoRemovedAt && (
                      <span className="rounded-full bg-mint-surface text-text-primary px-2 py-0.5 text-caption">
                        Auto-removed (now in plan)
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-small text-text-secondary">
                    {formatMoney(ta.addon.monthlyPriceCents)} / mo · grants{" "}
                    {ta.addon.grantsFeatures.join(", ")}
                  </p>
                </div>
                {ta.status === "active" && (
                  <button
                    type="button"
                    onClick={() => onCancel(ta)}
                    disabled={busy === ta.id}
                    className="btn-secondary text-small disabled:opacity-50"
                  >
                    {busy === ta.id ? "Cancelling…" : "Cancel"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Available addons */}
      {eligible.length > 0 && (
        <div className="mt-8">
          <h3 className="text-h3 text-text-primary">Available</h3>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            {eligible.map((a) => (
              <div
                key={a.id}
                className="flex flex-col rounded-card border border-border-subtle bg-surface p-5"
              >
                <p className="text-body text-text-primary font-medium">{a.name}</p>
                <p className="mt-1 text-small text-text-secondary line-clamp-2">
                  {a.tagline}
                </p>
                <div className="mt-3 text-h3 text-text-primary">
                  {formatMoney(a.monthlyPriceCents)}
                  <span className="ml-1 text-caption text-text-secondary">
                    / mo
                  </span>
                </div>
                <div className="mt-2 text-caption text-text-secondary">
                  Grants: {a.grantsFeatures.join(", ")}
                </div>
                <button
                  type="button"
                  onClick={() => onPurchase(a)}
                  disabled={busy === a.code}
                  className="btn-primary mt-4 text-small disabled:opacity-50"
                >
                  {busy === a.code ? "Activating…" : "Activate"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {active.length === 0 && eligible.length === 0 && (
        <p className="mt-6 text-body text-text-secondary">
          No add-ons available for your plan. {currentPlanCode === "scale" && "Scale already includes everything."}
        </p>
      )}
    </section>
  );
}
