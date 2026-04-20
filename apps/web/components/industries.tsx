import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { industries } from "@/lib/content";
import { Reveal } from "@/components/reveal";

export function Industries() {
  return (
    <section id="industries" className="section bg-surface-recessed">
      <div className="container-p">
        <Reveal className="max-w-2xl">
          <span className="eyebrow">By industry</span>
          <h2 className="mt-4 text-h1 text-charcoal">Tuned to how your vertical actually works.</h2>
        </Reveal>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {industries.map((ind, i) => (
            <Reveal key={ind.name} delay={i * 80}>
              <Link
                href={`/for/${ind.name.toLowerCase()}`}
                className="group block h-full rounded-card border-hairline border-border bg-surface-elevated p-6 transition-all duration-300 hover:-translate-y-1 hover:border-charcoal hover:shadow-md"
              >
                <h3 className="text-h3 text-charcoal">{ind.name}</h3>
                <p className="mt-2 text-small text-text-secondary">{ind.blurb}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-small font-medium text-charcoal opacity-60 transition group-hover:gap-2 group-hover:opacity-100">
                  Learn more
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
