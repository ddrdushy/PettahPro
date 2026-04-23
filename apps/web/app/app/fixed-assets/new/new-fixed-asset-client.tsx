"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import {
  api,
  ApiError,
  type Account,
  type Supplier,
  type FixedAssetCategory,
  type DepreciationMethod,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR } from "@/lib/format";

const CATEGORIES: Array<{ value: FixedAssetCategory; label: string }> = [
  { value: "vehicle", label: "Vehicle" },
  { value: "equipment", label: "Equipment" },
  { value: "furniture", label: "Furniture" },
  { value: "building", label: "Building" },
  { value: "it_hardware", label: "IT hardware" },
  { value: "software", label: "Software" },
  { value: "land", label: "Land (non-depreciable)" },
  { value: "other", label: "Other" },
];

const METHODS: Array<{ value: DepreciationMethod; label: string; hint: string }> = [
  { value: "straight_line", label: "Straight line (SLM)", hint: "(Cost − salvage) ÷ life" },
  { value: "wdv", label: "Written down value (WDV)", hint: "NBV × annual rate (common for SL tax)" },
  { value: "sum_of_years_digits", label: "Sum of years' digits", hint: "Accelerated, rarely used" },
];

function toInt(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? Math.max(0, Math.round(v * 100)) : 0;
}

