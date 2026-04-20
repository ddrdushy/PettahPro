import { Cloud, ScanLine, GitBranch, type LucideIcon } from "lucide-react";
import { problems } from "@/lib/content";
import { Reveal } from "@/components/reveal";

const icons: Record<string, LucideIcon> = { Cloud, ScanLine, GitBranch };

export function ProblemSolution() {
  return (
    <section className="section">
      <div className="container-p">
        <Reveal className="max-w-2xl">
          <span className="eyebrow">Why teams pick PettahPro</span>
          <h2 className="mt-4 text-h1 text-charcoal">Three everyday pains. Solved.</h2>
        </Reveal>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {problems.map((p, i) => {
            const Icon = icons[p.icon] ?? Cloud;
            return (
              <Reveal key={p.pain} delay={i * 120}>
                <article className="group relative h-full rounded-card border-hairline border-border bg-surface-elevated p-6 transition-all duration-300 hover:-translate-y-1 hover:border-charcoal hover:shadow-md">
                  <div className="absolute left-0 top-6 h-8 w-[3px] rounded-r bg-mint" aria-hidden />
                  <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-md bg-mint-surface text-mint-dark transition-transform duration-300 group-hover:scale-110">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <h3 className="text-h3 text-charcoal">{p.pain}</h3>
                  <p className="mt-2 text-body text-text-secondary">{p.answer}</p>
                </article>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
