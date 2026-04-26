"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Users,
  Package,
  Boxes,
  Receipt,
  FileText,
  ShoppingCart,
  BookOpen,
  NotebookPen,
  Box,
  Building2,
  Wallet,
  Banknote,
  FileSignature,
  ScrollText,
  UsersRound,
  UserRound,
  Briefcase,
  Layers,
  FileBarChart,
  ClipboardCheck,
  Lock,
  Settings,
  Gift,
  LogOut,
  ShieldCheck,
  BadgePercent,
  Clock,
  type LucideIcon,
} from "lucide-react";

type Item = {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
  // Optional feature-flag gate. When set, the item is only rendered if
  // flags[requires] === true. Lets the sidebar respect tenant toggles
  // without the layout having to diff the nav array.
  requires?: keyof SidebarFeatureFlags;
  // Plan-feature gate (#67). Item stays in the nav but renders in a
  // locked state — padlock icon, greyed text, click routes to the plan
  // picker instead of the gated page. Shows users what's available on
  // higher tiers without exposing them to a 403. The feature-code
  // strings match the API's `plans.features` JSONB payload.
  requiresPlanFeature?: "payroll" | "approval_workflows" | "supplier_portal" | "ai_bill_entry";
};
type Group = { title?: string; items: Item[] };

export interface SidebarFeatureFlags {
  purchaseRequisitionsEnabled: boolean;
}

const nav: Group[] = [
  {
    items: [{ label: "Overview", href: "/app", icon: Home }],
  },
  {
    title: "Sell",
    items: [
      { label: "Customers", href: "/app/customers", icon: Users },
      { label: "Quotations", href: "/app/quotations", icon: FileText },
      { label: "Proforma invoices", href: "/app/proforma-invoices", icon: FileText },
      { label: "Sales orders", href: "/app/sales-orders", icon: ShoppingCart },
      { label: "Delivery notes", href: "/app/delivery-notes", icon: FileText },
      { label: "Invoices", href: "/app/invoices", icon: Receipt },
      { label: "Recurring invoices", href: "/app/recurring-invoices", icon: Receipt },
      { label: "Credit notes", href: "/app/credit-notes", icon: Receipt },
      { label: "Payments", href: "/app/payments", icon: Wallet },
      { label: "POS terminal", href: "/app/pos", icon: ShoppingCart },
      { label: "POS shifts", href: "/app/pos/shifts", icon: ClipboardCheck },
      { label: "Commissions", href: "/app/commissions", icon: BadgePercent },
    ],
  },
  {
    title: "Buy",
    items: [
      { label: "Suppliers", href: "/app/suppliers", icon: UsersRound },
      {
        label: "Purchase requisitions",
        href: "/app/purchase-requisitions",
        icon: ClipboardCheck,
        requires: "purchaseRequisitionsEnabled",
      },
      { label: "Purchase orders", href: "/app/purchase-orders", icon: ShoppingCart },
      { label: "Goods received", href: "/app/grns", icon: FileText },
      { label: "Bills", href: "/app/bills", icon: Receipt },
      { label: "Recurring bills", href: "/app/recurring-bills", icon: Receipt },
      { label: "Debit notes", href: "/app/debit-notes", icon: Receipt },
      { label: "Payments out", href: "/app/supplier-payments", icon: Banknote },
    ],
  },
  {
    title: "Stock",
    items: [
      { label: "Items", href: "/app/items", icon: Package },
      { label: "Categories", href: "/app/inventory/categories", icon: Layers },
      { label: "On hand", href: "/app/stock", icon: Boxes },
      { label: "Low stock", href: "/app/stock/low-stock", icon: Boxes },
      { label: "Transfers", href: "/app/stock/transfers", icon: Boxes },
      { label: "Stock counts", href: "/app/stock/counts", icon: ClipboardCheck },
    ],
  },
  {
    title: "Accounting",
    items: [
      { label: "Chart of accounts", href: "/app/coa", icon: BookOpen },
      { label: "Journal entries", href: "/app/journals", icon: NotebookPen },
      { label: "Recurring journals", href: "/app/recurring-journals", icon: NotebookPen },
      { label: "Journal approvals", href: "/app/journals/approvals", icon: ClipboardCheck },
      { label: "Opening balance", href: "/app/accounting/opening-balance", icon: BookOpen },
      { label: "Fiscal periods", href: "/app/accounting/periods", icon: Lock },
      { label: "WHT", href: "/app/accounting/wht", icon: FileBarChart },
      { label: "FX revaluation", href: "/app/accounting/fx-revaluation", icon: FileBarChart },
      { label: "Fixed assets", href: "/app/fixed-assets", icon: Box },
      { label: "Bank reconciliation", href: "/app/bank-reconciliation", icon: ScrollText },
      { label: "Cheques", href: "/app/cheques", icon: FileSignature },
      { label: "Petty cash", href: "/app/petty-cash", icon: Wallet },
      { label: "Budgets", href: "/app/accounting/budgets", icon: FileBarChart },
    ],
  },
  {
    title: "HR",
    items: [
      { label: "Employees", href: "/app/employees", icon: UserRound },
      { label: "Attendance", href: "/app/attendance", icon: Clock },
      { label: "Salary components", href: "/app/salary-components", icon: Layers },
      {
        label: "Payroll runs",
        href: "/app/payroll",
        icon: Briefcase,
        requiresPlanFeature: "payroll",
      },
      { label: "Final settlements", href: "/app/final-settlements", icon: LogOut },
      { label: "Leave types", href: "/app/leave-types", icon: Layers },
      { label: "Leave requests", href: "/app/leave-requests", icon: Briefcase },
      { label: "Staff loans", href: "/app/staff-loans", icon: Wallet },
      { label: "Loan types", href: "/app/loan-types", icon: Layers },
      { label: "Bonus runs", href: "/app/bonus-runs", icon: Gift },
      { label: "Bonus schemes", href: "/app/bonus-schemes", icon: Layers },
      { label: "Expense claims", href: "/app/expense-claims", icon: Receipt },
      { label: "Expense categories", href: "/app/expense-categories", icon: Layers },
    ],
  },
  {
    title: "Reports",
    items: [
      { label: "Executive KPIs", href: "/app/reports/exec-kpis", icon: FileBarChart },
      { label: "Trial balance", href: "/app/reports/trial-balance", icon: FileBarChart },
      { label: "P&L", href: "/app/reports/profit-loss", icon: FileBarChart },
      { label: "Balance sheet", href: "/app/reports/balance-sheet", icon: FileBarChart },
      { label: "General ledger", href: "/app/reports/general-ledger", icon: FileBarChart },
      { label: "VAT return", href: "/app/reports/vat-return", icon: FileBarChart },
      { label: "Cash flow", href: "/app/reports/cash-flow", icon: FileBarChart },
      { label: "Receivables aging", href: "/app/reports/ar-aging", icon: FileBarChart },
      { label: "Payables aging", href: "/app/reports/ap-aging", icon: FileBarChart },
      { label: "3-way match", href: "/app/reports/three-way-match", icon: FileBarChart },
      { label: "Bad debts", href: "/app/reports/bad-debts", icon: FileBarChart },
      { label: "Budget vs actual", href: "/app/reports/budget-vs-actual", icon: FileBarChart },
    ],
  },
  {
    title: "Admin",
    items: [
      { label: "Branches", href: "/app/branches", icon: Building2 },
      {
        label: "Approvals",
        href: "/app/approvals",
        icon: ClipboardCheck,
        requiresPlanFeature: "approval_workflows",
      },
      { label: "Audit log", href: "/app/audit-log", icon: ShieldCheck },
      { label: "Settings", href: "/app/settings", icon: Settings },
    ],
  },
];

