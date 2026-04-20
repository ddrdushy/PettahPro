import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { industries } from "@/lib/content";

export function Industries() {
  return (
    <section id="industries" className="section bg-surface-recessed">
      <div className="container-p">
        <div className="max-w-2xl">
          <span className="eyebrow">By industry</span>
          <h2 className="mt-4 text-h1 text-charcoal">Tuned to how your vertical actually works.</h2>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {industries.map((ind) => (
            <Link
              key={ind.name}
              href={`/for/${ind.name.toLowerCase()}`}
              className="group rounded-card border-hairline border-border bg-surface-elevated p-6 transition hover:border-charcoal"
            >
              <h3 className="text-h3 text-charcoal">{ind.name}</h3>
              <p className="mt-2 text-small text-text-secondary">{ind.blurb}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-small font-medium text-charcoal opacity-60 transition group-hover:opacity-100">
                Learn more
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
