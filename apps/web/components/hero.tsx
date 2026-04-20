import Link from "next/link";
import { ArrowRight, Play, TrendingUp, CircleDollarSign, Receipt } from "lucide-react";
import { hero } from "@/lib/content";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="container-p grid gap-12 pb-20 pt-16 md:grid-cols-[3fr_2fr] md:gap-16 md:pb-28 md:pt-24">
        <div>
          <span className="eyebrow animate-fade-up" style={{ animationDelay: "0.05s" }}>
            {hero.eyebrow}
          </span>
          <h1
            className="section-title mt-5 max-w-[18ch] animate-fade-up"
            style={{ animationDelay: "0.15s" }}
          >
            {hero.headline}
          </h1>
          <p
            className="mt-6 max-w-[52ch] text-body-lg text-text-secondary animate-fade-up"
            style={{ animationDelay: "0.3s" }}
          >
            {hero.subhead}
          </p>

          <div
            className="mt-8 flex flex-wrap gap-3 animate-fade-up"
            style={{ animationDelay: "0.45s" }}
          >
            <Link href={hero.ctaPrimary.href} className="btn-primary text-body-lg">
              {hero.ctaPrimary.label}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link href={hero.ctaSecondary.href} className="btn-secondary text-body-lg">
              <Play className="h-4 w-4" aria-hidden />
              {hero.ctaSecondary.label}
            </Link>
          </div>

          <p
            className="mt-4 text-small text-text-tertiary animate-fade-up"
            style={{ animationDelay: "0.6s" }}
          >
            {hero.trustLine}
          </p>
        </div>

        <div className="animate-fade-up" style={{ animationDelay: "0.4s" }}>
          <DashboardPreview />
        </div>
      </div>
    </section>
  );
}

function DashboardPreview() {
  return (
    <div aria-hidden className="relative select-none">
      <div className="rounded-card border-hairline border-border bg-surface-elevated p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-caption uppercase tracking-wide text-text-tertiary">Cash position</p>
            <p className="tabular-nums mt-1 text-h1 text-charcoal">LKR 4,82,630.00</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-mint-surface px-2.5 py-1 text-micro text-mint-dark">
            <TrendingUp className="h-3 w-3" /> 12%
          </span>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-md bg-surface-recessed p-3">
            <p className="text-caption text-text-tertiary">AR aging (0-30)</p>
            <p className="tabular-nums mt-1 text-body-lg font-medium">LKR 1,24,500</p>
          </div>
          <div className="rounded-md bg-surface-recessed p-3">
            <p className="text-caption text-text-tertiary">AP due this week</p>
            <p className="tabular-nums mt-1 text-body-lg font-medium">LKR 87,200</p>
          </div>
        </div>

        <div className="mt-5 border-t-hairline border-border pt-4">
          <div className="flex items-center justify-between">
            <p className="text-caption uppercase tracking-wide text-text-tertiary">Recent activity</p>
            <p className="text-caption text-text-tertiary">Today</p>
          </div>
          <ul className="mt-3 space-y-3">
            <Row
              icon={<Receipt className="h-4 w-4" />}
              title="INV-2026-0342"
              sub="Perera Textiles"
              amount="LKR 45,600"
              status="Paid"
              delay={0.8}
            />
            <Row
              icon={<Receipt className="h-4 w-4" />}
              title="INV-2026-0341"
              sub="Fathima Importers"
              amount="LKR 12,900"
              status="Due 20 Apr"
              subtle
              delay={1.0}
            />
            <Row
              icon={<CircleDollarSign className="h-4 w-4" />}
              title="Bill BIL-0198"
              sub="Lanka Hardware"
              amount="-LKR 8,450"
              status="Scheduled"
              subtle
              delay={1.2}
            />
          </ul>
        </div>
      </div>

      <div
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-6 -z-10 h-40 w-40 rounded-full bg-mint-surface blur-2xl animate-float"
      />
    </div>
  );
}

function Row({
  icon,
  title,
  sub,
  amount,
  status,
  subtle,
  delay,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  amount: string;
  status: string;
  subtle?: boolean;
  delay: number;
}) {
  return (
    <li
      className="flex items-center justify-between gap-3 animate-fade-up"
      style={{ animationDelay: `${delay}s` }}
    >
      <div className="flex items-center gap-3">
        <div className="grid h-8 w-8 place-items-center rounded-md bg-mint-surface text-mint-dark">
          {icon}
        </div>
        <div>
          <p className="text-small font-medium text-charcoal">{title}</p>
          <p className="text-caption text-text-tertiary">{sub}</p>
        </div>
      </div>
      <div className="text-right">
        <p className="tabular-nums text-small font-medium text-charcoal">{amount}</p>
        <p className={`text-caption ${subtle ? "text-text-tertiary" : "text-mint-dark"}`}>
          {status}
        </p>
      </div>
    </li>
  );
}
