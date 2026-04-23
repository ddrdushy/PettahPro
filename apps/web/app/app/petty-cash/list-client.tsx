"use client";

import Link from "next/link";
import { Plus, Wallet } from "lucide-react";
import type {
  PettyCashFloatRow,
  Branch,
  UserWithRoles,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";

export function PettyCashListClient({
  floats,
  branches,
  users,
}: {
  floats: PettyCashFloatRow[];
  branches: Branch[];
  users: UserWithRoles[];
}) {
  const branchMap = new Map(branches.map((b) => [b.id, b.name]));
  const userMap = new Map(
    users.map((u) => [u.id, u.fullName ?? u.email]),
  );

  const active = floats.filter((f) => f.status === "active");
  const closed = floats.filter((f) => f.status === "closed");

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Accounting"
        title="Petty cash"
        description="Per-branch operational cash floats. Holders record expenses and staff advances; top-ups replenish the float against a cash or bank source. EOD reconciliation posts variance to Cash Over/Short."
        action={
          <Link href="/app/petty-cash/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            Open float
          </Link>
        }
      />

      {floats.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <section className="mt-8">
            <SectionHeading title="Active floats" count={active.length} />
            <FloatTable
              rows={active}
              branchMap={branchMap}
              userMap={userMap}
            />
          </section>

          {closed.length > 0 && (
            <section className="mt-10">
              <SectionHeading title="Closed floats" count={closed.length} />
              <FloatTable
                rows={closed}
                branchMap={branchMap}
                userMap={userMap}
              />
            </section>
          )}
        </>
      )}
    </main>
  );
}

function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <h2 className="mb-3 text-small font-medium text-text-secondary">
      {title}
      <span className="ml-2 text-caption text-text-tertiary">({count})</span>
    </h2>
  );
}

function FloatTable({
  rows,
  branchMap,
  userMap,
}: {
  rows: PettyCashFloatRow[];
  branchMap: Map<string, string>;
  userMap: Map<string, string>;
}) {
  return (
    <div className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
      <table className="w-full text-small">
        <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
          <tr>
            <th className="px-4 py-3 text-left">Name</th>
            <th className="w-40 px-4 py-3 text-left">Branch</th>
            <th className="w-40 px-4 py-3 text-left">Holder</th>
            <th className="w-32 px-4 py-3 text-right">Balance</th>
            <th className="w-32 px-4 py-3 text-right">Ceiling</th>
            <th className="w-28 px-4 py-3 text-left">Opened</th>
            <th className="w-24 px-4 py-3 text-center">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y-hairline divide-border">
          {rows.map((f) => {
            const nearCeiling =
              f.ceilingCents > 0 &&
              f.currentBalanceCents >= f.ceilingCents * 0.9;
            return (
              <tr
                key={f.id}
                className="transition-colors hover:bg-surface-recessed/40"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/app/petty-cash/${f.id}`}
                    className="text-charcoal underline-offset-4 hover:underline"
                  >
                    {f.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {branchMap.get(f.branchId) ?? (
                    <span className="text-text-tertiary">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {userMap.get(f.floatHolderUserId) ?? (
                    <span className="text-text-tertiary">—</span>
                  )}
                </td>
                <td
                  className={`px-4 py-3 text-right tabular-nums ${
                    nearCeiling ? "text-warning" : "text-charcoal"
                  }`}
                >
                  {formatLKR(f.currentBalanceCents)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                  {formatLKR(f.ceilingCents)}
                </td>
                <td className="px-4 py-3 tabular-nums text-text-secondary">
                  {formatDate(f.openedAt)}
                </td>
                <td className="px-4 py-3 text-center">
                  <StatusPill status={f.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ status }: { status: "active" | "closed" }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-caption font-medium ${
        status === "active"
          ? "bg-mint-surface text-mint-dark"
          : "bg-surface-recessed text-text-secondary"
      }`}
    >
      {status === "active" ? "Active" : "Closed"}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
        <Wallet className="h-5 w-5" />
      </div>
      <p className="text-body text-charcoal">No petty cash floats yet.</p>
      <p className="mt-1 text-small text-text-secondary">
        Open one per branch where shop-floor cash needs tracking. One active
        float per branch, held by a single user at a time.
      </p>
      <Link href="/app/petty-cash/new" className="btn-primary mt-4 inline-flex">
        <Plus className="h-4 w-4" aria-hidden />
        Open float
      </Link>
    </div>
  );
}
