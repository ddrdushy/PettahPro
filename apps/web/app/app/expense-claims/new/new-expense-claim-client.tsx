"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import {
  api,
  ApiError,
  type EmployeeListRow,
  type ExpenseCategory,
  type ExpenseDisbursementMethod,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";

export function NewExpenseClaimClient({
  employees,
  categories,
}: {
  employees: EmployeeListRow[];
  categories: ExpenseCategory[];
}) {
  const router = useRouter();
  const activeEmployees = useMemo(
    () => employees.filter((e) => e.status === "active"),
    [employees],
  );

  const [employeeId, setEmployeeId] = useState<string>(activeEmployees[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState<string>(categories[0]?.id ?? "");
  const [claimDate, setClaimDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("0");
  const [description, setDescription] = useState("");
  const [receiptRef, setReceiptRef] = useState("");
  const [method, setMethod] = useState<ExpenseDisbursementMethod>("direct");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountCents = Math.round(Number(amount || "0") * 100);
  const selectedCategory = categories.find((c) => c.id === categoryId);

  async function submit(action: "save" | "submit") {
    setError(null);
    if (!employeeId) return setError("Pick an employee.");
    if (!categoryId) return setError("Pick a category.");
    if (amountCents <= 0) return setError("Amount must be greater than zero.");
    if (!claimDate) return setError("Claim date is required.");

    setBusy(true);
    try {
      const res = await api.createExpenseClaim({
        employeeId,
        categoryId,
        claimDate,
        amountCents,
        description: description.trim() || undefined,
        receiptRef: receiptRef.trim() || undefined,
        disbursementMethod: method,
      });
      if (action === "submit") {
        await api.submitExpenseClaim(res.claim.id);
      }
      router.push(`/app/expense-claims/${res.claim.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the claim.");
      setBusy(false);
    }
  }

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/expense-claims" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to expense claims
        </Link>
      </div>

      <PageHeader
        eyebrow="HR"
        title="New expense claim"
        description="Saves as draft. Submit when ready — a second admin approves, then the claim is either reimbursed directly or bundled into the next payroll run."
      />

      <section className="mt-6 grid gap-5 rounded-card border-hairline border-border bg-surface-elevated p-5 md:grid-cols-2">
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">
            Employee
          </label>
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
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">
            Category
          </label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="input mt-1.5"
          >
            <option value="">Select category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.code}
              </option>
            ))}
          </select>
          {selectedCategory && (
            <p className="mt-1 text-caption text-text-tertiary">
              {selectedCategory.isTaxable
                ? "Counts toward EPF/ETF/PAYE when bundled with payroll."
                : "Tax-free reimbursement."}
            </p>
          )}
        </div>

        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">
            Claim date
          </label>
          <input
            type="date"
            value={claimDate}
            onChange={(e) => setClaimDate(e.target.value)}
            className="input mt-1.5"
          />
        </div>

        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">
            Amount (LKR)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input mt-1.5 text-right tabular-nums"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">
            Disbursement method
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <MethodChip
              active={method === "direct"}
              onClick={() => setMethod("direct")}
              title="Direct bank payment"
              sub="Post DR expense / CR bank at approval time."
            />
            <MethodChip
              active={method === "payroll"}
              onClick={() => setMethod("payroll")}
              title="Bundle with next payroll"
              sub="Add to the employee's next payroll line, no separate JE."
            />
          </div>
        </div>

        <div className="md:col-span-2">
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">
            Description
          </label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What was this for? (e.g. Taxi fare to supplier meeting)"
            className="input mt-1.5 w-full"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">
            Receipt reference
          </label>
          <input
            type="text"
            value={receiptRef}
            onChange={(e) => setReceiptRef(e.target.value)}
            placeholder="Receipt number, vendor invoice #, file link…"
            className="input mt-1.5 w-full"
          />
          <p className="mt-1 text-caption text-text-tertiary">
            File attachments coming in a later release — paste a Drive/SharePoint link for now.
          </p>
        </div>
      </section>

      <section className="mt-6 flex items-center justify-end gap-3">
        {error && <p className="text-small text-danger">{error}</p>}
        <Link href="/app/expense-claims" className="btn-secondary">
          Cancel
        </Link>
        <button
          type="button"
          onClick={() => submit("save")}
          disabled={busy}
          className="btn-secondary disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Save draft
        </button>
        <button
          type="button"
          onClick={() => submit("submit")}
          disabled={busy}
          className="btn-primary disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Save &amp; submit
        </button>
      </section>
    </main>
  );
}

function MethodChip({
  active,
  onClick,
  title,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-card border-hairline p-3 text-left transition-colors ${
        active
          ? "border-charcoal bg-mint-surface/40"
          : "border-border bg-surface-elevated hover:border-charcoal/30"
      }`}
    >
      <p className="text-small font-medium text-charcoal">{title}</p>
      <p className="mt-1 text-caption text-text-secondary">{sub}</p>
    </button>
  );
}
