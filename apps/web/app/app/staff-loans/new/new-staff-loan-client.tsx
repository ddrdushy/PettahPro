"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api, ApiError, type EmployeeListRow, type LoanType } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR } from "@/lib/format";

export function NewStaffLoanClient({
  employees,
  loanTypes,
}: {
  employees: EmployeeListRow[];
  loanTypes: LoanType[];
}) {
  const router = useRouter();
  const activeEmployees = useMemo(
    () => employees.filter((e) => e.status === "active"),
    [employees],
  );

  const [employeeId, setEmployeeId] = useState<string>(activeEmployees[0]?.id ?? "");
  const [loanTypeId, setLoanTypeId] = useState<string>("");
  const [principal, setPrincipal] = useState("0");
  const [interestRatePct, setInterestRatePct] = useState("0");
  const [tenure, setTenure] = useState("6");
  const [firstDue, setFirstDue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyLoanTypeDefaults(id: string) {
    setLoanTypeId(id);
    const t = loanTypes.find((x) => x.id === id);
    if (!t) return;
    setInterestRatePct((t.defaultInterestRateBps / 100).toString());
    setTenure(t.defaultTenureMonths.toString());
  }

  const principalCents = Math.round(Number(principal || "0") * 100);
  const tenureMonths = Number(tenure || "0");
  const rateBps = Math.round(Number(interestRatePct || "0") * 100);
  const totalInterest = Math.round(
    (principalCents * rateBps * tenureMonths) / 12 / 10_000,
  );
  const grand = principalCents + totalInterest;
  const estEmi = tenureMonths > 0 ? Math.floor(grand / tenureMonths) : 0;

  const selectedType = loanTypes.find((t) => t.id === loanTypeId);
  const capBreach =
    selectedType?.maxAmountCents != null && principalCents > selectedType.maxAmountCents;
  const tenureBreach =
    selectedType && tenureMonths > selectedType.maxTenureMonths;

  async function submit() {
    setError(null);
    if (!employeeId) return setError("Pick an employee.");
    if (principalCents <= 0) return setError("Principal must be greater than zero.");
    if (tenureMonths <= 0) return setError("Tenure must be at least one month.");
    if (capBreach)
      return setError(
        `Principal exceeds the cap for this loan type (${formatLKR(selectedType!.maxAmountCents!)}).`,
      );
    if (tenureBreach)
      return setError(`Tenure exceeds the cap for this loan type (${selectedType!.maxTenureMonths} months).`);

    setBusy(true);
    try {
      const res = await api.applyEmployeeLoan({
        employeeId,
        loanTypeId: loanTypeId || null,
        principalCents,
        interestRateBps: rateBps,
        tenureMonths,
        firstInstallmentDate: firstDue || undefined,
        applicationReason: reason.trim() || undefined,
      });
      router.push(`/app/staff-loans/${res.loan.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't submit.");
      setBusy(false);
    }
  }

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/staff-loans" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to staff loans
        </Link>
      </div>

      <PageHeader
        eyebrow="HR"
        title="New staff loan"
        description="Starts in draft. A second admin approves, then disburses and posts a journal entry."
      />

      <section className="mt-6 grid gap-5 rounded-card border-hairline border-border bg-surface-elevated p-5 md:grid-cols-2">
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">Employee</label>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="input mt-1.5"
          >
            <option value="">Select employee…</option>
            {activeEmployees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName}
                {e.employeeCode ? ` · ${e.employeeCode}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">Loan type</label>
          <select
            value={loanTypeId}
            onChange={(e) => applyLoanTypeDefaults(e.target.value)}
            className="input mt-1.5"
          >
            <option value="">No type (ad-hoc)</option>
            {loanTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.code}
              </option>
            ))}
          </select>
          {selectedType && (
            <p className="mt-1 text-caption text-text-tertiary">
              Cap{" "}
              {selectedType.maxAmountCents != null
                ? formatLKR(selectedType.maxAmountCents)
                : "none"}{" "}
              · max {selectedType.maxTenureMonths} months · default rate{" "}
              {(selectedType.defaultInterestRateBps / 100).toFixed(2)}%
            </p>
          )}
        </div>

        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">Principal (LKR)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
            className="input mt-1.5 text-right tabular-nums"
          />
        </div>

        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">Tenure (months)</label>
          <input
            type="number"
            min="1"
            max="120"
            value={tenure}
            onChange={(e) => setTenure(e.target.value)}
            className="input mt-1.5 text-right tabular-nums"
          />
        </div>

        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">
            Interest rate (% per annum)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={interestRatePct}
            onChange={(e) => setInterestRatePct(e.target.value)}
            className="input mt-1.5 text-right tabular-nums"
          />
          <p className="mt-1 text-caption text-text-tertiary">Flat rate. 0% = interest-free.</p>
        </div>

        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">
            First installment date (optional)
          </label>
          <input
            type="date"
            value={firstDue}
            onChange={(e) => setFirstDue(e.target.value)}
            className="input mt-1.5"
          />
          <p className="mt-1 text-caption text-text-tertiary">
            Defaults to the first day of the month following disbursement.
          </p>
        </div>

        <div className="md:col-span-2">
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">Reason</label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this loan needed?"
            className="input mt-1.5 w-full"
          />
        </div>
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-4">
        <Card label="Principal" value={formatLKR(principalCents)} />
        <Card label="Total interest" value={formatLKR(totalInterest)} sub="Flat rate over tenure" />
        <Card label="Est. monthly EMI" value={formatLKR(estEmi)} sub="Payroll deduction per month" emphasis />
        <Card
          label="Grand total"
          value={formatLKR(grand)}
          sub={tenureMonths > 0 ? `${tenureMonths} installments` : "Set tenure"}
        />
      </section>

      <section className="mt-6 flex items-center justify-end gap-3">
        {error && <p className="text-small text-danger">{error}</p>}
        <Link href="/app/staff-loans" className="btn-secondary">
          Cancel
        </Link>
        <button type="button" onClick={submit} disabled={busy} className="btn-primary disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Submit application
        </button>
      </section>
    </main>
  );
}

function Card({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-card border-hairline p-5 ${
        emphasis ? "border-charcoal/20 bg-mint-surface/40" : "border-border bg-surface-elevated"
      }`}
    >
      <p className="text-caption uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className="tabular-nums mt-2 text-h3 text-charcoal">{value}</p>
      {sub && <p className="mt-1 text-caption text-text-secondary">{sub}</p>}
    </div>
  );
}
