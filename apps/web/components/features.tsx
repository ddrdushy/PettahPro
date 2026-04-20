import { Check } from "lucide-react";
import { features } from "@/lib/content";

export function Features() {
  return (
    <section id="features" className="section bg-surface-recessed">
      <div className="container-p">
        <div className="mx-auto max-w-2xl text-center">
          <span className="eyebrow">What you get</span>
          <h2 className="mt-4 text-h1 text-charcoal">Built for how Sri Lanka actually does business.</h2>
        </div>

        <div className="mt-16 space-y-24">
          {features.map((f, i) => (
            <article
              key={f.id}
              className={`grid items-center gap-10 md:gap-16 md:grid-cols-2 ${
                i % 2 === 1 ? "md:[&>div:first-child]:order-2" : ""
              }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="eyebrow">{f.eyebrow}</span>
                  {f.badge && (
                    <span className="rounded-full border-hairline border-border-emphasis px-2 py-0.5 text-micro uppercase tracking-wide text-text-tertiary">
                      {f.badge}
                    </span>
                  )}
                </div>
                <h3 className="mt-4 text-h1 text-charcoal">{f.title}</h3>
                <p className="mt-4 text-body-lg text-text-secondary">{f.body}</p>
                <ul className="mt-6 space-y-3">
                  {f.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-3 text-body text-text-primary">
                      <Check className="mt-[3px] h-4 w-4 flex-none text-mint-dark" aria-hidden />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <FeatureIllustration id={f.id} />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureIllustration({ id }: { id: string }) {
  return (
    <div
      aria-hidden
      className="aspect-[5/4] rounded-card border-hairline border-border bg-surface-elevated p-6 shadow-sm"
    >
      <div className="flex h-full flex-col justify-between">
        <div>
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Preview</p>
          <p className="mt-1 font-medium text-charcoal">{id.replace(/-/g, " ")}</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-8 rounded bg-surface-recessed" />
          ))}
        </div>
        <div className="flex items-center justify-between">
          <div className="h-2 w-16 rounded bg-mint-surface" />
          <div className="h-6 w-20 rounded bg-charcoal" />
        </div>
      </div>
    </div>
  );
}
