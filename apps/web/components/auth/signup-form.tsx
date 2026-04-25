"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Field } from "./field";
import { PasswordStrengthHint } from "./password-strength-hint";

export function SignupForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Captures WEAK_PASSWORD details so the UI can bullet them out rather
  // than jam them into one line. Cleared on next submit. (#49)
  const [reasons, setReasons] = useState<string[] | null>(null);
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [ownerName, setOwnerName] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setReasons(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      const couponCodeRaw = String(form.get("couponCode") ?? "").trim();
      await api.signup({
        businessName: String(form.get("businessName") ?? "").trim(),
        ownerName: String(form.get("ownerName") ?? "").trim(),
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? ""),
        couponCode: couponCodeRaw.length > 0 ? couponCodeRaw : undefined,
      });
      router.push("/app");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "WEAK_PASSWORD") {
        setError(err.message || "Password doesn't meet policy.");
        setReasons(err.reasons && err.reasons.length > 0 ? err.reasons : null);
      } else {
        const msg =
          err instanceof ApiError
            ? err.code === "EMAIL_IN_USE"
              ? "An account with this email already exists. Try signing in."
              : err.code === "INVALID_INPUT"
                ? "Please check the fields and try again."
                : err.code === "RATE_LIMITED"
                  ? "Too many signup attempts from this network. Please wait a few minutes."
                  : err.code === "COUPON_NOT_FOUND" ||
                      err.code === "COUPON_EXPIRED" ||
                      err.code === "COUPON_INACTIVE" ||
                      err.code === "COUPON_ARCHIVED" ||
                      err.code === "COUPON_NOT_YET_VALID" ||
                      err.code === "COUPON_FULLY_REDEEMED" ||
                      err.code === "COUPON_INELIGIBLE_PLAN"
                    ? err.message ||
                      "That coupon code can't be applied. Try without it."
                    : err.message || "Something went wrong. Try again."
            : "Can't reach the server. Check your connection.";
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <Field
        label="Business name"
        name="businessName"
        autoComplete="organization"
        required
        minLength={2}
        placeholder="Perera Textiles"
      />
      <Field
        label="Your name"
        name="ownerName"
        autoComplete="name"
        required
        minLength={2}
        placeholder="Nimal Perera"
        value={ownerName}
        onChange={(e) => setOwnerName(e.target.value)}
      />
      <Field
        label="Work email"
        type="email"
        name="email"
        autoComplete="email"
        required
        placeholder="you@business.lk"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Field
        label="Password"
        type="password"
        name="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint="At least 10 characters · mix at least 3 of: lowercase, uppercase, digits, symbols"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <PasswordStrengthHint password={password} email={email} name={ownerName} />

      <Field
        label="Coupon code (optional)"
        name="couponCode"
        autoComplete="off"
        placeholder="AVURUDU2026"
        hint="Got a promo code? Enter it to apply a discount on your first invoice."
      />

      {error && (
        <div
          role="alert"
          className="rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-3 text-small text-danger"
        >
          <p>{error}</p>
          {reasons && reasons.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-small text-danger/90">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button type="submit" disabled={busy} className="btn-primary w-full text-body-lg">
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Creating your account…
          </>
        ) : (
          "Create account and start trial"
        )}
      </button>

      <p className="text-caption text-text-tertiary">
        By creating an account you agree to our Terms and Privacy Policy.
      </p>
    </form>
  );
}
