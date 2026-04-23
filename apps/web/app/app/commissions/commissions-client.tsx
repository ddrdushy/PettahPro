"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BadgePercent,
  Coins,
  Loader2,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  api,
  ApiError,
  type CommissionEarning,
  type CommissionEarningStatus,
  type CommissionFormula,
  type CommissionLedgerRow,
  type CommissionRule,
  type CommissionSalesperson,
  type CommissionTriggerEvent,
  type CreateCommissionRule,
  type UserWithRoles,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR } from "@/lib/format";

type TabKey = "rules" | "salespeople" | "earnings" | "ledger";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "rules", label: "Rules" },
  { key: "salespeople", label: "Salespeople" },
  { key: "earnings", label: "Earnings" },
  { key: "ledger", label: "Ledger" },
];

const TRIGGER_LABELS: Record<CommissionTriggerEvent, string> = {
  invoice_posted: "On invoice post",
  payment_received: "On payment received",
};

const FORMULA_LABELS: Record<CommissionFormula, string> = {
  flat_pct: "Flat %",
  tiered_volume: "Tiered (monthly volume)",
};

const EARNING_STATUS_LABELS: Record<CommissionEarningStatus, string> = {
  accrued: "Accrued",
  paid: "Paid",
  clawed_back: "Clawed back",
  voided: "Voided",
};

function bpsToPct(bps: number | null | undefined): string {
  if (bps == null) return "—";
  return `${(bps / 100).toFixed(2)}%`;
}

function describeConfig(r: CommissionRule): string {
  if (r.formula === "flat_pct") {
    const bps = Number((r.config as { bps?: unknown }).bps);
    return Number.isFinite(bps) ? bpsToPct(bps) : "—";
  }
  if (r.formula === "tiered_volume") {
    const tiers = (r.config as { tiers?: Array<{ upToCents?: number | null; bps: number }> }).tiers;
    if (!Array.isArray(tiers)) return "—";
    return tiers
      .map((t) =>
        t.upToCents == null
          ? `${bpsToPct(t.bps)} above`
          : `≤ ${formatLKR(t.upToCents)}: ${bpsToPct(t.bps)}`,
      )
      .join(" · ");
  }
  return "—";
}

// ──────────────────────────────────────────────────────────────────────────

