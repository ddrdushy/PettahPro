"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check } from "lucide-react";
import { api, ApiError, type TenantSettings, type StockRelieveOn } from "@/lib/api";

export function SettingsFormClient({
  initial,
  defaults,
}: {
  initial: TenantSettings;
  defaults: TenantSettings;
}) {
  const router = useRouter();
  const [salaryDaysPerMonth, setSalaryDaysPerMonth] = useState<number>(initial.salaryDaysPerMonth);
  const [stockRelieveOn, setStockRelieveOn] = useState<StockRelieveOn>(initial.stockRelieveOn);
  const [jeThresholdInput, setJeThresholdInput] = useState<string>(
    (initial.journalApprovalThresholdCents / 100).toFixed(2),
  );
  const [purchaseRequisitionsEnabled, setPurchaseRequisitionsEnabled] = useState(
    initial.purchaseRequisitionsEnabled,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const jeThresholdCents = Math.max(0, Math.round(Number(jeThresholdInput) * 100) || 0);

  const dirty =
    salaryDaysPerMonth !== initial.salaryDaysPerMonth ||
    stockRelieveOn !== initial.stockRelieveOn ||
    jeThresholdCents !== initial.journalApprovalThresholdCents ||
    purchaseRequisitionsEnabled !== initial.purchaseRequisitionsEnabled;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (salaryDaysPerMonth < 20 || salaryDaysPerMonth > 31) {
      setError("Salary days per month must be between 20 and 31.");
      return;
    }
    setBusy(true);
    try {
      await api.updateSettings({
        salaryDaysPerMonth,
        stockRelieveOn,
        journalApprovalThresholdCents: jeThresholdCents,
        purchaseRequisitionsEnabled,
      });
      setSavedAt(new Date());
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save settings. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-8">
      <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
        <h2 className="text-body font-medium text-charcoal">Payroll</h2>
        <p className="mt-1 text-caption text-text-secondary">
          How no-pay leave and other pro-rated deductions are calculated against a full month of salary.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="salaryDays" className="block text-caption uppercase tracking-wide text-text-tertiary">
              Salary days per month
            </label>
            <input
              id="salaryDays"
              type="number"
              min={20}
              max={31}
              step={1}
              value={salaryDaysPerMonth}
              onChange={(e) => setSalaryDaysPerMonth(Number(e.target.value))}
              className="input mt-1.5 w-32"
            />
            <p className="mt-1.5 text-caption text-text-tertiary">
              Default {defaults.salaryDaysPerMonth}. Sri Lankan convention is 30. Set to the number of working days you pay per month if you use a different basis (e.g. 26).
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
        <h2 className="text-body font-medium text-charcoal">Journal approvals</h2>
        <p className="mt-1 text-caption text-text-secondary">
          Manual journal entries above this threshold need a second pair of eyes before posting. 0 means no approval required — the current default. SOD rule: approvers can't approve their own drafts.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="jeThreshold" className="block text-caption uppercase tracking-wide text-text-tertiary">
              Approval threshold (LKR)
            </label>
            <input
              id="jeThreshold"
              type="number"
              min={0}
              step="100"
              value={jeThresholdInput}
              onChange={(e) => setJeThresholdInput(e.target.value)}
              className="input mt-1.5 w-40"
            />
            <p className="mt-1.5 text-caption text-text-tertiary">
              Entries with total debits ≥ this amount go to the approvals queue. Set to 0 to disable.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
        <h2 className="text-body font-medium text-charcoal">Inventory</h2>
        <p className="mt-1 text-caption text-text-secondary">
          When tracked items leave inventory and the COGS journal entry is posted.
        </p>

        <div className="mt-5 space-y-3">
          <RelieveOption
            value="invoice"
            current={stockRelieveOn}
            onSelect={setStockRelieveOn}
            title="At invoice post"
            description="Stock leaves inventory and COGS posts at the same time the sales invoice is posted. Default — fits businesses where the invoice is the single source of truth for a sale."
            isDefault={defaults.stockRelieveOn === "invoice"}
          />
          <RelieveOption
            value="delivery_note"
            current={stockRelieveOn}
            onSelect={setStockRelieveOn}
            title="At delivery note deliver"
            description="Stock leaves inventory and COGS posts when the DN is marked delivered. Invoices post with no stock/COGS movement. Fits businesses where goods physically leave the warehouse before billing."
            isDefault={defaults.stockRelieveOn === "delivery_note"}
          />
          {stockRelieveOn !== initial.stockRelieveOn && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-caption text-amber-900">
              Heads up: this only affects documents posted <strong>after</strong> you save. Historical invoices and DNs aren't re-posted.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
        <h2 className="text-body font-medium text-charcoal">Modules</h2>
        <p className="mt-1 text-caption text-text-secondary">
          Optional features that some tenants use. Off by default; turning them on reveals the related sidebar entries and endpoints.
        </p>

        <div className="mt-5">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={purchaseRequisitionsEnabled}
              onChange={(e) => setPurchaseRequisitionsEnabled(e.target.checked)}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-small font-medium text-charcoal">Purchase requisitions</span>
                {!defaults.purchaseRequisitionsEnabled && (
                  <span className="rounded-full bg-surface-recessed px-2 py-0.5 text-caption text-text-tertiary">
                    Off by default
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-caption text-text-secondary">
                Internal "request to buy" document routed through approval and converted into a Purchase Order. Useful when the person who needs the purchase isn't the one authorised to commit spend.
              </p>
            </div>
          </label>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || !dirty}
          className="btn-primary inline-flex items-center gap-2 text-small disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Save settings
        </button>
        {savedAt && !dirty && !busy && (
          <span className="inline-flex items-center gap-1.5 text-caption text-mint-dark">
            <Check className="h-3.5 w-3.5" aria-hidden />
            Saved
          </span>
        )}
        {error && <span className="text-caption text-danger">{error}</span>}
      </div>
    </form>
  );
}

function RelieveOption({
  value,
  current,
  onSelect,
  title,
  description,
  isDefault,
}: {
  value: StockRelieveOn;
  current: StockRelieveOn;
  onSelect: (v: StockRelieveOn) => void;
  title: string;
  description: string;
  isDefault: boolean;
}) {
  const selected = current === value;
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-md border-hairline p-3 transition ${
        selected ? "border-charcoal bg-surface-recessed/40" : "border-border hover:bg-surface-recessed/20"
      }`}
    >
      <input
        type="radio"
        name="stockRelieveOn"
        value={value}
        checked={selected}
        onChange={() => onSelect(value)}
        className="mt-1"
      />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-small font-medium text-charcoal">{title}</span>
          {isDefault && (
            <span className="rounded-full bg-surface-recessed px-2 py-0.5 text-caption text-text-tertiary">Default</span>
          )}
        </div>
        <p className="mt-0.5 text-caption text-text-secondary">{description}</p>
      </div>
    </label>
  );
}
