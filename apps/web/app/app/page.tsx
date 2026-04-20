import Link from "next/link";
import { cookies } from "next/headers";
import {
  ArrowRight,
  AlertTriangle,
  Banknote,
  CircleDollarSign,
  Clock,
  FileText,
  TrendingUp,
  TrendingDown,
  Wallet,
} from "lucide-react";
import type { Dashboard } from "@/lib/api";
import { StatusBadge } from "@/components/app/status-badge";
import { formatLKR, formatDate } from "@/lib/format";

async function fetchDashboard(): Promise<Dashboard | null> {
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/dashboard`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as Dashboard;
}

export default async function AppHomePage() {
  const d = await fetchDashboard();

  if (!d) {
    return (
      <main className="container-p py-10">
        <div className="rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <p className="text-body text-text-secondary">Couldn't load dashboard. Try reloading.</p>
        </div>
      </main>
    );
  }

  const agingTotal = d.aging.reduce((s, b) => s + b.balanceCents, 0);
  const revChange =
    d.revenueLastMonthCents > 0
      ? ((d.revenueThisMonthCents - d.revenueLastMonthCents) / d.revenueLastMonthCents) * 100
      : null;

  return (
    <main className="container-p py-10">
      <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <span className="eyebrow">Today</span>
          <h1 className="mt-3 text-h1 text-charcoal md:text-display">Here's where your books stand.</h1>
          <p className="mt-2 text-body text-text-secondary">
            {new Date().toLocaleDateString("en-GB", {
              weekday: "long",
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/app/invoices/new" className="btn-primary">
            <FileText className="h-4 w-4" aria-hidden /> New invoice
          </Link>
        </div>
      </header>

      {/* KPI row */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Banknote className="h-5 w-5" />}
          label="Cash position"
          value={formatLKR(d.cashPositionCents)}
          sub={`Across ${d.cashByAccount.length} bank/cash account${d.cashByAccount.length === 1 ? "" : "s"}`}
          tone="mint"
        />
        <KpiCard
          icon={<CircleDollarSign className="h-5 w-5" />}
          label="AR outstanding"
          value={formatLKR(d.arTotalCents)}
          sub={`${d.openInvoiceCount} open ${d.openInvoiceCount === 1 ? "invoice" : "invoices"}`}
        />
        <KpiCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="Revenue this month"
          value={formatLKR(d.revenueThisMonthCents)}
          sub={
            revChange === null
              ? `${d.invoicesThisMonth} invoices posted`
              : `${revChange >= 0 ? "+" : ""}${revChange.toFixed(0)}% vs last month`
          }
          trend={revChange === null ? undefined : revChange >= 0 ? "up" : "down"}
        />
        <KpiCard
          icon={<Wallet className="h-5 w-5" />}
          label="Payments collected"
          value={formatLKR(d.paymentsThisMonthCents)}
          sub="This month · posted receipts"
        />
      </section>

      {d.overdueCount > 0 && (
        <div className="mt-6 flex items-center justify-between gap-4 rounded-card border-hairline border-warning-accent/40 bg-warning-bg/60 px-5 py-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-warning-accent" aria-hidden />
            <div>
              <p className="text-small font-medium text-charcoal">
                {d.overdueCount} overdue {d.overdueCount === 1 ? "invoice" : "invoices"} · {formatLKR(d.overdueCents)} past due
              </p>
              <p className="text-caption text-text-secondary">Chase payment or update terms on the invoice page.</p>
            </div>
          </div>
          <Link href="/app/invoices" className="btn-link text-small">
            View all <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      )}

      {/* Revenue sparkline + AR aging */}
      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <section className="rounded-card border-hairline border-border bg-surface-elevated p-6 lg:col-span-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-caption uppercase tracking-wide text-text-tertiary">Revenue · last 14 days</p>
              <p className="tabular-nums mt-2 text-h1 text-charcoal">
                {formatLKR(d.revenueSeries.reduce((s, p) => s + p.revenueCents, 0))}
              </p>
              <p className="text-caption text-text-secondary">Posted invoices · subtotal before tax</p>
            </div>
          </div>
          <div className="mt-6">
            <Sparkline data={d.revenueSeries} />
          </div>
        </section>

        <section className="rounded-card border-hairline border-border bg-surface-elevated p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <p className="text-caption uppercase tracking-wide text-text-tertiary">Receivables aging</p>
            <span className="tabular-nums text-small font-medium text-charcoal">
              {formatLKR(agingTotal)}
            </span>
          </div>
          <ul className="mt-5 space-y-3">
            {d.aging.map((b) => {
              const pct = agingTotal > 0 ? (b.balanceCents / agingTotal) * 100 : 0;
              const isOverdue = b.label !== "current";
              return (
                <li key={b.label}>
                  <div className="flex items-baseline justify-between text-small">
                    <span className="text-text-primary">{agingLabel(b.label)}</span>
                    <span className="tabular-nums text-text-secondary">
                      {formatLKR(b.balanceCents)}
                      {b.invoiceCount > 0 && (
                        <span className="ml-2 text-caption text-text-tertiary">{b.invoiceCount}</span>
                      )}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-recessed">
                    <div
                      className={`h-full rounded-full ${isOverdue ? "bg-warning-accent" : "bg-mint"}`}
                      style={{ width: `${pct}%`, transition: "width 0.6s ease-out" }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {/* Recent activity */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-card border-hairline border-border bg-surface-elevated">
          <header className="flex items-center justify-between border-b-hairline border-border px-6 py-4">
            <div>
              <p className="text-h3 text-charcoal">Recent invoices</p>
              <p className="text-caption text-text-tertiary">Latest 5</p>
            </div>
            <Link href="/app/invoices" className="btn-link text-small">
              View all <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </header>
          {d.recentInvoices.length === 0 ? (
            <EmptyRow icon={<FileText className="h-5 w-5" />} label="No invoices yet." />
          ) : (
            <ul className="divide-y-hairline divide-border">
              {d.recentInvoices.map((inv) => (
                <li key={inv.id}>
                  <Link
                    href={`/app/invoices/${inv.id}`}
                    className="flex items-center justify-between gap-3 px-6 py-3.5 transition-colors hover:bg-surface-recessed/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-charcoal">
                        {inv.invoiceNumber ?? <span className="italic text-text-tertiary">Draft</span>}{" "}
                        · {inv.customerName}
                      </p>
                      <p className="text-caption text-text-tertiary">Due {formatDate(inv.dueDate)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="tabular-nums text-small font-medium text-charcoal">
                        {formatLKR(inv.totalCents)}
                      </span>
                      <StatusBadge status={inv.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-card border-hairline border-border bg-surface-elevated">
          <header className="flex items-center justify-between border-b-hairline border-border px-6 py-4">
            <div>
              <p className="text-h3 text-charcoal">Recent payments</p>
              <p className="text-caption text-text-tertiary">Latest 5</p>
            </div>
            <Link href="/app/payments" className="btn-link text-small">
              View all <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </header>
          {d.recentPayments.length === 0 ? (
            <EmptyRow icon={<Wallet className="h-5 w-5" />} label="No payments yet." />
          ) : (
            <ul className="divide-y-hairline divide-border">
              {d.recentPayments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-6 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-charcoal">
                      {p.paymentNumber ?? "—"} · {p.customerName}
                    </p>
                    <p className="text-caption text-text-tertiary">
                      {methodLabel(p.method)} · {formatDate(p.paymentDate)}
                    </p>
                  </div>
                  <span className="tabular-nums text-small font-medium text-charcoal">
                    {formatLKR(p.amountCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  tone,
  trend,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone?: "mint";
  trend?: "up" | "down";
}) {
  return (
    <div className="rounded-card border-hairline border-border bg-surface-elevated p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-charcoal hover:shadow-sm">
      <div className="flex items-start justify-between">
        <div
          className={`grid h-9 w-9 place-items-center rounded-md ${
            tone === "mint" ? "bg-mint text-mint-dark" : "bg-mint-surface text-mint-dark"
          }`}
        >
          {icon}
        </div>
        {trend === "up" && (
          <TrendingUp className="h-4 w-4 text-mint-dark" aria-hidden />
        )}
        {trend === "down" && (
          <TrendingDown className="h-4 w-4 text-warning-accent" aria-hidden />
        )}
      </div>
      <p className="mt-4 text-caption uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className="tabular-nums mt-1 text-h2 text-charcoal">{value}</p>
      <p className="mt-1 text-caption text-text-secondary">{sub}</p>
    </div>
  );
}

function Sparkline({ data }: { data: Array<{ day: string; revenueCents: number }> }) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((p) => p.revenueCents), 1);
  const W = 700;
  const H = 140;
  const padX = 16;
  const padY = 16;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;
  const step = data.length > 1 ? innerW / (data.length - 1) : 0;
  const pts = data.map((p, i) => {
    const x = padX + i * step;
    const y = padY + innerH - (p.revenueCents / max) * innerH;
    return { x, y, ...p };
  });
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x},${p.y}`).join(" ");
  const areaPath = `${linePath} L ${pts[pts.length - 1]!.x},${padY + innerH} L ${pts[0]!.x},${padY + innerH} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-36 w-full" aria-hidden>
      <defs>
        <linearGradient id="dash-spark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#7FB89A" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#7FB89A" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#dash-spark)" />
      <path
        d={linePath}
        fill="none"
        stroke="#3D6B52"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {pts.map((p) => (
        <circle
          key={p.day}
          cx={p.x}
          cy={p.y}
          r={p.revenueCents > 0 ? 2.5 : 0}
          fill="#3D6B52"
        />
      ))}
    </svg>
  );
}

function EmptyRow({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-text-secondary">
      <div className="grid h-10 w-10 place-items-center rounded-full bg-surface-recessed text-text-tertiary">
        {icon}
      </div>
      <p className="text-small">{label}</p>
    </div>
  );
}

function agingLabel(label: string) {
  if (label === "current") return "Current (not yet due)";
  if (label === "0-30") return "1-30 days overdue";
  if (label === "30-60") return "31-60 days overdue";
  if (label === "60-90") return "61-90 days overdue";
  if (label === "90+") return "90+ days overdue";
  return label;
}

function methodLabel(m: string) {
  const map: Record<string, string> = {
    cash: "Cash",
    bank_transfer: "Bank transfer",
    cheque: "Cheque",
    card: "Card",
    lankaqr: "LankaQR",
    payhere: "PayHere",
    frimi: "FriMi",
    genie: "Genie",
    ipay: "iPay",
    other: "Other",
  };
  return map[m] ?? m;
}
