import { Check } from "lucide-react";
import { features } from "@/lib/content";
import { FeaturePreview } from "@/components/feature-previews";
import { Reveal } from "@/components/reveal";

export function Features() {
  return (
    <section id="features" className="section bg-surface-recessed">
      <div className="container-p">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="eyebrow">What you get</span>
          <h2 className="mt-4 text-h1 text-charcoal md:text-display">
            Built for how Sri Lanka actually does business.
          </h2>
        </Reveal>

        <div className="mt-16 space-y-24">
          {features.map((f, i) => {
            const reversed = i % 2 === 1;
            return (
              <article
                key={f.id}
                className="grid items-center gap-10 md:grid-cols-2 md:gap-16"
              >
                <Reveal className={reversed ? "md:order-2" : ""} delay={0}>
                  <div className="flex items-center gap-2">
                    <span className="eyebrow">{f.eyebrow}</span>
                    {"badge" in f && f.badge && (
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
                </Reveal>

                <Reveal className={reversed ? "md:order-1" : ""} delay={120}>
                  <FeaturePreview id={f.id} />
                </Reveal>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
