import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { finalCta } from "@/lib/content";

export function FinalCta() {
  return (
    <section className="bg-mint">
      <div className="container-p py-20 text-center">
        <h2 className="mx-auto max-w-2xl text-h1 text-mint-dark md:text-display">{finalCta.title}</h2>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href={finalCta.ctaPrimary.href} className="btn-primary text-body-lg">
            {finalCta.ctaPrimary.label}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link href={finalCta.ctaSecondary.href} className="text-body-lg font-medium text-mint-dark hover:opacity-70">
            {finalCta.ctaSecondary.label}
          </Link>
        </div>
      </div>
    </section>
  );
}
