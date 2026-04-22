import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import type { NumberSeries } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { NumberSeriesEditor } from "./number-series-editor-client";

export const metadata: Metadata = { title: "Number series" };

async function fetchSeries(): Promise<NumberSeries[] | null> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/number-series`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return null;
  return ((await res.json()) as { series: NumberSeries[] }).series;
}

export default async function NumberSeriesPage() {
  const series = await fetchSeries();

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/settings" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to settings
        </Link>
      </div>

      <PageHeader
        eyebrow="Admin"
        title="Number series"
        description="Customise how invoice, bill, journal, and other document numbers look. Changes apply to documents created after you save — historical numbering is untouched."
      />

      {!series ? (
        <p className="mt-6 text-body text-text-secondary">Couldn't load number series.</p>
      ) : (
        <section className="mt-6 space-y-4">
          <div className="rounded-card border-hairline border-border bg-surface-recessed/40 p-4 text-caption text-text-secondary">
            <p className="font-medium text-charcoal">Tokens you can use in a template</p>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              <li><code>{"{PREFIX}"}</code> — the prefix above, e.g. <code>INV</code></li>
              <li><code>{"{SEQ}"}</code> — counter, left-padded to the pad width</li>
              <li><code>{"{YYYY}"}</code> — 4-digit year, e.g. <code>2026</code></li>
              <li><code>{"{YY}"}</code> — 2-digit year, e.g. <code>26</code></li>
              <li><code>{"{MM}"}</code> — 2-digit month, e.g. <code>04</code></li>
              <li><code>{"{MMM}"}</code> — short month, e.g. <code>Apr</code></li>
              <li><code>{"{MONTH}"}</code> — full month name, e.g. <code>April</code></li>
            </ul>
            <p className="mt-3">
              Template must contain <code>{"{SEQ}"}</code> somewhere. Reset period controls when the counter rolls back to 1 — usually you want <em>yearly</em> so you don't get a 5-digit invoice number by December.
            </p>
          </div>

          <div className="space-y-4">
            {series.map((s) => (
              <NumberSeriesEditor key={s.sequenceName} initial={s} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
