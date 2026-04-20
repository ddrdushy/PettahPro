import Link from "next/link";
import { footer } from "@/lib/content";

export function Footer() {
  return (
    <footer className="border-t-hairline border-border bg-offwhite">
      <div className="container-p py-16">
        <div className="grid gap-10 md:grid-cols-[1.5fr_repeat(5,_1fr)]">
          <div>
            <Link href="/" className="inline-flex items-center gap-2" aria-label="PettahPro home">
              <span className="text-h3 font-medium text-charcoal">
                Pettah<span className="text-mint-dark">Pro</span>
              </span>
            </Link>
            <p className="mt-3 max-w-xs text-small text-text-secondary">
              Accounting for how Sri Lanka actually does business.
            </p>
            <form className="mt-6 max-w-xs">
              <label htmlFor="newsletter" className="text-caption uppercase tracking-wide text-text-tertiary">
                Newsletter
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  id="newsletter"
                  type="email"
                  required
                  placeholder="you@business.lk"
                  className="min-w-0 flex-1 rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal placeholder:text-text-tertiary focus:border-charcoal focus:outline-none"
                />
                <button type="submit" className="btn-primary px-4 py-2 text-small">
                  Join
                </button>
              </div>
            </form>
          </div>

          {footer.columns.map((col) => (
            <nav key={col.title} aria-labelledby={`f-${col.title}`}>
              <h3 id={`f-${col.title}`} className="text-caption uppercase tracking-wide text-text-tertiary">
                {col.title}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-small text-text-secondary hover:text-charcoal">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t-hairline border-border pt-6 text-small text-text-tertiary md:flex-row md:items-center">
          <p>{footer.copyright}</p>
          <p>{footer.address}</p>
        </div>
      </div>
    </footer>
  );
}
