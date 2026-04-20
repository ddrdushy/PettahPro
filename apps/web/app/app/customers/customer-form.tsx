"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Field } from "@/components/auth/field";
import { api, ApiError, type Customer } from "@/lib/api";

export function CustomerForm({ onCreated }: { onCreated: (c: Customer) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);

    const creditLKR = Number(f.get("creditLimit") ?? 0);
    const paymentTerms = Number(f.get("paymentTermsDays") ?? 0);

    try {
      const { customer } = await api.createCustomer({
        name: String(f.get("name") ?? "").trim(),
        legalName: String(f.get("legalName") ?? "").trim(),
        code: String(f.get("code") ?? "").trim(),
        email: String(f.get("email") ?? "").trim(),
        phone: String(f.get("phone") ?? "").trim(),
        whatsapp: String(f.get("whatsapp") ?? "").trim(),
        city: String(f.get("city") ?? "").trim(),
        tin: String(f.get("tin") ?? "").trim(),
        vatNo: String(f.get("vatNo") ?? "").trim(),
        brNo: String(f.get("brNo") ?? "").trim(),
        paymentTermsDays: Number.isFinite(paymentTerms) ? paymentTerms : 0,
        creditLimitCents: Number.isFinite(creditLKR) ? Math.round(creditLKR * 100) : 0,
      });
      onCreated(customer);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.code === "DUPLICATE_CODE"
            ? "A customer with this code already exists."
            : err.message
          : "Couldn't create the customer. Try again.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <section className="space-y-4">
        <SectionTitle>Identity</SectionTitle>
        <Field label="Business name" name="name" required placeholder="Fathima Importers" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Short code" name="code" placeholder="e.g. FATHIMA" />
          <Field label="Legal name" name="legalName" placeholder="(if different)" />
        </div>
      </section>

      <section className="space-y-4">
        <SectionTitle>Contact</SectionTitle>
        <Field label="Email" type="email" name="email" placeholder="ops@fathima.lk" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Phone" name="phone" placeholder="+94 77 123 4567" />
          <Field label="WhatsApp" name="whatsapp" placeholder="+94 77 123 4567" />
        </div>
        <Field label="City" name="city" placeholder="Colombo" />
      </section>

      <section className="space-y-4">
        <SectionTitle>Commercial</SectionTitle>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Payment terms (days)"
            name="paymentTermsDays"
            type="number"
            min={0}
            max={365}
            defaultValue={0}
            hint="0 = immediate"
          />
          <Field
            label="Credit limit (LKR)"
            name="creditLimit"
            type="number"
            min={0}
            step="1000"
            defaultValue={0}
          />
        </div>
      </section>

      <section className="space-y-4">
        <SectionTitle>SL identifiers</SectionTitle>
        <div className="grid grid-cols-3 gap-4">
          <Field label="TIN" name="tin" placeholder="100234567" />
          <Field label="VAT no." name="vatNo" placeholder="100234567-7000" />
          <Field label="BR no." name="brNo" />
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className="rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-3 text-small text-danger"
        >
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Saving…
            </>
          ) : (
            "Create customer"
          )}
        </button>
      </div>
    </form>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-caption font-medium uppercase tracking-wide text-text-tertiary">
      {children}
    </h3>
  );
}
