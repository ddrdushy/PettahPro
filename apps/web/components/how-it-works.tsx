import { steps } from "@/lib/content";
import { Reveal } from "@/components/reveal";

export function HowItWorks() {
  return (
    <section id="how-it-works" className="section">
      <div className="container-p">
        <Reveal className="max-w-2xl">
          <span className="eyebrow">How it works</span>
          <h2 className="mt-4 text-h1 text-charcoal">Three steps to your first posted invoice.</h2>
        </Reveal>

        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {steps.map((s, i) => (
            <Reveal key={s.n} as="li" delay={i * 120}>
              <div className="relative h-full rounded-card border-hairline border-border bg-surface-elevated p-6 transition-all duration-300 hover:-translate-y-1 hover:border-charcoal hover:shadow-md">
                <div className="tabular-nums mb-3 text-caption font-medium uppercase tracking-wide text-mint-dark">
                  Step {String(s.n).padStart(2, "0")}
                </div>
                <h3 className="text-h3 text-charcoal">{s.title}</h3>
                <p className="mt-2 text-body text-text-secondary">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
