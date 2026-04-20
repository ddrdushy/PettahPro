import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
      <main className="flex flex-col">
        <header className="container-p pt-8">
          <Link href="/" className="inline-flex items-center gap-2" aria-label="PettahPro home">
            <span className="text-h3 font-medium text-charcoal">
              Pettah<span className="text-mint-dark">Pro</span>
            </span>
          </Link>
        </header>
        <div className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">{children}</div>
        </div>
        <footer className="container-p pb-8 text-caption text-text-tertiary">
          © {new Date().getFullYear()} PettahPro. Made in Sri Lanka.
        </footer>
      </main>

      <aside className="relative hidden flex-col justify-between overflow-hidden bg-mint-surface p-12 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-mint/60 blur-3xl animate-float"
        />
        <div className="relative max-w-md">
          <p className="text-caption uppercase tracking-wide text-mint-dark">PettahPro</p>
          <p className="mt-4 text-h1 text-charcoal md:text-display">
            Accounting for how Sri Lanka actually does business.
          </p>
          <p className="mt-6 text-body-lg text-text-secondary">
            Set up your business in under two minutes. Your 30-day trial starts instantly — no credit card.
          </p>
        </div>
        <ul className="relative space-y-3 text-body text-charcoal">
          <li className="flex items-center gap-3">
            <span className="h-1.5 w-1.5 rounded-full bg-mint-dark" aria-hidden />
            Sell, Buy, Inventory, Payroll — from one place
          </li>
          <li className="flex items-center gap-3">
            <span className="h-1.5 w-1.5 rounded-full bg-mint-dark" aria-hidden />
            VAT, WHT, EPF, PAYE — built in
          </li>
          <li className="flex items-center gap-3">
            <span className="h-1.5 w-1.5 rounded-full bg-mint-dark" aria-hidden />
            Import from your current system when you're ready
          </li>
        </ul>
      </aside>
    </div>
  );
}
