"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Loader2,
  MinusCircle,
  Plus,
  PlusCircle,
  Receipt,
  RefreshCw,
  Undo2,
  Wallet,
  X,
} from "lucide-react";
import {
  api,
  ApiError,
  type Account,
  type Branch,
  type EmployeeListRow,
  type PettyCashFloatRow,
  type PettyCashReconciliationRow,
  type PettyCashTopUpRequestRow,
  type PettyCashTransactionRow,
  type PettyCashTxnType,
  type UserWithRoles,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { AttachmentsPanel } from "@/components/app/attachments-panel";
import { formatLKR, formatDate } from "@/lib/format";

type Tab = "ledger" | "top-ups" | "reconciliations";

function rupeesToCents(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? Math.max(0, Math.round(v * 100)) : 0;
}

const TXN_LABELS: Record<PettyCashTxnType, string> = {
  expense: "Expense",
  advance_out: "Advance out",
  advance_return: "Advance return",
  top_up: "Top-up",
  variance_short: "Short",
  variance_over: "Over",
  close_transfer: "Close transfer",
};

const TXN_DIRECTION: Record<PettyCashTxnType, "in" | "out"> = {
  expense: "out",
  advance_out: "out",
  advance_return: "in",
  top_up: "in",
  variance_short: "out",
  variance_over: "in",
  close_transfer: "out",
};

export function PettyCashDetailClient({
  float,
  transactions,
  requests,
  reconciliations,
  accounts,
  employees,
  users,
  branches,
}: {
  float: PettyCashFloatRow;
  transactions: PettyCashTransactionRow[];
  requests: PettyCashTopUpRequestRow[];
  reconciliations: PettyCashReconciliationRow[];
  accounts: Account[];
  employees: EmployeeListRow[];
  users: UserWithRoles[];
  branches: Branch[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("ledger");
  const [modal, setModal] = useState<
    | { kind: "expense" }
    | { kind: "advance-out" }
    | { kind: "advance-return" }
    | { kind: "top-up-request" }
    | { kind: "reconcile" }
    | { kind: "post-top-up"; request: PettyCashTopUpRequestRow }
    | { kind: "close" }
    | null
  >(null);

  const branchName = branches.find((b) => b.id === float.branchId)?.name ?? "—";
  const holder = users.find((u) => u.id === float.floatHolderUserId);
  const holderLabel = holder ? holder.fullName ?? holder.email : "—";

  const expenseAccounts = useMemo(
    () => accounts.filter((a) => a.accountType === "expense" && a.isActive),
    [accounts],
  );
  const assetAccounts = useMemo(
    () => accounts.filter((a) => a.accountType === "asset" && a.isActive),
    [accounts],
  );
  const cashBankAccounts = useMemo(
    () =>
      assetAccounts.filter(
        (a) =>
          (a.accountSubtype === "cash" || a.accountSubtype === "bank") &&
          a.code !== "1005",
      ),
    [assetAccounts],
  );
  // Staff advance accounts live in assets; tenants pick whichever asset
  // account they use for employee advances (usually 1400-series).
  const staffAdvanceAccounts = assetAccounts;

  const refresh = () => router.refresh();

  async function closeModal() {
    setModal(null);
    refresh();
  }

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link
          href="/app/petty-cash"
          className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-charcoal"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          Back to petty cash
        </Link>
      </div>
      <PageHeader
        title={float.name}
        description={`${branchName} · Holder ${holderLabel}`}
        action={
          float.status === "active" ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setModal({ kind: "expense" })}
                className="btn-secondary"
              >
                <MinusCircle className="h-4 w-4" aria-hidden />
                Expense
              </button>
              <button
                onClick={() => setModal({ kind: "advance-out" })}
                className="btn-secondary"
              >
                <Wallet className="h-4 w-4" aria-hidden />
                Advance out
              </button>
              <button
                onClick={() => setModal({ kind: "top-up-request" })}
                className="btn-primary"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Top-up
              </button>
            </div>
          ) : (
            <span className="text-small text-text-tertiary">Closed</span>
          )
        }
      />

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <KpiCard
          label="Balance"
          value={formatLKR(float.currentBalanceCents)}
          emphasis
        />
        <KpiCard label="Ceiling" value={formatLKR(float.ceilingCents)} />
        <KpiCard
          label="Opened"
          value={formatDate(float.openedAt)}
          sub={float.status === "closed" ? `Closed ${formatDate(float.closedAt ?? "")}` : undefined}
        />
      </section>

      {float.status === "active" && (
        <section className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => setModal({ kind: "advance-return" })}
            className="btn-ghost"
          >
            <Undo2 className="h-4 w-4" aria-hidden />
            Advance return
          </button>
          <button
            onClick={() => setModal({ kind: "reconcile" })}
            className="btn-ghost"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Reconcile EOD
          </button>
          <button
            onClick={() => setModal({ kind: "close" })}
            className="btn-ghost ml-auto text-danger"
          >
            Close float
          </button>
        </section>
      )}

      <nav className="mt-8 flex gap-1 border-b-hairline border-border">
        {(
          [
            { id: "ledger", label: "Ledger", count: transactions.length },
            { id: "top-ups", label: "Top-ups", count: requests.length },
            {
              id: "reconciliations",
              label: "Reconciliations",
              count: reconciliations.length,
            },
          ] as Array<{ id: Tab; label: string; count: number }>
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`border-b-2 px-3 py-2 text-small transition-colors ${
              tab === t.id
                ? "border-charcoal text-charcoal"
                : "border-transparent text-text-tertiary hover:text-charcoal"
            }`}
          >
            {t.label}{" "}
            <span className="ml-1 text-caption text-text-tertiary">
              ({t.count})
            </span>
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {tab === "ledger" && (
          <LedgerTab
            transactions={transactions}
            accounts={accounts}
            employees={employees}
            floatActive={float.status === "active"}
            onVoid={refresh}
          />
        )}
        {tab === "top-ups" && (
          <TopUpsTab
            requests={requests}
            users={users}
            floatActive={float.status === "active"}
            onPost={(r) => setModal({ kind: "post-top-up", request: r })}
            onRefresh={refresh}
          />
        )}
        {tab === "reconciliations" && (
          <ReconciliationsTab reconciliations={reconciliations} />
        )}
      </div>

      {modal?.kind === "expense" && (
        <ExpenseModal
          floatId={float.id}
          accounts={expenseAccounts}
          onClose={closeModal}
        />
      )}
      {modal?.kind === "advance-out" && (
        <AdvanceModal
          direction="out"
          floatId={float.id}
          staffAdvanceAccounts={staffAdvanceAccounts}
          employees={employees}
          onClose={closeModal}
        />
      )}
      {modal?.kind === "advance-return" && (
        <AdvanceModal
          direction="return"
          floatId={float.id}
          staffAdvanceAccounts={staffAdvanceAccounts}
          employees={employees}
          onClose={closeModal}
        />
      )}
      {modal?.kind === "top-up-request" && (
        <TopUpRequestModal floatId={float.id} onClose={closeModal} />
      )}
      {modal?.kind === "post-top-up" && (
        <PostTopUpModal
          request={modal.request}
          cashBankAccounts={cashBankAccounts}
          onClose={closeModal}
        />
      )}
      {modal?.kind === "reconcile" && (
        <ReconcileModal
          floatId={float.id}
          expectedBalanceCents={float.currentBalanceCents}
          onClose={closeModal}
        />
      )}
      {modal?.kind === "close" && (
        <CloseFloatModal
          float={float}
          cashBankAccounts={cashBankAccounts}
          onClose={() => {
            setModal(null);
            router.push("/app/petty-cash");
            router.refresh();
          }}
        />
      )}
    </main>
  );
}

