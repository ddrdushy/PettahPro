"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Field } from "@/components/auth/field";
import { api, ApiError, type Employee, type EmploymentType } from "@/lib/api";

const NIC_REGEX = /^(?:\d{9}[VvXx]|\d{12})$/;

const EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
  { value: "permanent", label: "Permanent" },
  { value: "probation", label: "Probation" },
  { value: "contract", label: "Contract" },
  { value: "casual", label: "Casual" },
  { value: "intern", label: "Intern" },
  { value: "consultant", label: "Consultant" },
];

export function EmployeeForm({ onCreated }: { onCreated: (e: Employee) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [epfEligible, setEpfEligible] = useState(true);
  const [etfEligible, setEtfEligible] = useState(true);
  const [payeApplicable, setPayeApplicable] = useState(true);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);

    const nic = String(f.get("nic") ?? "").trim();
    if (nic && !NIC_REGEX.test(nic)) {
      setError("NIC must be old 10-char (9 digits + V/X) or new 12-digit format.");
      setBusy(false);
      return;
    }

    const salaryLKR = Number(f.get("basicSalary") ?? 0);

    try {
      const { employee } = await api.createEmployee({
        employeeCode: String(f.get("employeeCode") ?? "").trim() || undefined,
        firstName: String(f.get("firstName") ?? "").trim(),
        lastName: String(f.get("lastName") ?? "").trim(),
        dateOfBirth: String(f.get("dateOfBirth") ?? "") || undefined,
        gender: String(f.get("gender") ?? "") || undefined,
        personalEmail: String(f.get("personalEmail") ?? "").trim() || undefined,
        mobilePhone: String(f.get("mobilePhone") ?? "").trim() || undefined,
        whatsapp: String(f.get("whatsapp") ?? "").trim() || undefined,
        addressLine1: String(f.get("addressLine1") ?? "").trim() || undefined,
        city: String(f.get("city") ?? "").trim() || undefined,
        nic: nic || undefined,
        epfNumber: String(f.get("epfNumber") ?? "").trim() || undefined,
        etfNumber: String(f.get("etfNumber") ?? "").trim() || undefined,
        tin: String(f.get("tin") ?? "").trim() || undefined,
        hireDate: String(f.get("hireDate") ?? ""),
        employmentType: (String(f.get("employmentType") ?? "permanent") as EmploymentType),
        designation: String(f.get("designation") ?? "").trim() || undefined,
        department: String(f.get("department") ?? "").trim() || undefined,
        basicSalaryCents: Number.isFinite(salaryLKR) ? Math.round(salaryLKR * 100) : 0,
        epfEligible,
        etfEligible,
        payeApplicable,
        bankName: String(f.get("bankName") ?? "").trim() || undefined,
        bankAccountNo: String(f.get("bankAccountNo") ?? "").trim() || undefined,
        bankBranch: String(f.get("bankBranch") ?? "").trim() || undefined,
      });
      onCreated(employee);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.code === "DUPLICATE_CODE"
            ? "An employee with this code already exists."
            : err.code === "DUPLICATE_NIC"
              ? "An employee with this NIC already exists."
              : err.code === "INVALID_INPUT"
                ? err.message || "Please check the fields and try again."
                : err.message
          : "Couldn't create the employee.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <section className="space-y-4">
        <SectionTitle>Identity</SectionTitle>
        <div className="grid grid-cols-2 gap-4">
          <Field label="First name" name="firstName" required />
          <Field label="Last name" name="lastName" required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Employee code" name="employeeCode" placeholder="EMP-001" />
          <Field label="Date of birth" name="dateOfBirth" type="date" />
        </div>
        <div>
          <label htmlFor="gender" className="block text-small font-medium text-charcoal">
            Gender
          </label>
          <select
            id="gender"
            name="gender"
            defaultValue=""
            className="mt-1.5 block w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
          >
            <option value="">Prefer not to say</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </div>
      </section>

      <section className="space-y-4">
        <SectionTitle>Contact</SectionTitle>
        <Field label="Personal email" name="personalEmail" type="email" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Mobile" name="mobilePhone" placeholder="+94 77 123 4567" />
          <Field label="WhatsApp" name="whatsapp" placeholder="Same as mobile if empty" />
        </div>
        <Field label="Address" name="addressLine1" />
        <Field label="City" name="city" />
      </section>

      <section className="space-y-4">
        <SectionTitle>Employment</SectionTitle>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Hire date" name="hireDate" type="date" required />
          <div>
            <label htmlFor="employmentType" className="block text-small font-medium text-charcoal">
              Type
            </label>
            <select
              id="employmentType"
              name="employmentType"
              defaultValue="permanent"
              className="mt-1.5 block w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
            >
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Designation" name="designation" placeholder="Sales assistant" />
          <Field label="Department" name="department" placeholder="Retail" />
        </div>
        <Field
          label="Basic salary (LKR per month)"
          name="basicSalary"
          type="number"
          min={0}
          step="100"
          defaultValue={0}
          hint="EPF, ETF, PAYE are computed from this"
        />
      </section>

      <section className="space-y-4">
        <SectionTitle>SL statutory</SectionTitle>
        <Field label="NIC" name="nic" placeholder="851234567V or 200012345678" hint="Old 10-char with V/X or new 12-digit" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="EPF number" name="epfNumber" />
          <Field label="ETF number" name="etfNumber" />
        </div>
        <Field label="TIN" name="tin" />

        <div className="grid grid-cols-3 gap-2 pt-2">
          <Toggle label="EPF eligible" checked={epfEligible} onChange={setEpfEligible} />
          <Toggle label="ETF eligible" checked={etfEligible} onChange={setEtfEligible} />
          <Toggle label="PAYE applicable" checked={payeApplicable} onChange={setPayeApplicable} />
        </div>
      </section>

      <section className="space-y-4">
        <SectionTitle>Bank (for SLIPS payout)</SectionTitle>
        <Field label="Bank name" name="bankName" placeholder="Commercial Bank · HNB · Sampath · BOC …" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Account number" name="bankAccountNo" />
          <Field label="Branch" name="bankBranch" />
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
            "Create employee"
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

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`rounded-md border-hairline py-2 text-small transition ${
        checked
          ? "border-charcoal bg-charcoal text-offwhite"
          : "border-border bg-surface-elevated text-text-secondary hover:border-charcoal hover:text-charcoal"
      }`}
      aria-pressed={checked}
    >
      {label}
    </button>
  );
}
