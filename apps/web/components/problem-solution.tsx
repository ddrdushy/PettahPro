import { Cloud, ScanLine, GitBranch, type LucideIcon } from "lucide-react";
import { problems } from "@/lib/content";

const icons: Record<string, LucideIcon> = { Cloud, ScanLine, GitBranch };

export function ProblemSolution() {
  return (
    <section className="section">
      <div className="container-p">
        <div className="max-w-2xl">
          <span className="eyebrow">Why switch</span>
          <h2 className="mt-4 text-h1 text-charcoal">
            The problems with BUSY and Tally — solved.
          </h2>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {problems.map((p) => {
            const Icon = icons[p.icon] ?? Cloud;
            return (
              <article
                key={p.pain}
                className="relative rounded-card border-hairline border-border bg-surface-elevated p-6"
              >
                <div className="absolute left-0 top-6 h-8 w-[3px] rounded-r bg-mint" aria-hidden />
                <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-md bg-mint-surface text-mint-dark">
                  <Icon className="h-5 w-5" aria-hidden />
                </div>
                <h3 className="text-h3 text-charcoal">{p.pain}</h3>
                <p className="mt-2 text-body text-text-secondary">{p.answer}</p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
