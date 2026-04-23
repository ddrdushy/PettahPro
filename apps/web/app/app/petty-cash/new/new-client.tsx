"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import {
  api,
  ApiError,
  type Account,
  type Branch,
  type UserWithRoles,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";

function rupeesToCents(s: string): number {
  const v = Number(s);
  return Number.isFinite(v) ? Math.max(0, Math.round(v * 100)) : 0;
}

export function NewPettyCashFloatClient({
  accounts,
  branches,
  users,
}: {
  accounts: Account[];
  branches: Branch[];
  users: UserWithRoles[];
}) {
  const router = useRouter();
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [name, setName] = useState("");
  const [holderUserId, setHolderUserId] = useState(users[0]?.id ?? "");
  const [ceiling, setCeiling] = useState("25000");
  const [seedAmount, setSeedAmount] = useState("");
  const [seedSourceId, setSeedSourceId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cash/bank source accounts for the seed top-up — asset subtype
  // cash or bank, excluding the 1005 Petty Cash itself (guarded by
  // letting the user pick any asset account if code/subtype absent).
  const cashOrBankAccounts = useMemo(
    () =>
      accounts.filter(
        (a) =>
          a.accountType === "asset" &&
          (a.accountSubtype === "cash" || a.accountSubtype === "bank") &&
          a.code !== "1005" &&
          a.isActive,
      ),
    [accounts],
  );

  async function submit() {
    setError(null);
    if (!branchId) {
      setError("Pick a branch.");
      return;
    }
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!holderUserId) {
      setError("Pick a float holder.");
      return;
    }
    const ceilingCents = rupeesToCents(ceiling);
    if (ceilingCents <= 0) {
      setError("Ceiling must be greater than 0.");
      return;
    }
    const seedCents = seedAmount ? rupeesToCents(seedAmount) : 0;
    if (seedCents > 0 && !seedSourceId) {
      setError("Pick a source account for the seed top-up.");
      return;
    }
    if (seedCents > ceilingCents) {
      setError("Seed top-up cannot exceed the ceiling.");
      return;
    }

    setBusy(true);
    try {
      const res = await api.openPettyCashFloat({
        branchId,
        name: name.trim(),
        floatHolderUserId: holderUserId,
        ceilingCents,
        ...(seedCents > 0
          ? { seedAmountCents: seedCents, seedSourceAccountId: seedSourceId }
          : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      router.push(`/app/petty-cash/${res.float.id}`);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn't open the float.",
      );
    } finally {
      setBusy(false);
    }
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
        title="Open petty cash float"
        description="One active float per branch. Pick a holder, set a ceiling, and optionally seed it with cash from a bank or till."
      />

      <form
        className="mt-8 max-w-2xl space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Row label="Branch" required>
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="input w-full"
          >
            <option value="" disabled>
              Select branch…
            </option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Row>

        <Row label="Name" required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={'e.g. "Main branch till"'}
            className="input w-full"
          />
        </Row>

        <Row label="Holder (user)" required>
          <select
            value={holderUserId}
            onChange={(e) => setHolderUserId(e.target.value)}
            className="input w-full"
          >
            <option value="" disabled>
              Select user…
            </option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName ?? u.email}
              </option>
            ))}
          </select>
        </Row>

        <Row
          label="Ceiling (LKR)"
          required
          hint="Upper bound the float can hold. Top-ups that would push balance past this are rejected."
        >
          <input
            type="number"
            min="0"
            step="0.01"
            value={ceiling}
            onChange={(e) => setCeiling(e.target.value)}
            className="input w-full tabular-nums"
          />
        </Row>

        <div className="rounded-card border-hairline border-border bg-surface-recessed/40 p-5">
          <p className="text-small font-medium text-charcoal">
            Optional · seed with cash now
          </p>
          <p className="mt-1 text-caption text-text-secondary">
            Posts a top-up in the same transaction from the chosen cash/bank
            source so the float isn&apos;t empty on day one. Skip to open empty
            and request a top-up later.
          </p>
          <div className="mt-4 space-y-4">
            <Row label="Seed amount (LKR)">
              <input
                type="number"
                min="0"
                step="0.01"
                value={seedAmount}
                onChange={(e) => setSeedAmount(e.target.value)}
                placeholder="0"
                className="input w-full tabular-nums"
              />
            </Row>
            <Row label="From account">
              <select
                value={seedSourceId}
                onChange={(e) => setSeedSourceId(e.target.value)}
                className="input w-full"
              >
                <option value="">—</option>
                {cashOrBankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </select>
            </Row>
          </div>
        </div>

        <Row label="Notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="input w-full"
          />
        </Row>

        {error && <p className="text-small text-danger">{error}</p>}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={busy}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : null}
            Open float
          </button>
          <Link href="/app/petty-cash" className="btn-secondary">
            Cancel
          </Link>
        </div>
      </form>
    </main>
  );
}

function Row({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-caption uppercase tracking-wide text-text-tertiary">
        {label}
        {required && <span className="ml-1 text-danger">*</span>}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-caption text-text-tertiary">{hint}</p>}
    </label>
  );
}