export function CommissionsClient({
  initialRules,
  initialSalespeople,
  initialEarnings,
  initialLedger,
}: {
  initialRules: CommissionRule[];
  initialSalespeople: CommissionSalesperson[];
  initialEarnings: CommissionEarning[];
  initialLedger: CommissionLedgerRow[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("rules");
  const [rules, setRules] = useState(initialRules);
  const [salespeople, setSalespeople] = useState(initialSalespeople);
  const [earnings, setEarnings] = useState(initialEarnings);
  const [ledger, setLedger] = useState(initialLedger);
  const [error, setError] = useState<string | null>(null);

  // Users list used by rule/salesperson pickers — fetched lazily.
  const [users, setUsers] = useState<UserWithRoles[] | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .listUsersWithRoles()
      .then((r) => {
        if (alive) setUsers(r.users);
      })
      .catch(() => {
        if (alive) setUsers([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const salespeopleByUserId = useMemo(() => {
    const m = new Map<string, CommissionSalesperson>();
    for (const s of salespeople) m.set(s.userId, s);
    return m;
  }, [salespeople]);

  async function refreshAll() {
    const [r, s, e, l] = await Promise.all([
      api.listCommissionRules(),
      api.listCommissionSalespeople(),
      api.listCommissionEarnings(),
      api.getCommissionLedger(),
    ]);
    setRules(r.rules);
    setSalespeople(s.salespeople);
    setEarnings(e.earnings);
    setLedger(l.ledger);
    router.refresh();
  }

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Sell"
        title="Commissions"
        description="Reward your salespeople. Define rules — flat % or tiered by monthly volume — and the engine accrues earnings on invoice post or payment receipt. Accrued commissions flow into the next payroll run as a COMMISSION earning."
      />

      <div className="mt-6 flex items-center gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`relative px-3 py-2 text-small font-medium transition ${
              tab === t.key
                ? "text-charcoal"
                : "text-text-secondary hover:text-charcoal"
            }`}
          >
            {t.label}
            {tab === t.key && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-mint-dark" />
            )}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-4 rounded-md bg-danger-bg px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}

      <section className="mt-6">
        {tab === "rules" && (
          <RulesTab
            rules={rules}
            onChanged={refreshAll}
            setError={setError}
          />
        )}
        {tab === "salespeople" && (
          <SalespeopleTab
            salespeople={salespeople}
            salespeopleByUserId={salespeopleByUserId}
            users={users}
            onChanged={refreshAll}
            setError={setError}
          />
        )}
        {tab === "earnings" && (
          <EarningsTab
            earnings={earnings}
            salespeople={salespeople}
            reload={async (filters) => {
              try {
                const r = await api.listCommissionEarnings(filters);
                setEarnings(r.earnings);
              } catch (err) {
                setError(
                  err instanceof ApiError ? err.message : "Couldn't load.",
                );
              }
            }}
          />
        )}
        {tab === "ledger" && <LedgerTab ledger={ledger} />}
      </section>
    </main>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Rules tab
// ──────────────────────────────────────────────────────────────────────────

function RulesTab({
  rules,
  onChanged,
  setError,
}: {
  rules: CommissionRule[];
  onChanged: () => Promise<void>;
  setError: (msg: string | null) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CommissionRule | null>(null);

  async function toggleStatus(r: CommissionRule) {
    setError(null);
    try {
      await api.updateCommissionRule(r.id, {
        status: r.status === "active" ? "inactive" : "active",
      });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update.");
    }
  }

  async function remove(r: CommissionRule) {
    setError(null);
    if (!confirm(`Archive rule "${r.name}"?`)) return;
    try {
      await api.deleteCommissionRule(r.id);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete.");
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-end">
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="btn-primary"
        >
          <Plus className="h-4 w-4" aria-hidden />
          New rule
        </button>
      </div>

      {showForm && (
        <RuleForm
          initial={editing}
          onClose={() => setShowForm(false)}
          onSaved={async () => {
            setShowForm(false);
            await onChanged();
          }}
          setError={setError}
        />
      )}

      {rules.length === 0 ? (
        <EmptyState
          icon={<BadgePercent className="h-5 w-5" />}
          title="No commission rules yet."
          body="Create a rule to start accruing commissions. Start with a flat percentage on invoice post, or a tiered volume rule to reward higher sellers."
        />
      ) : (
        <div className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="w-40 px-4 py-3 text-left">Trigger</th>
                <th className="w-40 px-4 py-3 text-left">Formula</th>
                <th className="px-4 py-3 text-left">Config</th>
                <th className="w-20 px-4 py-3 text-center">Priority</th>
                <th className="w-28 px-4 py-3 text-center">Status</th>
                <th className="w-20 px-4 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {rules.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(r);
                        setShowForm(true);
                      }}
                      className="text-left font-medium text-charcoal hover:underline"
                    >
                      {r.name}
                    </button>
                    {r.description && (
                      <p className="text-caption text-text-tertiary">
                        {r.description}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {TRIGGER_LABELS[r.triggerEvent]}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {FORMULA_LABELS[r.formula]}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {describeConfig(r)}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums text-text-secondary">
                    {r.priority}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => toggleStatus(r)}
                      className={`rounded-full px-2.5 py-0.5 text-caption font-medium transition ${
                        r.status === "active"
                          ? "bg-mint-surface text-mint-dark hover:bg-mint"
                          : "bg-surface-recessed text-text-secondary hover:bg-warning-bg"
                      }`}
                    >
                      {r.status === "active" ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => remove(r)}
                      className="text-text-tertiary hover:text-danger"
                      title="Archive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────

function RuleForm({
  initial,
  onClose,
  onSaved,
  setError,
}: {
  initial: CommissionRule | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  setError: (msg: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [triggerEvent, setTriggerEvent] = useState<CommissionTriggerEvent>(
    initial?.triggerEvent ?? "invoice_posted",
  );
  const [formula, setFormula] = useState<CommissionFormula>(
    initial?.formula ?? "flat_pct",
  );
  const [priority, setPriority] = useState(String(initial?.priority ?? 100));
  const [effectiveFrom, setEffectiveFrom] = useState(
    initial?.effectiveFrom ?? new Date().toISOString().slice(0, 10),
  );
  const [effectiveTo, setEffectiveTo] = useState(initial?.effectiveTo ?? "");

  // Flat %
  const initialBps =
    initial?.formula === "flat_pct"
      ? Number((initial.config as { bps?: unknown }).bps ?? 0)
      : 300;
  const [flatPct, setFlatPct] = useState(
    Number.isFinite(initialBps) ? (initialBps / 100).toFixed(2) : "3.00",
  );

  // Tiered
  type TierRow = { upToLkr: string; pct: string };
  const initialTiers: TierRow[] =
    initial?.formula === "tiered_volume"
      ? (
          (initial.config as { tiers?: Array<{ upToCents?: number | null; bps: number }> }).tiers ??
          []
        ).map((t) => ({
          upToLkr: t.upToCents == null ? "" : String(Math.round(t.upToCents / 100)),
          pct: (t.bps / 100).toFixed(2),
        }))
      : [
          { upToLkr: "500000", pct: "2.00" },
          { upToLkr: "2000000", pct: "3.00" },
          { upToLkr: "", pct: "5.00" },
        ];
  const [tiers, setTiers] = useState<TierRow[]>(initialTiers);

  async function save() {
    setError(null);

    let config: Record<string, unknown>;
    if (formula === "flat_pct") {
      const pct = Number(flatPct);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        setError("Flat % must be between 0 and 100.");
        return;
      }
      config = { bps: Math.round(pct * 100) };
    } else {
      const parsed = tiers
        .map((t) => {
          const pct = Number(t.pct);
          if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
          const upToCents = t.upToLkr.trim()
            ? Math.round(Number(t.upToLkr) * 100)
            : null;
          if (upToCents != null && (!Number.isFinite(upToCents) || upToCents < 0))
            return null;
          return { upToCents, bps: Math.round(pct * 100) };
        })
        .filter((x): x is { upToCents: number | null; bps: number } => x !== null);
      if (parsed.length === 0) {
        setError("Add at least one tier with a valid % (0–100).");
        return;
      }
      config = { tiers: parsed };
    }

    const body: CreateCommissionRule = {
      name: name.trim(),
      description: description.trim() || undefined,
      status: initial?.status ?? "active",
      triggerEvent,
      formula,
      config,
      priority: Number(priority) || 100,
      effectiveFrom,
      effectiveTo: effectiveTo || null,
    };

    if (!body.name) {
      setError("Name is required.");
      return;
    }

    setBusy(true);
    try {
      if (initial) {
        await api.updateCommissionRule(initial.id, body);
      } else {
        await api.createCommissionRule(body);
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-body font-semibold text-charcoal">
          {initial ? "Edit rule" : "New commission rule"}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="text-text-tertiary hover:text-charcoal"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">
            Name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Base sales commission"
            className="input mt-1.5"
          />
        </div>
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">
            Priority (higher = wins)
          </label>
          <input
            type="number"
            min="0"
            max="1000"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="input mt-1.5 text-right tabular-nums"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">
            Description
          </label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="One-line description"
            className="input mt-1.5"
          />
        </div>

        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">
            Trigger
          </label>
          <select
            value={triggerEvent}
            onChange={(e) =>
              setTriggerEvent(e.target.value as CommissionTriggerEvent)
            }
            className="input mt-1.5"
          >
            <option value="invoice_posted">On invoice post (accrues immediately)</option>
            <option value="payment_received">On payment received (accrues when collected)</option>
          </select>
        </div>
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">
            Formula
          </label>
          <select
            value={formula}
            onChange={(e) => setFormula(e.target.value as CommissionFormula)}
            className="input mt-1.5"
          >
            <option value="flat_pct">Flat %</option>
            <option value="tiered_volume">Tiered by monthly volume</option>
          </select>
        </div>

        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">
            Effective from
          </label>
          <input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            className="input mt-1.5"
          />
        </div>
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">
            Effective to (optional)
          </label>
          <input
            type="date"
            value={effectiveTo}
            onChange={(e) => setEffectiveTo(e.target.value)}
            className="input mt-1.5"
          />
        </div>
      </div>

      {formula === "flat_pct" ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-caption uppercase tracking-wide text-text-tertiary">
              Rate (%)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={flatPct}
              onChange={(e) => setFlatPct(e.target.value)}
              className="input mt-1.5 text-right tabular-nums"
            />
            <p className="mt-1 text-caption text-text-tertiary">
              Applied to the invoice net (lines – line discounts). Example: 3% of
              LKR 100,000 = LKR 3,000.
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">
            Monthly volume tiers (marginal — leave "Up to" blank for "and above")
          </label>
          <div className="mt-2 space-y-2">
            {tiers.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  placeholder="Up to (LKR)"
                  value={t.upToLkr}
                  onChange={(e) => {
                    const next = [...tiers];
                    next[i] = { ...t, upToLkr: e.target.value };
                    setTiers(next);
                  }}
                  className="input w-48 text-right tabular-nums"
                />
                <span className="text-text-tertiary">→</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  placeholder="%"
                  value={t.pct}
                  onChange={(e) => {
                    const next = [...tiers];
                    next[i] = { ...t, pct: e.target.value };
                    setTiers(next);
                  }}
                  className="input w-32 text-right tabular-nums"
                />
                <button
                  type="button"
                  onClick={() =>
                    setTiers(tiers.filter((_, idx) => idx !== i))
                  }
                  className="text-text-tertiary hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setTiers([...tiers, { upToLkr: "", pct: "0.00" }])
              }
              className="text-small font-medium text-mint-dark hover:underline"
            >
              + Add tier
            </button>
          </div>
          <p className="mt-2 text-caption text-text-tertiary">
            Commission is computed marginally against the salesperson's
            month-to-date volume. Higher-tier rates apply only to the portion
            above the prior tier's cap.
          </p>
        </div>
      )}

      <div className="mt-5 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border-hairline border-border px-3 py-2 text-small font-medium text-charcoal hover:bg-surface-recessed"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="btn-primary disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {initial ? "Save" : "Create"}
        </button>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Salespeople tab
// ──────────────────────────────────────────────────────────────────────────

function SalespeopleTab({
  salespeople,
  salespeopleByUserId,
  users,
  onChanged,
  setError,
}: {
  salespeople: CommissionSalesperson[];
  salespeopleByUserId: Map<string, CommissionSalesperson>;
  users: UserWithRoles[] | null;
  onChanged: () => Promise<void>;
  setError: (msg: string | null) => void;
}) {
  const [pickUserId, setPickUserId] = useState<string>("");
  const [defaultRatePct, setDefaultRatePct] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const unlinked = useMemo(() => {
    if (!users) return [];
    return users.filter((u) => !salespeopleByUserId.has(u.id));
  }, [users, salespeopleByUserId]);

  async function add() {
    setError(null);
    if (!pickUserId) {
      setError("Pick a user to link.");
      return;
    }
    const pct = defaultRatePct ? Number(defaultRatePct) : null;
    if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
      setError("Default rate must be between 0 and 100.");
      return;
    }
    setBusy(true);
    try {
      await api.upsertCommissionSalesperson({
        userId: pickUserId,
        isActive: true,
        defaultRateBps: pct == null ? null : Math.round(pct * 100),
      });
      setPickUserId("");
      setDefaultRatePct("");
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(s: CommissionSalesperson) {
    setError(null);
    try {
      await api.upsertCommissionSalesperson({
        userId: s.userId,
        isActive: !s.isActive,
        defaultRateBps: s.defaultRateBps,
      });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update.");
    }
  }

  async function unlink(s: CommissionSalesperson) {
    if (!confirm(`Unlink ${s.userFullName || s.userEmail} from commissions?`))
      return;
    setError(null);
    try {
      await api.deleteCommissionSalesperson(s.userId);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't unlink.");
    }
  }

  return (
    <>
      <section className="mb-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
        <h3 className="text-body font-semibold text-charcoal">
          Link a salesperson
        </h3>
        <p className="mt-1 text-small text-text-secondary">
          Only linked users can be selected as the salesperson on an invoice,
          and only their earnings flow through to payroll.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_160px_auto]">
          <select
            value={pickUserId}
            onChange={(e) => setPickUserId(e.target.value)}
            className="input"
          >
            <option value="">— Select a user —</option>
            {unlinked.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName ?? u.email} ({u.email})
              </option>
            ))}
          </select>
          <input
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={defaultRatePct}
            onChange={(e) => setDefaultRatePct(e.target.value)}
            placeholder="Default rate % (opt)"
            className="input text-right tabular-nums"
          />
          <button
            type="button"
            onClick={add}
            disabled={busy}
            className="btn-primary disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Link
          </button>
        </div>
      </section>

      {salespeople.length === 0 ? (
        <EmptyState
          icon={<Users className="h-5 w-5" />}
          title="No salespeople linked yet."
          body="Link a user above to let them be selected as a salesperson on invoices and receive commissions."
        />
      ) : (
        <div className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Employee</th>
                <th className="w-32 px-4 py-3 text-right">Default rate</th>
                <th className="w-24 px-4 py-3 text-center">Status</th>
                <th className="w-20 px-4 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {salespeople.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 font-medium text-charcoal">
                    {s.userFullName || "—"}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {s.userEmail}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {s.employeeFullName
                      ? `${s.employeeFullName}${s.employeeCode ? ` (${s.employeeCode})` : ""}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {bpsToPct(s.defaultRateBps)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => toggleActive(s)}
                      className={`rounded-full px-2.5 py-0.5 text-caption font-medium transition ${
                        s.isActive
                          ? "bg-mint-surface text-mint-dark hover:bg-mint"
                          : "bg-surface-recessed text-text-secondary hover:bg-warning-bg"
                      }`}
                    >
                      {s.isActive ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => unlink(s)}
                      className="text-text-tertiary hover:text-danger"
                      title="Unlink"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Earnings tab
// ──────────────────────────────────────────────────────────────────────────

function EarningsTab({
  earnings,
  salespeople,
  reload,
}: {
  earnings: CommissionEarning[];
  salespeople: CommissionSalesperson[];
  reload: (filters: {
    salespersonUserId?: string;
    status?: CommissionEarningStatus;
    from?: string;
    to?: string;
  }) => Promise<void>;
}) {
  const [salespersonUserId, setSalespersonUserId] = useState("");
  const [status, setStatus] = useState<CommissionEarningStatus | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  async function apply() {
    await reload({
      salespersonUserId: salespersonUserId || undefined,
      status: status || undefined,
      from: from || undefined,
      to: to || undefined,
    });
  }

  return (
    <>
      <section className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">
            Salesperson
          </label>
          <select
            value={salespersonUserId}
            onChange={(e) => setSalespersonUserId(e.target.value)}
            className="input mt-1.5 min-w-[200px]"
          >
            <option value="">All</option>
            {salespeople.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.userFullName || s.userEmail}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">
            Status
          </label>
          <select
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as CommissionEarningStatus | "")
            }
            className="input mt-1.5"
          >
            <option value="">All</option>
            <option value="accrued">Accrued</option>
            <option value="paid">Paid</option>
            <option value="clawed_back">Clawed back</option>
            <option value="voided">Voided</option>
          </select>
        </div>
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">
            From
          </label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="input mt-1.5"
          />
        </div>
        <div>
          <label className="block text-caption uppercase tracking-wide text-text-tertiary">
            To
          </label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="input mt-1.5"
          />
        </div>
        <button type="button" onClick={apply} className="btn-primary">
          Apply
        </button>
      </section>

      {earnings.length === 0 ? (
        <EmptyState
          icon={<Coins className="h-5 w-5" />}
          title="No earnings yet."
          body="Earnings appear here as invoices post (or payments come in) that match your rules."
        />
      ) : (
        <div className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="w-28 px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Source</th>
                <th className="px-4 py-3 text-left">Rule</th>
                <th className="px-4 py-3 text-left">Customer</th>
                <th className="w-28 px-4 py-3 text-right">Base</th>
                <th className="w-20 px-4 py-3 text-right">Rate</th>
                <th className="w-28 px-4 py-3 text-right">Amount</th>
                <th className="w-24 px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {earnings.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-3 tabular-nums text-text-secondary">
                    {e.earnedAt}
                  </td>
                  <td className="px-4 py-3 font-medium text-charcoal">
                    {e.sourceNumber ?? "—"}
                    <span className="ml-2 text-caption text-text-tertiary">
                      {e.sourceType.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {e.ruleName ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {e.customerName ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {formatLKR(e.baseCents)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {bpsToPct(e.rateBps)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums font-medium ${
                      e.amountCents < 0 ? "text-danger" : "text-charcoal"
                    }`}
                  >
                    {formatLKR(e.amountCents)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusPill status={e.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function StatusPill({ status }: { status: CommissionEarningStatus }) {
  const cls =
    status === "paid"
      ? "bg-mint-surface text-mint-dark"
      : status === "accrued"
        ? "bg-surface-recessed text-charcoal"
        : status === "clawed_back"
          ? "bg-warning-bg text-warning"
          : "bg-danger-bg text-danger";
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${cls}`}
    >
      {EARNING_STATUS_LABELS[status]}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Ledger tab
// ──────────────────────────────────────────────────────────────────────────

function LedgerTab({ ledger }: { ledger: CommissionLedgerRow[] }) {
  if (ledger.length === 0) {
    return (
      <EmptyState
        icon={<Coins className="h-5 w-5" />}
        title="No ledger activity."
        body="The ledger summarises commission totals per salesperson. It'll populate as rules fire on posted invoices."
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
      <table className="w-full text-small">
        <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
          <tr>
            <th className="px-4 py-3 text-left">Salesperson</th>
            <th className="px-4 py-3 text-left">Email</th>
            <th className="w-32 px-4 py-3 text-right">Accrued</th>
            <th className="w-32 px-4 py-3 text-right">Paid</th>
            <th className="w-32 px-4 py-3 text-right">Clawed back</th>
            <th className="w-32 px-4 py-3 text-right">Total</th>
            <th className="w-20 px-4 py-3 text-right">Rows</th>
          </tr>
        </thead>
        <tbody className="divide-y-hairline divide-border">
          {ledger.map((row) => (
            <tr key={row.salespersonUserId}>
              <td className="px-4 py-3 font-medium text-charcoal">
                {row.fullName || "—"}
              </td>
              <td className="px-4 py-3 text-text-secondary">{row.email}</td>
              <td className="px-4 py-3 text-right tabular-nums text-charcoal">
                {formatLKR(row.accruedCents)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-mint-dark">
                {formatLKR(row.paidCents)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-danger">
                {formatLKR(row.clawedBackCents)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums font-semibold text-charcoal">
                {formatLKR(row.totalCents)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-text-tertiary">
                {row.rowCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────

function EmptyState({
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
