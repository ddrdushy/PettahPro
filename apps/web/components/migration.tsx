import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { migrationSources, migrationTiers } from "@/lib/content";
import { Reveal } from "@/components/reveal";

export function Migration() {
  return (
    <section id="migration" className="section bg-mint-surface/40">
      <div className="container-p">
        <Reveal className="max-w-3xl">
          <span className="eyebrow">Move at your own pace</span>
          <h2 className="mt-4 text-h1 text-charcoal md:text-display">
            Already using another system? We'll handle the move.
          </h2>
          <p className="mt-5 text-body-lg text-text-secondary">
            30-day parallel run. Your current system keeps working while we set PettahPro up beside it. You switch only when both match, book for book.
          </p>
        </Reveal>

        <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3 text-text-tertiary">
          <span className="text-small text-text-secondary">We migrate from:</span>
          {migrationSources.map((s) => (
            <span key={s} className="text-body font-medium text-text-secondary">
              {s}
            </span>
          ))}
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {migrationTiers.map((t, i) => (
            <Reveal key={t.name} delay={i * 120}>
              <article
                className={`relative h-full rounded-card border-hairline p-7 transition-all duration-300 hover:-translate-y-1 hover:shadow-md ${
                  t.highlight
                    ? "border-charcoal bg-surface-elevated shadow-sm"
                    : "border-border bg-surface-elevated hover:border-charcoal"
                }`}
              >
              {t.highlight && (
                <span className="absolute -top-3 left-6 rounded-full bg-mint px-3 py-0.5 text-micro uppercase tracking-wide text-mint-dark">
                  Recommended
                </span>
              )}
              <h3 className="text-h3 text-charcoal">{t.name}</h3>
              <p className="mt-1 text-small text-text-tertiary">{t.tagline}</p>
              <p className="tabular-nums mt-4 text-h2 text-charcoal">{t.price}</p>
              <ul className="mt-5 space-y-2.5">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-small text-text-primary">
                    <Check className="mt-[2px] h-4 w-4 flex-none text-mint-dark" aria-hidden />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                <Link
                  href="/migration"
                  className={t.highlight ? "btn-primary w-full" : "btn-secondary w-full"}
                >
                  {t.cta}
                </Link>
              </div>
            </article>
            </Reveal>
          ))}
        </div>

        <div className="mt-10 flex items-center justify-between rounded-card border-hairline border-border bg-surface-elevated p-5">
          <p className="text-small text-text-secondary">
            30-day parallel run included in Assisted and White-glove. Your books balance in both systems before you switch.
          </p>
          <Link href="/migration" className="btn-link">
            See migration plans
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
