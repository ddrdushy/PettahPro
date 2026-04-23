"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: { href: string; label: string }[] = [
  { href: "/portal/invoices", label: "Invoices" },
  { href: "/portal/statement", label: "Statement" },
  { href: "/portal/payments", label: "Payments" },
  { href: "/portal/recurring", label: "Recurring" },
];

export function PortalNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-6 pb-2 pt-1">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              active
                ? "rounded-md bg-mint-surface px-3 py-1.5 text-small font-medium text-mint-dark"
                : "rounded-md px-3 py-1.5 text-small text-text-secondary transition-colors hover:bg-mint-surface/50 hover:text-charcoal"
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