// ============================================================================
// Tabs
// ============================================================================

function LedgerTab({
  transactions,
  accounts,
  employees,
  floatActive,
  onVoid,
}: {
  transactions: PettyCashTransactionRow[];
  accounts: Account[];
  employees: EmployeeListRow[];
  floatActive: boolean;
  onVoid: () => void;
}) {
  const accountMap = new Map(
    accounts.map((a) => [a.id, `${a.code} · ${a.name}`]),
  );
  const employeeMap = new Map(employees.map((e) => [e.id, e.fullName]));

  if (transactions.length === 0) {
    return (
      <EmptyRow
        icon={<Receipt className="h-5 w-5" />}
        title="No transactions yet."
        body="Expenses, advances, and top-ups will appear here."
      />
    );
  }

  return (
    <div className="space-y-3">
      {transactions.map((t) => {
        const dir = TXN_DIRECTION[t.txnType];
        const account = t.categoryAccountId
          ? accountMap.get(t.categoryAccountId)
          : t.counterpartyAccountId
            ? accountMap.get(t.counterpartyAccountId)
            : null;
        const employee = t.counterpartyEmployeeId
          ? employeeMap.get(t.counterpartyEmployeeId)
          : null;
        const voidable =
          floatActive &&
          !t.voidedAt &&
          t.txnType !== "variance_short" &&
          t.txnType !== "variance_over" &&
          t.txnType !== "close_transfer";
        return (
          <article
            key={t.id}
            className={`rounded-card border-hairline p-4 ${
              t.voidedAt
                ? "border-border bg-surface-recessed/40 opacity-60"
                : "border-border bg-surface-elevated"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-caption text-text-tertiary">
                  <span className="font-medium uppercase tracking-wide">
                    {TXN_LABELS[t.txnType]}
                  </span>
                  <span>·</span>
                  <span>{formatDate(t.txnDate)}</span>
                  {t.voidedAt && (
                    <span className="rounded-full bg-danger-bg px-2 py-0.5 text-micro uppercase text-danger">
                      Voided
                    </span>
                  )}
                </div>
                <p className="mt-1 text-body text-charcoal">{t.description}</p>
                <p className="mt-1 text-caption text-text-secondary">
                  {account ?? "—"}
                  {employee && ` · ${employee}`}
                  {t.receiptNumber && ` · receipt ${t.receiptNumber}`}
                </p>
                <div className="mt-3">
                  <AttachmentsPanel
                    entityType="petty_cash_transaction"
                    entityId={t.id}
                  />
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <p
                  className={`tabular-nums text-h4 ${
                    dir === "in" ? "text-mint-dark" : "text-charcoal"
                  }`}
                >
                  {dir === "in" ? "+" : "−"}
                  {formatLKR(t.amountCents)}
                </p>
                {voidable && (
                  <VoidButton transactionId={t.id} onVoid={onVoid} />
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function VoidButton({
  transactionId,
  onVoid,
}: {
  transactionId: string;
  onVoid: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doVoid() {
    const reason = window.prompt("Reason for voiding this transaction?");
    if (!reason || !reason.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await api.voidPettyCashTransaction(transactionId, {
        reason: reason.trim(),
        reversalDate: new Date().toISOString().slice(0, 10),
      });
      onVoid();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Void failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-caption text-danger">{error}</span>}
      <button
        onClick={doVoid}
        disabled={busy}
        className="text-caption text-text-tertiary hover:text-danger disabled:opacity-50"
      >
        {busy ? "Voiding…" : "Void"}
      </button>
    </div>
  );
}

function TopUpsTab({
  requests,
  users,
  floatActive,
  onPost,
  onRefresh,
}: {
  requests: PettyCashTopUpRequestRow[];
  users: UserWithRoles[];
  floatActive: boolean;
  onPost: (r: PettyCashTopUpRequestRow) => void;
  onRefresh: () => void;
}) {
  const userMap = new Map(users.map((u) => [u.id, u.fullName ?? u.email]));

  if (requests.length === 0) {
    return (
      <EmptyRow
        icon={<PlusCircle className="h-5 w-5" />}
        title="No top-up requests yet."
        body="Holder requests replenishment; approver posts it against a cash or bank source."
      />
    );
  }

  return (
    <div className="space-y-3">
      {requests.map((r) => (
        <TopUpRow
          key={r.id}
          r={r}
          requester={userMap.get(r.requestedByUserId) ?? "—"}
          decider={r.decidedByUserId ? userMap.get(r.decidedByUserId) : null}
          floatActive={floatActive}
          onPost={onPost}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}

function TopUpRow({
  r,
  requester,
  decider,
  floatActive,
  onPost,
  onRefresh,
}: {
  r: PettyCashTopUpRequestRow;
  requester: string;
  decider: string | null | undefined;
  floatActive: boolean;
  onPost: (r: PettyCashTopUpRequestRow) => void;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState<"approve" | "reject" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "approve" | "reject" | "cancel") {
    setError(null);
    setBusy(action);
    try {
      if (action === "approve") await api.approvePettyCashTopUpRequest(r.id);
      else if (action === "reject") {
        const notes = window.prompt("Reason for rejection?") ?? "";
        await api.rejectPettyCashTopUpRequest(r.id, { decisionNotes: notes });
      } else await api.cancelPettyCashTopUpRequest(r.id);
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  const pillClass =
    r.status === "pending"
      ? "bg-warning-bg text-warning"
      : r.status === "approved"
        ? "bg-mint-surface text-mint-dark"
        : r.status === "posted"
          ? "bg-charcoal/10 text-charcoal"
          : "bg-surface-recessed text-text-secondary";

  return (
    <article className="rounded-card border-hairline border-border bg-surface-elevated p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-micro font-medium uppercase ${pillClass}`}
            >
              {r.status}
            </span>
            <span className="text-caption text-text-tertiary">
              {formatDate(r.requestedAt)} · by {requester}
            </span>
          </div>
          <p className="mt-2 text-body text-charcoal">{r.reason}</p>
          {decider && (
            <p className="mt-1 text-caption text-text-secondary">
              Decided by {decider}
              {r.decisionNotes ? ` · "${r.decisionNotes}"` : ""}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <p className="tabular-nums text-h4 text-charcoal">
            {formatLKR(r.requestedAmountCents)}
          </p>
          {floatActive && (
            <div className="flex items-center gap-2">
              {r.status === "pending" && (
                <>
                  <button
                    onClick={() => decide("approve")}
                    disabled={!!busy}
                    className="text-caption text-mint-dark hover:underline disabled:opacity-50"
                  >
                    {busy === "approve" ? "…" : "Approve"}
                  </button>
                  <button
                    onClick={() => decide("reject")}
                    disabled={!!busy}
                    className="text-caption text-danger hover:underline disabled:opacity-50"
                  >
                    {busy === "reject" ? "…" : "Reject"}
                  </button>
                  <button
                    onClick={() => decide("cancel")}
                    disabled={!!busy}
                    className="text-caption text-text-tertiary hover:underline disabled:opacity-50"
                  >
                    {busy === "cancel" ? "…" : "Cancel"}
                  </button>
                </>
              )}
              {r.status === "approved" && (
                <button
                  onClick={() => onPost(r)}
                  className="btn-primary py-1 text-caption"
                >
                  Post
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-caption text-danger">{error}</p>}
    </article>
  );
}

function ReconciliationsTab({
  reconciliations,
}: {
  reconciliations: PettyCashReconciliationRow[];
}) {
  if (reconciliations.length === 0) {
    return (
      <EmptyRow
        icon={<RefreshCw className="h-5 w-5" />}
        title="No reconciliations yet."
        body="Record an end-of-day physical count to book variance to Cash Over/Short."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
      <table className="w-full text-small">
        <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
          <tr>
            <th className="px-4 py-3 text-left">Date</th>
            <th className="px-4 py-3 text-right">Opening</th>
            <th className="px-4 py-3 text-right">In</th>
            <th className="px-4 py-3 text-right">Out</th>
            <th className="px-4 py-3 text-right">Expected</th>
            <th className="px-4 py-3 text-right">Counted</th>
            <th className="px-4 py-3 text-right">Variance</th>
          </tr>
        </thead>
        <tbody className="divide-y-hairline divide-border">
          {reconciliations.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-3 text-text-secondary">
                {formatDate(r.reconDate)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                {formatLKR(r.openingBalanceCents)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-mint-dark">
                +{formatLKR(r.movementsInCents)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                −{formatLKR(r.movementsOutCents)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                {formatLKR(r.expectedCloseCents)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                {formatLKR(r.countedCents)}
              </td>
              <td
                className={`px-4 py-3 text-right tabular-nums ${
                  r.varianceCents === 0
                    ? "text-text-secondary"
                    : r.varianceCents < 0
                      ? "text-danger"
                      : "text-mint-dark"
                }`}
              >
                {r.varianceCents === 0
                  ? "—"
                  : `${r.varianceCents < 0 ? "−" : "+"}${formatLKR(
                      Math.abs(r.varianceCents),
                    )}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Modals
// ============================================================================

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-card border-hairline border-border bg-surface-elevated p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-h4 text-charcoal">{title}</h2>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-charcoal"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ExpenseModal({
  floatId,
  accounts,
  onClose,
}: {
  floatId: string;
  accounts: Account[];
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [txnDate, setTxnDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState(accounts[0]?.id ?? "");
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const cents = rupeesToCents(amount);
    if (cents <= 0) return setError("Amount must be > 0.");
    if (!description.trim()) return setError("Describe the expense.");
    if (!categoryId) return setError("Pick an expense category.");
    setBusy(true);
    try {
      await api.postPettyCashExpense({
        pettyCashFloatId: floatId,
        amountCents: cents,
        txnDate,
        description: description.trim(),
        categoryAccountId: categoryId,
        ...(receipt.trim() ? { receiptNumber: receipt.trim() } : {}),
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Posting failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Record expense" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <LabeledInput
          label="Amount (LKR)"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={setAmount}
        />
        <LabeledInput
          label="Date"
          type="date"
          value={txnDate}
          onChange={setTxnDate}
        />
        <LabeledInput
          label="Description"
          value={description}
          onChange={setDescription}
        />
        <LabeledSelect
          label="Expense category"
          value={categoryId}
          onChange={setCategoryId}
          options={accounts.map((a) => ({
            value: a.id,
            label: `${a.code} · ${a.name}`,
          }))}
        />
        <LabeledInput
          label="Receipt number (optional)"
          value={receipt}
          onChange={setReceipt}
        />
        <SubmitBar busy={busy} error={error} onCancel={onClose} label="Post expense" />
      </form>
    </ModalShell>
  );
}

function AdvanceModal({
  direction,
  floatId,
  staffAdvanceAccounts,
  employees,
  onClose,
}: {
  direction: "out" | "return";
  floatId: string;
  staffAdvanceAccounts: Account[];
  employees: EmployeeListRow[];
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [txnDate, setTxnDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [accountId, setAccountId] = useState(staffAdvanceAccounts[0]?.id ?? "");
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const cents = rupeesToCents(amount);
    if (cents <= 0) return setError("Amount must be > 0.");
    if (!description.trim()) return setError("Describe the advance.");
    if (!accountId) return setError("Pick the staff advance account.");
    if (!employeeId) return setError("Pick the employee.");
    setBusy(true);
    try {
      const body = {
        pettyCashFloatId: floatId,
        amountCents: cents,
        txnDate,
        description: description.trim(),
        staffAdvanceAccountId: accountId,
        counterpartyEmployeeId: employeeId,
        ...(receipt.trim() ? { receiptNumber: receipt.trim() } : {}),
      };
      if (direction === "out") await api.postPettyCashAdvanceOut(body);
      else await api.postPettyCashAdvanceReturn(body);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Posting failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title={direction === "out" ? "Staff advance out" : "Advance return"}
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <LabeledInput
          label="Amount (LKR)"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={setAmount}
        />
        <LabeledInput
          label="Date"
          type="date"
          value={txnDate}
          onChange={setTxnDate}
        />
        <LabeledInput
          label="Description"
          value={description}
          onChange={setDescription}
        />
        <LabeledSelect
          label="Employee"
          value={employeeId}
          onChange={setEmployeeId}
          options={employees.map((e) => ({ value: e.id, label: e.fullName }))}
        />
        <LabeledSelect
          label="Staff advance account"
          value={accountId}
          onChange={setAccountId}
          options={staffAdvanceAccounts.map((a) => ({
            value: a.id,
            label: `${a.code} · ${a.name}`,
          }))}
        />
        <LabeledInput
          label="Receipt number (optional)"
          value={receipt}
          onChange={setReceipt}
        />
        <SubmitBar
          busy={busy}
          error={error}
          onCancel={onClose}
          label={direction === "out" ? "Post advance" : "Post return"}
        />
      </form>
    </ModalShell>
  );
}

function TopUpRequestModal({
  floatId,
  onClose,
}: {
  floatId: string;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const cents = rupeesToCents(amount);
    if (cents <= 0) return setError("Amount must be > 0.");
    if (!reason.trim()) return setError("Reason is required.");
    setBusy(true);
    try {
      await api.createPettyCashTopUpRequest({
        pettyCashFloatId: floatId,
        requestedAmountCents: cents,
        reason: reason.trim(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Request top-up" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <LabeledInput
          label="Requested amount (LKR)"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={setAmount}
        />
        <LabeledInput
          label="Reason"
          value={reason}
          onChange={setReason}
          hint="Explain why the float needs replenishing."
        />
        <SubmitBar busy={busy} error={error} onCancel={onClose} label="Submit request" />
      </form>
    </ModalShell>
  );
}

function PostTopUpModal({
  request,
  cashBankAccounts,
  onClose,
}: {
  request: PettyCashTopUpRequestRow;
  cashBankAccounts: Account[];
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(
    (request.requestedAmountCents / 100).toFixed(2),
  );
  const [sourceId, setSourceId] = useState(cashBankAccounts[0]?.id ?? "");
  const [txnDate, setTxnDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const cents = rupeesToCents(amount);
    if (cents <= 0) return setError("Amount must be > 0.");
    if (!sourceId) return setError("Pick the source account.");
    setBusy(true);
    try {
      await api.postPettyCashTopUpRequest(request.id, {
        txnDate,
        sourceAccountId: sourceId,
        amountCents: cents,
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Posting failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Post top-up" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <LabeledInput
          label="Amount (LKR)"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={setAmount}
          hint={`Requested ${formatLKR(request.requestedAmountCents)} · adjust if part-funding.`}
        />
        <LabeledInput
          label="Posting date"
          type="date"
          value={txnDate}
          onChange={setTxnDate}
        />
        <LabeledSelect
          label="Source account (cash or bank)"
          value={sourceId}
          onChange={setSourceId}
          options={cashBankAccounts.map((a) => ({
            value: a.id,
            label: `${a.code} · ${a.name}`,
          }))}
        />
        <SubmitBar busy={busy} error={error} onCancel={onClose} label="Post top-up" />
      </form>
    </ModalShell>
  );
}

function ReconcileModal({
  floatId,
  expectedBalanceCents,
  onClose,
}: {
  floatId: string;
  expectedBalanceCents: number;
  onClose: () => void;
}) {
  const [reconDate, setReconDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [counted, setCounted] = useState(
    (expectedBalanceCents / 100).toFixed(2),
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const countedCents = rupeesToCents(counted);
  const variance = countedCents - expectedBalanceCents;

  async function submit() {
    setError(null);
    if (countedCents < 0) return setError("Count can't be negative.");
    if (variance !== 0 && !reason.trim()) {
      return setError("Reason is required when variance is non-zero.");
    }
    setBusy(true);
    try {
      await api.createPettyCashReconciliation({
        pettyCashFloatId: floatId,
        reconDate,
        countedCents,
        ...(reason.trim() ? { varianceReason: reason.trim() } : {}),
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reconciliation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="End-of-day reconciliation" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <LabeledInput
          label="Recon date"
          type="date"
          value={reconDate}
          onChange={setReconDate}
        />
        <LabeledInput
          label="Counted cash (LKR)"
          type="number"
          min="0"
          step="0.01"
          value={counted}
          onChange={setCounted}
          hint={`System expects ${formatLKR(expectedBalanceCents)}.`}
        />
        <div
          className={`rounded-card border-hairline p-3 text-small ${
            variance === 0
              ? "border-border bg-surface-recessed/40 text-text-secondary"
              : variance < 0
                ? "border-danger/30 bg-danger-bg/40 text-danger"
                : "border-mint/40 bg-mint-surface/40 text-mint-dark"
          }`}
        >
          Variance:{" "}
          <span className="tabular-nums font-medium">
            {variance === 0
              ? formatLKR(0)
              : `${variance < 0 ? "−" : "+"}${formatLKR(Math.abs(variance))}`}
          </span>{" "}
          {variance !== 0 &&
            ` — will book to 5190 Cash Over/Short as ${variance < 0 ? "short" : "over"}.`}
        </div>
        {variance !== 0 && (
          <LabeledInput
            label="Variance reason"
            value={reason}
            onChange={setReason}
          />
        )}
        <SubmitBar busy={busy} error={error} onCancel={onClose} label="Reconcile" />
      </form>
    </ModalShell>
  );
}

function CloseFloatModal({
  float,
  cashBankAccounts,
  onClose,
}: {
  float: PettyCashFloatRow;
  cashBankAccounts: Account[];
  onClose: () => void;
}) {
  const [destId, setDestId] = useState(cashBankAccounts[0]?.id ?? "");
  const [closeDate, setCloseDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsDest = float.currentBalanceCents > 0;

  async function submit() {
    setError(null);
    if (needsDest && !destId) {
      return setError("Pick where the remaining balance should go.");
    }
    setBusy(true);
    try {
      await api.closePettyCashFloat(float.id, {
        closeDate,
        ...(needsDest ? { destinationAccountId: destId } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Close failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Close float" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-small text-text-secondary">
          Remaining balance:{" "}
          <span className="tabular-nums font-medium text-charcoal">
            {formatLKR(float.currentBalanceCents)}
          </span>
        </p>
        <LabeledInput
          label="Close date"
          type="date"
          value={closeDate}
          onChange={setCloseDate}
        />
        {needsDest && (
          <LabeledSelect
            label="Transfer remaining balance to"
            value={destId}
            onChange={setDestId}
            options={cashBankAccounts.map((a) => ({
              value: a.id,
              label: `${a.code} · ${a.name}`,
            }))}
          />
        )}
        <LabeledInput
          label="Reason (optional)"
          value={reason}
          onChange={setReason}
        />
        <SubmitBar busy={busy} error={error} onCancel={onClose} label="Close float" />
      </form>
    </ModalShell>
  );
}

// ============================================================================
// Small UI primitives
// ============================================================================

function KpiCard({
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
        emphasis
          ? "border-charcoal/20 bg-mint-surface/40"
          : "border-border bg-surface-elevated"
      }`}
    >
      <p className="text-caption uppercase tracking-wide text-text-tertiary">
        {label}
      </p>
      <p className="tabular-nums mt-2 text-h3 text-charcoal">{value}</p>
      {sub && <p className="mt-1 text-caption text-text-secondary">{sub}</p>}
    </div>
  );
}

function EmptyRow({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
        {icon}
      </div>
      <p className="text-body text-charcoal">{title}</p>
      <p className="mt-1 text-small text-text-secondary">{body}</p>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  hint,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <label className="block">
      <span className="block text-caption uppercase tracking-wide text-text-tertiary">
        {label}
      </span>
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input w-full mt-1.5"
      />
      {hint && <p className="mt-1 text-caption text-text-tertiary">{hint}</p>}
    </label>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className="block text-caption uppercase tracking-wide text-text-tertiary">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input w-full mt-1.5"
      >
        <option value="" disabled>
          Select…
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SubmitBar({
  busy,
  error,
  onCancel,
  label,
}: {
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  label: string;
}) {
  return (
    <>
      {error && <p className="text-small text-danger">{error}</p>}
      <div className="flex items-center justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="btn-ghost">
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {label}
        </button>
      </div>
    </>
  );
}
