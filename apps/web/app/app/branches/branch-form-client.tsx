"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api, ApiError, type Branch } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";

export function BranchFormClient({
  mode,
  initial,
}: {
  mode: "create" | "edit";
  initial?: Branch;
}) {
  const router = useRouter();
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [isHeadOffice, setIsHeadOffice] = useState(initial?.isHeadOffice ?? false);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [addressLine1, setAddressLine1] = useState(initial?.addressLine1 ?? "");
  const [addressLine2, setAddressLine2] = useState(initial?.addressLine2 ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [postalCode, setPostalCode] = useState(initial?.postalCode ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!code.trim() || !name.trim()) {
      setError("Code and name are required.");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        code: code.trim(),
        name: name.trim(),
        isHeadOffice,
        addressLine1: addressLine1.trim() || undefined,
        addressLine2: addressLine2.trim() || undefined,
        city: city.trim() || undefined,
        postalCode: postalCode.trim() || undefined,
        phone: phone.trim() || undefined,
      };
      if (mode === "create") {
        const res = await api.createBranch(payload);
        router.push(`/app/branches/${res.branch.id}`);
      } else if (initial) {
        await api.updateBranch(initial.id, { ...payload, isActive });
        router.refresh();
        router.push("/app/branches");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/branches" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to branches
        </Link>
      </div>

      <PageHeader
        eyebrow="Settings"
        title={mode === "create" ? "New branch" : (initial?.name ?? "Branch")}
        description={
          mode === "create"
            ? "Add a new location. The code should be short and unique — it'll appear on invoices and bills tagged to this branch."
            : "Update the branch details. Code changes flow through to future documents only."
        }
      />

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="code" className="block text-caption uppercase tracking-wide text-text-tertiary">
            Code <span className="text-danger">*</span>
          </label>
          <input
            id="code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="HO, COL, KDY"
            maxLength={16}
            className="input mt-1.5 tabular-nums"
          />
        </div>
        <div>
          <label htmlFor="name" className="block text-caption uppercase tracking-wide text-text-tertiary">
            Name <span className="text-danger">*</span>
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Head office, Colombo shop, Kandy warehouse"
            maxLength={255}
            className="input mt-1.5"
          />
        </div>
        <div className="md:col-span-2">
          <label htmlFor="addr1" className="block text-caption uppercase tracking-wide text-text-tertiary">
            Address line 1
          </label>
          <input id="addr1" type="text" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} className="input mt-1.5" />
        </div>
        <div className="md:col-span-2">
          <label htmlFor="addr2" className="block text-caption uppercase tracking-wide text-text-tertiary">
            Address line 2
          </label>
          <input id="addr2" type="text" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} className="input mt-1.5" />
        </div>
        <div>
          <label htmlFor="city" className="block text-caption uppercase tracking-wide text-text-tertiary">
            City
          </label>
          <input id="city" type="text" value={city} onChange={(e) => setCity(e.target.value)} className="input mt-1.5" />
        </div>
        <div>
          <label htmlFor="postal" className="block text-caption uppercase tracking-wide text-text-tertiary">
            Postal code
          </label>
          <input id="postal" type="text" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} className="input mt-1.5 tabular-nums" />
        </div>
        <div>
          <label htmlFor="phone" className="block text-caption uppercase tracking-wide text-text-tertiary">
            Phone
          </label>
          <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="input mt-1.5 tabular-nums" />
        </div>
      </section>

      <section className="mt-6 flex flex-wrap items-center gap-6">
        <label className="flex items-center gap-2 text-small text-charcoal">
          <input
            type="checkbox"
            checked={isHeadOffice}
            onChange={(e) => setIsHeadOffice(e.target.checked)}
            className="h-4 w-4 rounded border-border-emphasis text-charcoal focus:ring-charcoal"
          />
          Head office
          <span className="text-caption text-text-tertiary">(only one per tenant)</span>
        </label>
        {mode === "edit" && (
          <label className="flex items-center gap-2 text-small text-charcoal">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-border-emphasis text-charcoal focus:ring-charcoal"
            />
            Active
            <span className="text-caption text-text-tertiary">(inactive branches are hidden from pickers)</span>
          </label>
        )}
      </section>

      <section className="mt-8 flex items-center justify-end gap-3">
        {error && <span className="text-small text-danger">{error}</span>}
        <Link href="/app/branches" className="btn-secondary">Cancel</Link>
        <button type="button" onClick={submit} disabled={busy} className="btn-primary disabled:cursor-not-allowed disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {mode === "create" ? "Create branch" : "Save changes"}
        </button>
      </section>
    </main>
  );
}