// Human-readable labels for the plan-gate tooltip. We could derive this
// from the server catalogue at runtime, but a static map is both
// cheaper (no extra fetch) and lets the tooltip copy live next to the
// nav item it describes. When we add a new gated feature, TS's
// `requiresPlanFeature` union forces us to remember to update this map.
const PLAN_FEATURE_COPY: Record<
  NonNullable<Item["requiresPlanFeature"]>,
  { upgradeTo: string }
> = {
  payroll: { upgradeTo: "Growth" },
  approval_workflows: { upgradeTo: "Scale" },
  supplier_portal: { upgradeTo: "Scale" },
  ai_bill_entry: { upgradeTo: "Growth" },
};

export function Sidebar({
  featureFlags,
  planFeatures,
}: {
  featureFlags?: SidebarFeatureFlags;
  planFeatures?: string[];
} = {}) {
  const pathname = usePathname();
  const flags: SidebarFeatureFlags = featureFlags ?? {
    purchaseRequisitionsEnabled: false,
  };
  const activeFeatures = new Set(planFeatures ?? []);

  // Filter tenant-toggle items (stay hidden when disabled). Plan-gated
  // items are NOT filtered out — they render in a locked state so users
  // can see what's available one tier up. That's a deliberate design
  // choice: hiding them would make the product look smaller than it is
  // and give zero path to the upgrade conversation.
  const visibleNav: Group[] = nav
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        item.requires ? flags[item.requires] : true,
      ),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <aside
      aria-label="Primary"
      className="sticky top-16 hidden h-[calc(100vh-4rem)] w-60 shrink-0 overflow-y-auto border-r-hairline border-border bg-offwhite px-3 py-6 md:block"
    >
      <nav className="space-y-6">
        {visibleNav.map((group, gi) => (
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
                // Plan lock: feature required AND not in the tenant's
                // plan feature list. Clicks route to /app/settings/plan
                // so the user can see the upgrade path, not to the
                // gated page where they'd hit a 403.
                const planLocked =
                  item.requiresPlanFeature !== undefined &&
                  !activeFeatures.has(item.requiresPlanFeature);
                const lockCopy = planLocked
                  ? PLAN_FEATURE_COPY[item.requiresPlanFeature!]
                  : null;
                const href = planLocked
                  ? "/app/settings/plan"
                  : disabled
                    ? "#"
                    : item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={href}
                      aria-disabled={disabled || undefined}
                      aria-current={active ? "page" : undefined}
                      title={
                        lockCopy
                          ? `${lockCopy.upgradeTo} plan — click to upgrade`
                          : undefined
                      }
                      className={`group flex items-center gap-3 rounded-md px-3 py-2 text-small transition-colors ${
                        active
                          ? "bg-mint-surface text-charcoal"
                          : planLocked
                            ? "text-text-tertiary hover:bg-surface-recessed/40 hover:text-text-secondary"
                            : disabled
                              ? "text-text-tertiary"
                              : "text-text-secondary hover:bg-mint-surface/50 hover:text-charcoal"
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 ${active ? "text-mint-dark" : ""} ${planLocked ? "opacity-60" : ""}`}
                        aria-hidden
                      />
                      <span className="flex-1">{item.label}</span>
                      {item.badge && (
                        <span className="rounded-full border-hairline border-border px-1.5 py-0.5 text-micro uppercase text-text-tertiary">
                          {item.badge}
                        </span>
                      )}
                      {planLocked && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border-hairline border-border bg-surface-elevated px-1.5 py-0.5 text-micro font-medium text-text-tertiary"
                          aria-label={`Requires ${lockCopy?.upgradeTo} plan`}
                        >
                          <Lock className="h-2.5 w-2.5" aria-hidden />
                          {lockCopy?.upgradeTo}
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
