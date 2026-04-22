import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/app/page-header";
import { formatLKR, formatDate } from "@/lib/format";
import type { PosShift, PosZReport } from "@/lib/api";
import { CloseShiftForm } from "./close-form";

export const metadata: Metadata = { title: "POS shift" };

async function fetchZReport(id: string): Promise<PosZReport | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/pos/shifts/${id}/z-report`,
    {
      headers: { cookie: cookies().toString() },
      cache: "no-store",
    },
  );
  if (!res.ok) return null;
  return (await res.json()) as PosZReport;
}

const methodLabel: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  lankaqr: "LankaQR",
  payhere: "PayHere",
  frimi: "FriMi",
  genie: "Genie",
  ipay: "iPay",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  other: "Other",
};

export default async function PosShiftDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { close?: string };
}) {
  const report = await fetchZReport(params.id);
  if (!report) notFound();
  const { shift, cashier, tender, invoices } = report;
  const openForClose = searchParams.close === "1" && shift.status === "open";

  // Cash in = sum of 'cash' tender. Useful to preview on the close-form.
  const cashInCents = tender
    .filter((t) => t.method === "cash")
    .reduce((s, t) => s + t.totalCents, 0);
  const expectedCashCents = shift.openingFloatCents + cashInCents;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`Shift ${shift.id.slice(0, 8)}`}
        title={
          shift.status === "open"
            ? `Open shift · ${cashier?.full_name ?? "—"}`
            : `Closed shift · ${cashier?.full_name ?? "—"}`
        }
        description={`Opened ${formatDate(shift.openedAt)}${
          shift.closedAt ? ` · closed ${formatDate(shift.closedAt)}` : ""
        }`}
        action={
          shift.status === "open" && !openForClose ? (
            <Link
              href={`/app/pos/shifts/${shift.id}?close=1`}
              className="btn-primary"
            >
              Close shift
            </Link>
          ) : (
            <Link href="/app/pos/shifts" className="btn-secondary">
              Back to list
            </Link>
          )
        }
      />

      {/* Z-report grid */}
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-card border-hairline border-border bg-surface-elevated p-4">
          <h3 className="text-caption uppercase tracking-wide text-text-tertiary">
            Float + cash received
          </h3>
          <dl className="mt-3 space-y-2 text-small">
            <div className="flex justify-between">
              <dt className="text-text-secondary">Opening float</dt>
              <dd className="font-medium text-charcoal">
                {formatLKR(shift.openingFloatCents)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-secondary">+ Cash tender this shift</dt>
              <dd className="font-medium text-charcoal">
                {formatLKR(cashInCents)}
              </dd>
            </div>
            <div className="flex justify-between border-t-hairline border-border pt-2">
              <dt className="font-medium text-charcoal">= Expected cash</dt>
              <dd className="font-semibold text-charcoal">
                {formatLKR(expectedCashCents)}
              </dd>
            </div>
            {shift.status === "closed" && shift.closingCashCents != null && (
              <>
                <div className="flex justify-between pt-2">
                  <dt className="text-text-secondary">Counted</dt>
                  <dd className="font-medium text-charcoal">
                    {formatLKR(shift.closingCashCents)}
                  </dd>
                </div>
                <div className="flex justify-between border-t-hairline border-border pt-2">
                  <dt className="font-medium text-charcoal">Variance</dt>
                  <dd
                    className={`font-semibold ${
                      (shift.varianceCents ?? 0) < 0
                        ? "text-destructive-foreground"
                        : (shift.varianceCents ?? 0) > 0
                        ? "text-warning"
                        : "text-mint-dark"
                    }`}
                  >
                    {(shift.varianceCents ?? 0) > 0 ? "+" : ""}
                    {formatLKR(shift.varianceCents ?? 0)}
                  </dd>
                </div>
                {shift.varianceReasonCode && (
                  <p className="mt-2 text-caption text-text-tertiary">
                    Reason: {shift.varianceReasonCode}
                    {shift.varianceReasonNotes
                      ? ` · ${shift.varianceReasonNotes}`
                      : ""}
                  </p>
                )}
              </>
            )}
          </dl>
        </div>

        <div className="rounded-card border-hairline border-border bg-surface-elevated p-4">
          <h3 className="text-caption uppercase tracking-wide text-text-tertiary">
            Tender breakdown
          </h3>
          <dl className="mt-3 space-y-2 text-small">
            {tender.length === 0 ? (
              <p className="text-text-tertiary">No tenders yet.</p>
            ) : (
              tender.map((t) => (
                <div key={t.method} className="flex justify-between">
                  <dt className="text-text-secondary">
                    {methodLabel[t.method] ?? t.method}{" "}
                    <span className="text-caption text-text-tertiary">
                      × {t.count}
                    </span>
                  </dt>
                  <dd className="font-medium text-charcoal">
                    {formatLKR(t.totalCents)}
                  </dd>
                </div>
              ))
            )}
          </dl>
        </div>

        <div className="rounded-card border-hairline border-border bg-surface-elevated p-4">
          <h3 className="text-caption uppercase tracking-wide text-text-tertiary">
            Sales totals
          </h3>
          <dl className="mt-3 space-y-2 text-small">
            <div className="flex justify-between">
              <dt className="text-text-secondary">Invoices</dt>
              <dd className="font-medium text-charcoal">{invoices.count}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-secondary">Subtotal</dt>
              <dd className="font-medium text-charcoal">
                {formatLKR(invoices.subtotalCents)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-secondary">Discounts</dt>
              <dd className="font-medium text-charcoal">
                −{formatLKR(invoices.discountCents)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-secondary">Tax</dt>
              <dd className="font-medium text-charcoal">
                {formatLKR(invoices.taxCents)}
              </dd>
            </div>
            <div className="flex justify-between border-t-hairline border-border pt-2">
              <dt className="font-medium text-charcoal">Total</dt>
              <dd className="font-semibold text-charcoal">
                {formatLKR(invoices.totalCents)}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {openForClose && (
        <CloseShiftForm
          shiftId={shift.id}
          expectedCashCents={expectedCashCents}
        />
      )}
    </div>
  );
}
