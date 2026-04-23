import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangle, ExternalLink } from "lucide-react";
import type { Account, GeneralLedger } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "General ledger" };

const typeOrder: Record<Account["accountType"], number> = {
  asset: 1,
  liability: 2,
  equity: 3,
  income: 4,
  expense: 5,
};

const typeLabel: Record<Account["accountType"], string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  income: "Income",
  expense: "Expenses",
};

async function fetchCoa(): Promise<Account[]> {
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/coa`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { accounts: Account[] };
  return data.accounts;
}

async function fetchLedger({
  accountId,
  from,
  to,
}: {
  accountId: string;
  from?: string;
  to?: string;
}): Promise<GeneralLedger | null> {
  const params = new URLSearchParams({ accountId });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/reports/general-ledger?${params.toString()}`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return null;
  return (await res.json()) as GeneralLedger;
}

function firstOfMonthISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function GeneralLedgerPage({
  searchParams,
}: {
  searchParams: { accountId?: string; from?: string; to?: string };
}) {
  const accounts = (await fetchCoa()).filter((a) => a.isActive);

  // Group CoA by type for the <optgroup> picker
  const groupedAccounts = new Map<Account["accountType"], Account[]>();
  for (const a of accounts) {
    const arr = groupedAccounts.get(a.accountType) ?? [];
    arr.push(a);
    groupedAccounts.set(a.accountType, arr);
  }
  const orderedAccountGroups = Array.from(groupedAccounts.entries()).sort(
    (a, b) => typeOrder[a[0]] - typeOrder[b[0]],
  );

  const from = searchParams.from ?? firstOfMonthISO();
  const to = searchParams.to ?? todayISO();
  const accountId = searchParams.accountId;

  const ledger = accountId ? await fetchLedger({ accountId, from, to }) : null;

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Reports"
        title="General ledger"
        description="Drill into any account and trace every debit and credit that moved its balance."
      />

      <form className="mt-6 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] md:items-end">
        <div>
          <label htmlFor="accountId" className="block text-caption uppercase tracking-wide text-text-tertiary">
            Account
          </label>
          <select
            id="accountId"
            name="accountId"
            defaultValue={accountId ?? ""}
            className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
          >
            <option value="" disabled>
              Pick an account…
            </option>
            {orderedAccountGroups.map(([type, rows]) => (
              <optgroup key={type} label={typeLabel[type]}>
                {rows.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="from" className="block text-caption uppercase tracking-wide text-text-tertiary">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={from}
            className="mt-1.5 rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="to" className="block text-caption uppercase tracking-wide text-text-tertiary">
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={to}
            className="mt-1.5 rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
          />
        </div>
        <button type="submit" className="btn-secondary text-small">
          Apply
        </button>
        {accountId && (
          <a href="/app/reports/general-ledger" className="btn-link text-small">
            Clear
          </a>
        )}
      </form>

      {!ledger && !accountId && (
        <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <p className="text-body text-text-secondary">
            Pick an account above to see its ledger activity.
          </p>
        </div>
      )}

      {accountId && !ledger && (
        <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <p className="text-body text-text-secondary">Couldn't load the ledger.</p>
        </div>
      )}

      {ledger && <LedgerView ledger={ledger} />}
    </main>
  );
}

function LedgerView({ ledger }: { ledger: GeneralLedger }) {
  const { account, lines } = ledger;
  const periodLabel = (() => {
    if (ledger.asOfFrom && ledger.asOfTo)
      return `${formatDate(ledger.asOfFrom)} — ${formatDate(ledger.asOfTo)}`;
    if (ledger.asOfTo) return `Through ${formatDate(ledger.asOfTo)}`;
    if (ledger.asOfFrom) return `From ${formatDate(ledger.asOfFrom)}`;
    return "All time (inception to date)";
  })();

  return (
    <>
      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Opening balance"
          value={formatLKR(ledger.openingBalanceCents)}
          sub={ledger.asOfFrom ? `As at ${formatDate(ledger.asOfFrom)}` : "Before any activity"}
        />
        <SummaryCard
          label="Period movement"
          value={`DR ${formatLKR(ledger.totalDebitsCents)} · CR ${formatLKR(ledger.totalCreditsCents)}`}
          sub={`${lines.length} ${lines.length === 1 ? "line" : "lines"} · ${periodLabel}`}
        />
        <SummaryCard
          label="Closing balance"
          value={formatLKR(ledger.closingBalanceCents)}
          sub={`${account.code} · ${account.name}`}
          emphasis
        />
      </section>

      {ledger.truncated && (
        <div className="mt-4 flex items-center gap-3 rounded-card border-hairline border-warning-accent/40 bg-warning-bg/60 px-5 py-3">
          <AlertTriangle className="h-4 w-4 flex-none text-warning-accent" aria-hidden />
          <p className="text-small text-charcoal">
            Showing the first {lines.length.toLocaleString()} lines. Narrow the date range to see the rest.
          </p>
        </div>
      )}

      <section className="mt-6 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <table className="w-full text-small">
          <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="w-28 px-4 py-3 text-left">Date</th>
              <th className="w-32 px-4 py-3 text-left">Entry</th>
              <th className="px-4 py-3 text-left">Description</th>
              <th className="w-32 px-4 py-3 text-right">Debit</th>
              <th className="w-32 px-4 py-3 text-right">Credit</th>
              <th className="w-36 px-4 py-3 text-right">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            <tr className="bg-surface-recessed/40">
              <td className="px-4 py-2" />
              <td className="px-4 py-2 text-caption text-text-secondary" colSpan={3}>
                Opening balance
              </td>
              <td className="px-4 py-2" />
              <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                {formatLKR(ledger.openingBalanceCents)}
              </td>
            </tr>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-text-tertiary">
                  No activity on this account in the selected period.
                </td>
              </tr>
            ) : (
              lines.map((l) => (
                <tr key={`${l.journalEntryId}-${l.lineNo}`}>
                  <td className="px-4 py-3 tabular-nums text-text-secondary">
                    {formatDate(l.entryDate)}
                  </td>
                  <td className="px-4 py-3">
                    <p className="tabular-nums text-charcoal">{l.entryNumber}</p>
                    {l.sourceType && (() => {
                      // Deep-link to the source document when we have one
                      // registered for this sourceType. Roadmap #48.
                      const href = deepLinkForSource(l.sourceType, l.sourceId);
                      const label = sourceLabel(l.sourceType);
                      return href ? (
                        <Link
                          href={href}
                          className="mt-0.5 inline-flex items-center gap-1 text-caption text-mint-dark underline-offset-2 hover:underline"
                          title={`Open source ${label.toLowerCase()}`}
                        >
                          {label}
                          <ExternalLink className="h-3 w-3" aria-hidden />
                        </Link>
                      ) : (
                        <p className="text-caption text-text-tertiary">{label}</p>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-text-primary">{l.description ?? <span className="text-text-tertiary">—</span>}</p>
                    {l.memo && l.memo !== l.description && (
                      <p className="text-caption text-text-tertiary">{l.memo}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {l.drCents > 0 ? formatLKR(l.drCents) : <span className="text-text-tertiary">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {l.crCents > 0 ? formatLKR(l.crCents) : <span className="text-text-tertiary">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                    {formatLKR(l.runningBalanceCents)}
                  </td>
                </tr>
              ))
            )}
            <tr className="bg-surface-recessed font-medium">
              <td className="px-4 py-3" />
              <td className="px-4 py-3 text-charcoal" colSpan={2}>
                Closing balance
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                {formatLKR(ledger.totalDebitsCents)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                {formatLKR(ledger.totalCreditsCents)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                {formatLKR(ledger.closingBalanceCents)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: string;
  sub: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-card border-hairline p-5 ${
        emphasis
          ? "border-charcoal/20 bg-mint-surface/40"
          : "border-border bg-surface-elevated"
      }`}
    >
      <p className="text-caption uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className="tabular-nums mt-2 text-h3 text-charcoal">{value}</p>
      <p className="mt-1 text-caption text-text-secondary">{sub}</p>
    </div>
  );
}

function sourceLabel(s: string): string {
  const map: Record<string, string> = {
    invoice: "Sales invoice",
    invoice_void: "Invoice void",
    bad_debt_writeoff: "Bad-debt writeoff",
    bad_debt_writeoff_reversal: "Bad-debt reversal",
    bill: "Supplier bill",
    bill_void: "Bill void",
    credit_note: "Credit note",
    debit_note: "Debit note",
    customer_payment: "Customer payment",
    supplier_payment: "Supplier payment",
    payroll_run: "Payroll run",
    payroll_disbursement: "Payroll disbursement",
    payroll_payment: "Payroll disbursement",
    payroll_void: "Payroll void",
    final_settlement: "Final settlement",
    bonus_run: "Bonus run",
    bonus_run_void: "Bonus void",
    expense_claim: "Expense claim",
    employee_loan: "Employee loan",
    statutory_remittance: "EPF/ETF/PAYE payment",
    wht_remit: "WHT remittance",
    manual: "Manual journal",
    recurring_journal: "Recurring journal",
    opening_balance: "Opening balance",
    year_close: "Year-end close",
    fx_revaluation: "FX revaluation",
    fx_revaluation_void: "FX reval void",
    delivery_note: "Delivery note",
    pos_shift: "POS shift",
    petty_cash_float: "Petty cash float",
    petty_cash_transaction: "Petty cash txn",
    petty_cash_top_up_request: "Petty cash top-up",
    petty_cash_reconciliation: "Petty cash recon",
    depreciation_run: "Depreciation run",
    stock_count: "Stock count",
    stock_movement: "Stock movement",
    cheque: "Cheque",
    cheque_clear: "Cheque clearing",
    cheque_bounce: "Cheque bounce",
  };
  return map[s] ?? s;
}

// Deep-link table for drill-through from a GL line to its source document.
// Roadmap #48. Returns null when no sensible detail page exists (or when
// the page is list-only and a detail route hasn't shipped yet); the UI
// falls back to a plain label in that case.
//
// A couple of intentional gaps worth flagging:
//
//  * customer_payment / supplier_payment — today /app/payments and
//    /app/supplier-payments are list-only, no `[id]` route. We return
//    null rather than deep-link to the list and make the user hunt.
//  * petty_cash_transaction — the source id is the transaction row, but
//    our detail page is the *float* it lives on. We'd need a new route
//    (or to resolve txn→float on the API side) to make this work.
//  * depreciation_run / year_close / opening_balance — no detail UI
//    exists today; these will always be labels, not links.
function deepLinkForSource(
  sourceType: string | null | undefined,
  sourceId: string | null | undefined,
): string | null {
  if (!sourceType || !sourceId) return null;
  const routes: Record<string, (id: string) => string> = {
    invoice: (id) => `/app/invoices/${id}`,
    invoice_void: (id) => `/app/invoices/${id}`,
    bad_debt_writeoff: (id) => `/app/invoices/${id}`,
    bad_debt_writeoff_reversal: (id) => `/app/invoices/${id}`,
    bill: (id) => `/app/bills/${id}`,
    bill_void: (id) => `/app/bills/${id}`,
    credit_note: (id) => `/app/credit-notes/${id}`,
    debit_note: (id) => `/app/debit-notes/${id}`,
    delivery_note: (id) => `/app/delivery-notes/${id}`,
    manual: (id) => `/app/journals/${id}`,
    payroll_run: (id) => `/app/payroll/${id}`,
    payroll_disbursement: (id) => `/app/payroll/${id}`,
    payroll_payment: (id) => `/app/payroll/${id}`,
    payroll_void: (id) => `/app/payroll/${id}`,
    final_settlement: (id) => `/app/final-settlements/${id}`,
    bonus_run: (id) => `/app/bonus-runs/${id}`,
    bonus_run_void: (id) => `/app/bonus-runs/${id}`,
    expense_claim: (id) => `/app/expense-claims/${id}`,
    employee_loan: (id) => `/app/staff-loans/${id}`,
    stock_count: (id) => `/app/stock/counts/${id}`,
    pos_shift: (id) => `/app/pos/shifts/${id}`,
    petty_cash_float: (id) => `/app/petty-cash/${id}`,
    cheque: (id) => `/app/cheques/${id}`,
    cheque_bounce: (id) => `/app/cheques/${id}`,
    cheque_clear: (id) => `/app/cheques/${id}`,
  };
  const builder = routes[sourceType];
  return builder ? builder(sourceId) : null;
}
