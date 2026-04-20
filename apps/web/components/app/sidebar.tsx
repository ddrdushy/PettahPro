"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Users,
  Package,
  Receipt,
  ShoppingCart,
  BookOpen,
  Wallet,
  Banknote,
  UsersRound,
  FileBarChart,
  Settings,
  type LucideIcon,
} from "lucide-react";

type Item = { label: string; href: string; icon: LucideIcon; badge?: string };
type Group = { title?: string; items: Item[] };

const nav: Group[] = [
  {
    items: [{ label: "Overview", href: "/app", icon: Home }],
  },
  {
    title: "Sell",
    items: [
      { label: "Customers", href: "/app/customers", icon: Users },
      { label: "Invoices", href: "/app/invoices", icon: Receipt },
      { label: "Payments", href: "/app/payments", icon: Wallet },
    ],
  },
  {
    title: "Buy",
    items: [
      { label: "Suppliers", href: "/app/suppliers", icon: UsersRound },
      { label: "Bills", href: "/app/bills", icon: Receipt },
      { label: "Payments out", href: "/app/supplier-payments", icon: Banknote },
    ],
  },
  {
    title: "Stock",
    items: [{ label: "Items", href: "/app/items", icon: Package }],
  },
  {
    title: "Accounting",
    items: [
      { label: "Chart of accounts", href: "/app/coa", icon: BookOpen },
    ],
  },
  {
    title: "Reports",
    items: [
      { label: "Trial balance", href: "/app/reports/trial-balance", icon: FileBarChart },
      { label: "P&L", href: "/app/reports/profit-loss", icon: FileBarChart },
      { label: "Balance sheet", href: "/app/reports/balance-sheet", icon: FileBarChart, badge: "Soon" },
    ],
  },
  {
    title: "Admin",
    items: [{ label: "Settings", href: "/app/settings", icon: Settings, badge: "Soon" }],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      aria-label="Primary"
      className="sticky top-16 hidden h-[calc(100vh-4rem)] w-60 shrink-0 overflow-y-auto border-r-hairline border-border bg-offwhite px-3 py-6 md:block"
    >
      <nav className="space-y-6">
        {nav.map((group, gi) => (
          <div key={gi}>
            {group.title && (
              <p className="px-3 pb-2 text-caption font-medium uppercase tracking-wide text-text-tertiary">
                {group.title}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href || (item.href !== "/app" && pathname.startsWith(item.href));
                const disabled = !!item.badge;
                return (
                  <li key={item.href}>
                    <Link
                      href={disabled ? "#" : item.href}
                      aria-disabled={disabled || undefined}
                      aria-current={active ? "page" : undefined}
                      className={`group flex items-center gap-3 rounded-md px-3 py-2 text-small transition-colors ${
                        active
                          ? "bg-mint-surface text-charcoal"
                          : disabled
                            ? "text-text-tertiary"
                            : "text-text-secondary hover:bg-mint-surface/50 hover:text-charcoal"
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 ${active ? "text-mint-dark" : ""}`}
                        aria-hidden
                      />
                      <span className="flex-1">{item.label}</span>
                      {item.badge && (
                        <span className="rounded-full border-hairline border-border px-1.5 py-0.5 text-micro uppercase text-text-tertiary">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
