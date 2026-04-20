import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import type { PayrollRun, PayrollRunLine, PayrollRunStatus } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";
import { PostPayrollButton } from "./post-button";

export const metadata: Metadata = { title: "Payroll run" };

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const statusTone: Record<PayrollRunStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary",
  posted: "bg-mint-surface text-mint-dark",
  paid: "bg-mint text-mint-dark",
  void: "bg-danger-bg/60 text-danger",
};

const statusLabel: Record<PayrollRunStatus, string> = {
  draft: "Draft",
  posted: "Posted",
  paid: "Paid",
  void: "Void",
};

async function fetchRun(id: string) {
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/payroll-runs/${id}`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return (await res.json()) as { run: PayrollRun; lines: PayrollRunLine[] };
}

export default async function PayrollRunDetailPage({ params }: { params: { id: string } }) {
  const data = await fetchRun(params.id);
  if (!data) notFound();
  const { run, lines } = data;

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/payroll" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to payroll
        </Link>
      </div>

      <PageHeader
        eyebrow={run.runNumber ? `Run ${run.runNumber}` : "Draft run"}
        title={`${MONTHS[run.periodMonth - 1]} ${run.periodYear} payroll`}
        description={`${run.employeeCount} ${run.employeeCount === 1 ? "employee" : "employees"} · pay date ${formatDate(run.payDate)}`}
        action={
          <div className="flex items-center gap-3">
            <span className={`rounded-full px-3 py-1 text-small font-medium ${statusTone[run.status]}`}>
              {statusLabel[run.status]}
            </span>
            {run.status === "draft" && <PostPayrollButton id={run.id} />}
          </div>
        }
      />

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Gross" value={formatLKR(run.grossCents)} tone="mint" />
        <Stat
          label="Employee deductions"
          value={formatLKR(run.epfEmployeeCents + run.payeCents)}
          sub={`EPF ${formatLKR(run.epfEmployeeCents)} · PAYE ${formatLKR(run.payeCents)}`}
        />
        <Stat
          label="Employer contributions"
          value={formatLKR(run.epfEmployerCents + run.etfEmployerCents)}
          sub={`EPF ${formatLKR(run.epfEmployerCents)} · ETF ${formatLKR(run.etfEmployerCents)}`}
        />
        <Stat label="Net pay to staff" value={formatLKR(run.netPayCents)} emphasize />
      </section>

      <section className="mt-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <header className="border-b-hairline border-border px-6 py-4">
          <h2 className="text-h3 text-charcoal">Payslips</h2>
          <p className="text-caption text-text-tertiary">One row per employee · values computed at draft time</p>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="px-4 py-3 text-left">Employee</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-right">Gross</th>
                <th className="px-4 py-3 text-right">EPF 8%</th>
                <th className="px-4 py-3 text-right">PAYE</th>
                <th className="px-4 py-3 text-right">Net</th>
                <th className="w-24 px-4 py-3 text-center">Payslip</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-charcoal">{l.employeeFullName}</p>
                    {l.employeeCode && (
                      <p className="text-caption text-text-tertiary">{l.employeeCode}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {l.designation && <p className="text-charcoal">{l.designation}</p>}
                    {l.department && (
                      <p className="text-caption text-text-tertiary">{l.department}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                    {formatLKR(l.grossCents)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {l.epfEmployeeCents > 0 ? formatLKR(l.epfEmployeeCents) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {l.payeCents > 0 ? formatLKR(l.payeCents) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-charcoal">
                    {formatLKR(l.netPayCents)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <a
                      href={`/app/payroll/${run.id}/payslips/${l.id}/pdf`}
                      target="_blank"
                      rel="noopener"
                      className="inline-flex items-center gap-1 rounded-md border-hairline border-border bg-surface-elevated px-2.5 py-1 text-caption text-charcoal transition-colors hover:border-charcoal"
                      aria-label={`Download payslip for ${l.employeeFullName}`}
                    >
                      <Download className="h-3 w-3" aria-hidden />
                      PDF
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-surface-recessed/50">
              <tr>
                <td colSpan={2} className="px-4 py-3 font-medium text-charcoal">
                  Total
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-charcoal">
                  {formatLKR(run.grossCents)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                  {formatLKR(run.epfEmployeeCents)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                  {formatLKR(run.payeCents)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-charcoal">
                  {formatLKR(run.netPayCents)}
                </td>
                <td className="px-4 py-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {run.journalEntryId && (
        <section className="mt-6 rounded-card border-hairline border-mint bg-mint-surface/40 p-5">
          <p className="text-caption uppercase tracking-wide text-mint-dark">Ledger</p>
          <p className="mt-1 text-small text-charcoal">
            Posted to the general ledger. The journal splits gross into employer contributions
            (expense), statutory payables (EPF / ETF / PAYE), and net salaries payable.
          </p>
        </section>
      )}

      {run.notes && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Notes</p>
          <p className="mt-2 whitespace-pre-wrap text-small text-charcoal">{run.notes}</p>
        </section>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
  emphasize,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "mint";
  emphasize?: boolean;
}) {
  return (
    <div
      className={`rounded-card border-hairline p-5 ${
        emphasize
          ? "border-charcoal bg-mint-surface/60"
          : "border-border bg-surface-elevated"
      }`}
    >
      <p className="text-caption uppercase tracking-wide text-text-tertiary">{label}</p>
      <p
        className={`tabular-nums mt-2 text-h2 text-charcoal ${tone === "mint" ? "text-mint-dark" : ""}`}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-caption text-text-secondary">{sub}</p>}
    </div>
  );
}
