"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Field } from "@/components/auth/field";
import { api, ApiError, type Supplier, type TaxCode } from "@/lib/api";

export function SupplierForm({
  whtCodes,
  onCreated,
}: {
  whtCodes: TaxCode[];
  onCreated: (s: Supplier) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);

    const paymentTerms = Number(f.get("paymentTermsDays") ?? 0);
    const whtId = String(f.get("defaultWhtTaxCodeId") ?? "");

    try {
      const { supplier } = await api.createSupplier({
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
        defaultWhtTaxCodeId: whtId || undefined,
        bankName: String(f.get("bankName") ?? "").trim(),
        bankAccountNo: String(f.get("bankAccountNo") ?? "").trim(),
        bankBranch: String(f.get("bankBranch") ?? "").trim(),
      });
      onCreated(supplier);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.code === "DUPLICATE_CODE"
            ? "A supplier with this code already exists."
            : err.message
          : "Couldn't create the supplier. Try again.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <section className="space-y-4">
        <SectionTitle>Identity</SectionTitle>
        <Field label="Supplier name" name="name" required placeholder="Lanka Cement Ltd" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Short code" name="code" placeholder="LANKACEM" />
          <Field label="Legal name" name="legalName" placeholder="(if different)" />
        </div>
      </section>

      <section className="space-y-4">
        <SectionTitle>Contact</SectionTitle>
        <Field label="Email" type="email" name="email" placeholder="orders@lankacement.lk" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Phone" name="phone" placeholder="+94 11 234 5678" />
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
          <div>
            <label htmlFor="whtSelect" className="block text-small font-medium text-charcoal">
              Default WHT
            </label>
            <select
              id="whtSelect"
              name="defaultWhtTaxCodeId"
              defaultValue=""
              className="mt-1.5 block w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
            >
              <option value="">None</option>
              {whtCodes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code} — {t.name}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-caption text-text-tertiary">Applied on bills by default</p>
          </div>
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

      <section className="space-y-4">
        <SectionTitle>Banking</SectionTitle>
        <Field label="Bank name" name="bankName" placeholder="Commercial Bank · Sampath · HNB · BOC …" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Account number" name="bankAccountNo" />
          <Field label="Branch" name="bankBranch" />
        </div>
        <p className="text-caption text-text-tertiary">Used for SLIPS and bank-transfer payouts.</p>
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
            "Create supplier"
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
