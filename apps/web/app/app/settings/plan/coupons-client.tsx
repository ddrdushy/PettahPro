"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ApiError,
  api,
  type CouponPreview,
  type TenantCouponRedemption,
} from "@/lib/api";

// Tenant-side coupon redemption (#121). Single input + lookup + apply.
// The discount itself isn't applied to anything until real billing
// lands (SUBSCRIPTION_PAYMENT_STUB) — but the redemption is recorded
// and shown so the user knows their code worked.

function formatDiscount(c: { discountType: string; discountValue: number }) {
  if (c.discountType === "percent_off") {
    const pct = c.discountValue / 100;
    return `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(2)}% off`;
  }
  return `LKR ${(c.discountValue / 100).toLocaleString("en-LK")} off`;
}

function formatDuration(c: {
  appliesFor: string;
  appliesForMonths: number | null;
}): string {
  if (c.appliesFor === "once") return "first invoice only";
  if (c.appliesFor === "forever") return "every cycle";
  if (c.appliesFor === "months") return `${c.appliesForMonths} months`;
  return c.appliesFor;
}

function formatDate(s: string): string {
  try {
    return new Date(s).toLocaleDateString("en-LK", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return s;
  }
}

export function CouponsClient({
  initialRedemptions,
}: {
  initialRedemptions: TenantCouponRedemption[];
}) {
  const router = useRouter();
  const [redemptions, setRedemptions] = useState(initialRedemptions);
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<CouponPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  function refresh() {
    router.refresh();
    api
      .listMyCouponRedemptions()
      .then((r) => setRedemptions(r.redemptions))
      .catch(() => {});
  }

  async function onLookup() {
    const trimmed = code.trim();
    if (!trimmed) {
      setError("Enter a coupon code first.");
      return;
    }
    setBusy(true);
    setError(null);
    setPreview(null);
    setSuccess(null);
    try {
      const r = await api.lookupCoupon(trimmed);
      setPreview(r.coupon);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message || "Coupon not found."
          : "Network error.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onRedeem() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.redeemCoupon(preview.code);
      setSuccess(`Coupon ${preview.code} applied. Discount will appear on your next invoice.`);
      setPreview(null);
      setCode("");
      refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message || "Redemption failed."
          : "Network error.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-12 border-t border-border-subtle pt-10">
      <h2 className="text-h2 text-text-primary">Coupons</h2>
      <p className="mt-1 text-body text-text-secondary">
        Got a promo code? Enter it here to apply a discount on your next bill.
      </p>

      <div className="mt-4 flex gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="AVURUDU2026"
          className="flex-1 max-w-sm rounded-md border border-border-subtle bg-surface px-3 py-2 text-body text-text-primary uppercase placeholder:text-text-secondary"
          onKeyDown={(e) => {
            if (e.key === "Enter") onLookup();
          }}
        />
        <button
          type="button"
          onClick={onLookup}
          disabled={busy || code.trim().length === 0}
          className="btn-secondary text-small disabled:opacity-50"
        >
          {busy ? "Checking…" : "Check code"}
        </button>
      </div>

      {error && (
        <div className="mt-3 max-w-2xl rounded-md border border-red-500/30 bg-red-500/5 p-3 text-small text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="mt-3 max-w-2xl rounded-md border border-mint/30 bg-mint-surface p-3 text-small text-text-primary">
          {success}
        </div>
      )}

      {preview && (
        <div className="mt-4 max-w-2xl rounded-card border border-mint/30 bg-mint-surface/40 p-4">
          <p className="text-body text-text-primary font-medium">
            {preview.name}
          </p>
          <p className="mt-1 text-small text-text-secondary">
            {formatDiscount(preview)} · {formatDuration(preview)}
          </p>
          <button
            type="button"
            onClick={onRedeem}
            disabled={busy}
            className="btn-primary mt-3 text-small disabled:opacity-50"
          >
            {busy ? "Applying…" : "Apply this coupon"}
          </button>
        </div>
      )}

      {redemptions.length > 0 && (
        <div className="mt-8">
          <h3 className="text-h3 text-text-primary">Your redemptions</h3>
          <div className="mt-3 space-y-2">
            {redemptions.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-card border border-border-subtle bg-surface p-3"
              >
                <div>
                  <p className="text-body text-text-primary font-medium">
                    <span className="font-mono">{r.couponCode}</span>
                    <span className="ml-2 text-text-secondary font-normal">
                      {r.couponName}
                    </span>
                  </p>
                  <p className="mt-1 text-caption text-text-secondary">
                    {formatDiscount(r)} · {formatDuration(r)} · redeemed{" "}
                    {formatDate(r.redeemedAt)}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-caption ${
                    r.status === "active"
                      ? "bg-mint-surface text-text-primary"
                      : r.status === "consumed"
                        ? "bg-surface-2 text-text-secondary"
                        : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