function toCount(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

// Percent string (e.g. "20" or "20.5") → basis points (2000 / 2050).
function toBps(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? Math.max(0, Math.round(v * 100)) : 0;
}

export function NewFixedAssetClient({
  accounts,
  suppliers,
}: {
  accounts: Account[];
  suppliers: Supplier[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [category, setCategory] = useState<FixedAssetCategory>("equipment");
  const [acquisitionDate, setAcquisitionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [depreciationStartDate, setDepreciationStartDate] = useState("");
  const [cost, setCost] = useState("");
  const [salvage, setSalvage] = useState("0");
  const [lifeMonths, setLifeMonths] = useState("60");
  const [method, setMethod] = useState<DepreciationMethod>("straight_line");
  const [supplierId, setSupplierId] = useState("");
  const [assetAccountId, setAssetAccountId] = useState("");
  const [accumAccountId, setAccumAccountId] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [notes, setNotes] = useState("");
  // Tax schedule — default "mirror book", flip the toggle to diverge.
  const [taxDiverges, setTaxDiverges] = useState(false);
  const [taxMethod, setTaxMethod] = useState<DepreciationMethod>("wdv");
  const [taxLifeMonths, setTaxLifeMonths] = useState("60");
  const [taxSalvage, setTaxSalvage] = useState("0");
  const [taxRatePct, setTaxRatePct] = useState("20"); // percent, not bps
  const [taxStartDate, setTaxStartDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assetAccounts = useMemo(
    () => accounts.filter((a) => a.accountType === "asset" && a.isActive),
    [accounts],
  );
  const expenseAccounts = useMemo(
    () => accounts.filter((a) => a.accountType === "expense" && a.isActive),
    [accounts],
  );

  const costCents = toInt(cost);
  const salvageCents = toInt(salvage);
  const months = toCount(lifeMonths);
  const monthlyDepreciation =
    category === "land" || months === 0
      ? 0
      : method === "wdv"
        ? Math.round((costCents / Math.max(1, months)) * 2) // rough: 2x SLM for first month
        : Math.round((costCents - salvageCents) / Math.max(1, months));

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (costCents <= 0) {
      setError("Cost must be greater than 0.");
      return;
    }
    if (salvageCents > costCents) {
      setError("Salvage can't exceed cost.");
      return;
    }
    if (months <= 0) {
      setError("Useful life must be at least 1 month.");
      return;
    }
    const taxLife = toCount(taxLifeMonths);
    const taxSalv = toInt(taxSalvage);
    if (taxDiverges) {
      if (taxLife <= 0) {
        setError("Tax useful life must be at least 1 month.");
        return;
      }
      if (taxSalv > costCents) {
        setError("Tax salvage can't exceed cost.");
        return;
      }
    }

    setBusy(true);
    try {
      const res = await api.createFixedAsset({
        code: code.trim() || undefined,
        name: name.trim(),
        category,
        acquisitionDate,
        depreciationStartDate: depreciationStartDate || undefined,
        costCents,
        salvageCents,
        usefulLifeMonths: months,
        depreciationMethod: method,
        supplierId: supplierId || undefined,
        assetAccountId: assetAccountId || undefined,
        accumulatedDepreciationAccountId: accumAccountId || undefined,
        depreciationExpenseAccountId: expenseAccountId || undefined,
        notes: notes.trim() || undefined,
        ...(taxDiverges
          ? {
              taxDepreciationMethod: taxMethod,
              taxUsefulLifeMonths: taxLife,
              taxSalvageCents: taxSalv,
              taxAnnualRateBps: taxMethod === "wdv" ? toBps(taxRatePct) : undefined,
              taxDepreciationStartDate: taxStartDate || undefined,
            }
          : {}),
      });
      router.push(`/app/fixed-assets/${res.asset.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't register asset.");
      setBusy(false);
    }
  }

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/fixed-assets" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to fixed assets
        </Link>
      </div>

      <PageHeader
        eyebrow="Accounting"
        title="Register fixed asset"
        description="Capitalise a long-lived asset. Monthly depreciation runs charge the book schedule to the GL; a parallel tax schedule runs memo-only for tax computation."
      />

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <Field label="Name" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Toyota Hilux KM-1234"
            className="input"
          />
        </Field>
        <Field label="Code (optional)">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="FA-001"
            className="input tabular-nums"
          />
        </Field>
        <Field label="Category" required>
          <select value={category} onChange={(e) => setCategory(e.target.value as FixedAssetCategory)} className="input">
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Supplier (optional)">
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="input">
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Acquisition date" required>
          <input type="date" value={acquisitionDate} onChange={(e) => setAcquisitionDate(e.target.value)} className="input" />
        </Field>
        <Field label="Depreciation starts" hint="Leave blank to use acquisition date">
          <input type="date" value={depreciationStartDate} onChange={(e) => setDepreciationStartDate(e.target.value)} className="input" />
        </Field>
        <Field label="Cost (LKR)" required>
          <input type="number" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)} className="input text-right tabular-nums" />
        </Field>
        <Field label="Salvage value (LKR)" hint="Expected recoverable value at end of life">
          <input type="number" step="0.01" min="0" value={salvage} onChange={(e) => setSalvage(e.target.value)} className="input text-right tabular-nums" />
        </Field>
        <Field label="Useful life (months)" required>
          <input type="number" min="1" max="600" step="1" value={lifeMonths} onChange={(e) => setLifeMonths(e.target.value)} className="input text-right tabular-nums" />
        </Field>
        <Field label="Method" required>
          <select value={method} onChange={(e) => setMethod(e.target.value as DepreciationMethod)} className="input">
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </Field>
        <div className="rounded-card border-hairline border-border bg-surface-recessed/40 p-4 md:col-span-2">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Monthly depreciation (book, first period)</p>
          <p className="tabular-nums mt-1 text-h3 text-charcoal">{formatLKR(monthlyDepreciation)}</p>
          <p className="mt-1 text-caption text-text-tertiary">
            {METHODS.find((m) => m.value === method)?.hint}
          </p>
        </div>
      </section>

      <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-caption uppercase tracking-wide text-text-tertiary">Tax schedule</p>
            <p className="mt-1 text-caption text-text-secondary">
              Memo-only schedule used by the CA for tax computation. Never posts to the GL. By default it mirrors the book schedule — flip this on when the SL IRD rate differs from your accounting policy.
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={taxDiverges}
              onChange={(e) => setTaxDiverges(e.target.checked)}
              className="h-4 w-4 accent-mint-dark"
            />
            <span className="text-small text-charcoal">Tax differs from book</span>
          </label>
        </div>

        {taxDiverges && (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Tax method" required>
              <select value={taxMethod} onChange={(e) => setTaxMethod(e.target.value as DepreciationMethod)} className="input">
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Tax useful life (months)" required>
              <input
                type="number"
                min="1"
                max="600"
                step="1"
                value={taxLifeMonths}
                onChange={(e) => setTaxLifeMonths(e.target.value)}
                className="input text-right tabular-nums"
              />
            </Field>
            <Field label="Tax salvage value (LKR)">
              <input
                type="number"
                step="0.01"
                min="0"
                value={taxSalvage}
                onChange={(e) => setTaxSalvage(e.target.value)}
                className="input text-right tabular-nums"
              />
            </Field>
            {taxMethod === "wdv" && (
              <Field label="Annual rate (%)" hint="SL IRD schedule rate, e.g. 20 for 20%">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={taxRatePct}
                  onChange={(e) => setTaxRatePct(e.target.value)}
                  className="input text-right tabular-nums"
                />
              </Field>
            )}
            <Field label="Tax start date" hint="Leave blank to use book start date">
              <input
                type="date"
                value={taxStartDate}
                onChange={(e) => setTaxStartDate(e.target.value)}
                className="input"
              />
            </Field>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
        <p className="text-caption uppercase tracking-wide text-text-tertiary">GL accounts</p>
        <p className="mt-1 text-caption text-text-secondary">
          Leave blank to auto-resolve from your chart. Depreciation runs won't post until all three are set.
        </p>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <Field label="Asset account">
            <select value={assetAccountId} onChange={(e) => setAssetAccountId(e.target.value)} className="input">
              <option value="">Auto</option>
              {assetAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Accumulated depreciation">
            <select value={accumAccountId} onChange={(e) => setAccumAccountId(e.target.value)} className="input">
              <option value="">Auto</option>
              {assetAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Depreciation expense">
            <select value={expenseAccountId} onChange={(e) => setExpenseAccountId(e.target.value)} className="input">
              <option value="">Auto</option>
              {expenseAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section className="mt-6">
        <label htmlFor="notes" className="block text-caption uppercase tracking-wide text-text-tertiary">
          Notes
        </label>
        <textarea
          id="notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Serial numbers, warranty terms, where it's located"
          className="input mt-1.5 w-full"
        />
      </section>

      <section className="mt-6 flex items-center justify-between gap-4">
        <p className="text-small text-text-secondary">
          Registering doesn't post any journal entry — the asset purchase should already be in your books
          via a bill or cash payment.
        </p>
        <div className="flex items-center gap-3">
          {error && <span className="text-small text-danger">{error}</span>}
          <button type="button" onClick={submit} disabled={busy} className="btn-primary disabled:cursor-not-allowed disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Register
          </button>
        </div>
      </section>
    </main>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-caption uppercase tracking-wide text-text-tertiary">
        {label}
        {required && <span className="ml-1 text-danger">*</span>}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-caption text-text-tertiary">{hint}</p>}
    </div>
  );
}
