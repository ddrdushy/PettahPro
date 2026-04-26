import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

// Sidebar layout for the wiki. One sidebar (`main`) drives every
// page — the navbar Docs link points to it. Module groups mirror the
// product's nav: Sell / Buy / Inventory / Accounting / HR / Reports
// / Platform admin / Settings. Only categories with at least one
// landed page are listed — uncomment new categories as their first
// page lands. (Docusaurus refuses to build an empty category.)

const sidebars: SidebarsConfig = {
  main: [
    "intro",
    "getting-started",
    {
      type: "category",
      label: "Concepts",
      collapsed: false,
      items: ["concepts/glossary"],
    },
    {
      type: "category",
      label: "Sell",
      collapsed: true,
      items: [
        "sell/invoices",
        // "sell/quotations",
        // "sell/sales-orders",
        // "sell/delivery-notes",
        // "sell/credit-notes",
        // "sell/customer-payments",
        // "sell/recurring-invoices",
        // "sell/proforma-invoices",
        // "sell/customer-portal",
        // "sell/pos",
      ],
    },
    {
      type: "category",
      label: "HR & Payroll",
      collapsed: true,
      items: [
        "hr/payroll",
        // "hr/employees",
        // "hr/salary-components",
        // "hr/leave",
        // "hr/staff-loans",
        // "hr/bonus-runs",
        // "hr/expense-claims",
        // "hr/attendance",
        // "hr/final-settlements",
      ],
    },
    {
      type: "category",
      label: "Settings",
      collapsed: true,
      items: [
        "settings/overview",
        // "settings/branding",
        // "settings/document-templates",
        // "settings/number-series",
        // "settings/notifications",
        // "settings/approvals",
        // "settings/roles",
        // "settings/security",
        // "settings/demo-data",
      ],
    },
    // Categories below are TODO — each will be uncommented when its
    // first page lands. Docusaurus refuses to build empty categories,
    // so leaving them out keeps the build green during bootstrap.
    //
    // - Buy: bills, purchase-orders, grns, supplier-payments,
    //   debit-notes, recurring-bills, purchase-requisitions,
    //   landed-cost
    // - Inventory: items, stock-counts, stock-transfers, categories,
    //   bundles, batches-and-serials
    // - Accounting: chart-of-accounts, journal-entries, period-lock,
    //   cost-centers, budgets, wht, fx-revaluation, petty-cash,
    //   bank-reconciliation, cheques, fixed-assets, opening-balance
    // - Reports: trial-balance, profit-loss, balance-sheet,
    //   general-ledger, vat-return, cash-flow, aging, exec-kpis,
    //   trends, budget-vs-actual, three-way-match
    // - Platform admin: overview, tenants, impersonation, plans,
    //   addons, coupons, revenue, tenant-health
  ],
};

export default sidebars;
