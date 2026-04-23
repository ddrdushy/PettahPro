import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { formatLKR, formatDate } from "@/lib/format";
import type { PosShift } from "@/lib/api";

export const metadata: Metadata = { title: "POS shifts" };

async function fetchShifts(): Promise<PosShift[]> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/pos/shifts`,
    {
      headers: { cookie: cookies().toString() },
      cache: "no-store",
    },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { shifts: PosShift[] };
  return data.shifts;
}

export default async function PosShiftsPage() {
  const shifts = await fetchShifts();
  const currentShift = shifts.find((s) => s.status === "open") ?? null;

  const columns: Column<PosShift>[] = [
    {
      header: "Shift",
      accessor: (s) => (
        <div>
          <p className="font-medium text-charcoal">{s.id.slice(0, 8)}</p>
          <p className="text-caption text-text-tertiary">
            {formatDate(s.openedAt)}
          </p>
        </div>
      ),
    },
    {
      header: "Status",
      accessor: (s) => (
        <span
          className={`rounded-full px-2 py-0.5 text-caption ${
            s.status === "open"
              ? "bg-mint-surface text-mint-dark"
              : "bg-surface-recessed text-text-secondary"
          }`}
        >
          {s.status}
        </span>
      ),
    },
    {
      header: "Opening float",
      accessor: (s) => (
        <span className="text-small">{formatLKR(s.openingFloatCents)}</span>
      ),
    },
    {
      header: "Counted",
      accessor: (s) =>
        s.closingCashCents == null ? (
          <span className="text-text-tertiary">—</span>
        ) : (
          <span className="text-small">{formatLKR(s.closingCashCents)}</span>
        ),
    },
    {
      header: "Variance",
      accessor: (s) => {
        if (s.varianceCents == null)
          return <span className="text-text-tertiary">—</span>;
        if (s.varianceCents === 0)
          return <span className="text-mint-dark">exact</span>;
        const tone =
          s.varianceCents < 0 ? "text-destructive-foreground" : "text-warning";
        return (
          <span className={`text-small font-medium ${tone}`}>
            {s.varianceCents > 0 ? "+" : ""}
            {formatLKR(s.varianceCents)}
          </span>
        );
      },
    },
    {
      header: "",
      accessor: (s) => (
        <Link
          href={`/app/pos/shifts/${s.id}`}
          className="text-small text-primary hover:underline"
        >
          {s.status === "open" ? "Manage →" : "Z-report →"}
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="POS shifts"
        description="Cash-control wrapper for every POS session. Open, sell, close with a physical count."
        action={
          currentShift ? (
            <Link
              href={`/app/pos/shifts/${currentShift.id}?close=1`}
              className="btn-primary"
            >
              Close current shift
            </Link>
          ) : (
            <Link href="/app/pos" className="btn-primary">
              Open new shift
            </Link>
          )
        }
      />
      <DataTable
        rows={shifts}
        columns={columns}
        empty={
          <p className="text-text-tertiary">
            No shifts yet. Head to the POS terminal to open one.
          </p>
        }
      />
    </div>
  );
}
