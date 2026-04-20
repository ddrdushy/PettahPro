import Link from "next/link";
import { nav } from "@/lib/content";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b-hairline border-border bg-offwhite/90 backdrop-blur">
      <div className="container-p flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2" aria-label="PettahPro home">
          <span className="text-h3 font-medium tracking-tight text-charcoal">
            Pettah<span className="text-mint-dark">Pro</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
          {nav.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-body text-text-secondary transition-colors hover:text-charcoal"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link href={nav.signIn.href} className="hidden text-body text-charcoal hover:opacity-70 sm:inline">
            {nav.signIn.label}
          </Link>
          <Link href={nav.cta.href} className="btn-primary text-small">
            {nav.cta.label}
          </Link>
        </div>
      </div>
    </header>
  );
}
