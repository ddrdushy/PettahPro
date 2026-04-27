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
        "sell/quotations",
        "sell/sales-orders",
        "sell/delivery-notes",
        "sell/credit-notes",
        "sell/customer-payments",
        "sell/recurring-invoices",
        "sell/proforma-invoices",
        "sell/customer-portal",
        "sell/pos",
      ],
    },
    {
      type: "category",
      label: "Buy",
      collapsed: true,
      items: [
        "buy/bills",
        "buy/purchase-orders",
        "buy/grns",
        "buy/supplier-payments",
        "buy/debit-notes",
        "buy/recurring-bills",
        "buy/purchase-requisitions",
        "buy/landed-cost",
      ],
    },
    {
      type: "category",
      label: "Inventory",
      collapsed: true,
      items: [
        "inventory/items",
        "inventory/stock-counts",
        "inventory/bundles",
        "inventory/stock-transfers",
        "inventory/categories",
        "inventory/batches-and-serials",
      ],
    },
    {
      type: "category",
      label: "Accounting",
      collapsed: true,
      items: [
        "accounting/chart-of-accounts",
        "accounting/journal-entries",
        "accounting/period-lock",
        // "accounting/cost-centers",
        // "accounting/budgets",
        // "accounting/wht",
        // "accounting/fx-revaluation",
        // "accounting/petty-cash",
        // "accounting/bank-reconciliation",
        // "accounting/cheques",
        // "accounting/fixed-assets",
        // "accounting/opening-balance",
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
      label: "Reports",
      collapsed: true,
      items: [
        "reports/trial-balance",
        "reports/profit-loss",
        "reports/balance-sheet",
        "reports/general-ledger",
        "reports/vat-return",
        "reports/cash-flow",
        "reports/aging",
        "reports/exec-kpis",
        "reports/trends",
        "reports/budget-vs-actual",
        "reports/three-way-match",
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
    {
      type: "category",
      label: "Platform admin",
      collapsed: true,
      items: [
        "platform/overview",
        "platform/tenants",
        "platform/impersonation",
        "platform/plans",
        "platform/addons",
        "platform/coupons",
        "platform/revenue",
        "platform/tenant-health",
      ],
    },
  ],
};

export default sidebars;
