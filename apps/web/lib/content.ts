/**
 * Central content module for the landing page.
 *
 * Every admin-configurable element from landing-page-design-spec.md §5 lives here.
 * When we add a self-hosted CMS (Payload recommended), this file becomes the
 * contract — each exported object maps 1:1 to a CMS collection.
 */

export const announcement = {
  enabled: true,
  text: "PettahPro is in private beta — trusted SL businesses welcome.",
  linkText: "Request early access →",
  linkHref: "/beta",
};

export const nav = {
  items: [
    { label: "Product", href: "#features" },
    { label: "Migration", href: "#migration" },
    { label: "Pricing", href: "#pricing" },
    { label: "Industries", href: "#industries" },
    { label: "Resources", href: "/resources" },
  ],
  signIn: { label: "Sign in", href: "/login" },
  cta: { label: "Start free trial", href: "/signup" },
};

export const hero = {
  eyebrow: "New · AI-assisted bill entry",
  headline: "Built for how Pettah actually does business.",
  subhead:
    "Cloud accounting made in Sri Lanka, for Sri Lankan SMEs. AI-assisted, SL-compliant, and ready to run from Pettah to Jaffna.",
  ctaPrimary: { label: "Start 30-day free trial", href: "/signup" },
  ctaSecondary: { label: "See how it works", href: "#how-it-works" },
  trustLine: "No credit card. Migration included.",
};

export const problems = [
  {
    icon: "Cloud",
    pain: "Tied to one desktop in the back office?",
    answer:
      "Work from anywhere. Your books on your laptop at home, your phone on the road, the till at the counter — one set of numbers.",
  },
  {
    icon: "ScanLine",
    pain: "Hours lost typing supplier invoices?",
    answer:
      "Photograph it. PettahPro reads the vendor, date, amount, and line items. You review and post in seconds.",
  },
  {
    icon: "GitBranch",
    pain: "Switching systems feels risky?",
    answer:
      "We handle the move. Your current system keeps running while we set PettahPro up. You switch only when both match, end-to-end.",
  },
] as const;

export const features = [
  {
    id: "ai-entry",
    eyebrow: "AI-assisted entry",
    title: "Photograph a bill. Post it in seconds.",
    body: "Snap a supplier invoice with your phone. PettahPro reads the vendor, date, amount, and line items. You review and post. Trained on Sri Lankan invoice formats — Sinhala, Tamil, and mixed-language.",
    bullets: [
      "Works on receipts, GRNs, utility bills, cheque stubs",
      "Duplicate detection across suppliers",
      "Line-item review before posting — you stay in control",
    ],
  },
  {
    id: "whatsapp",
    eyebrow: "Coming soon",
    title: "Send invoices over WhatsApp.",
    body: "Deliver invoices and payment reminders the way Sri Lanka actually communicates. Customers pay with one tap via LankaQR or PayHere. Less chasing, faster cash in.",
    bullets: [
      "Payment links embedded — LankaQR, PayHere, FriMi, Genie, iPay",
      "Delivery receipts so you know they saw it",
      "Tamil, Sinhala, or English — per customer preference",
    ],
    badge: "Phase 2",
  },
  {
    id: "realtime",
    eyebrow: "Real-time dashboard",
    title: "See your cash position before breakfast.",
    body: "Cash on hand, receivables aging, payables due this week, profit this month — on one screen. Updated as transactions post, not at month-end.",
    bullets: [
      "Multi-branch view — Pettah, Kandy, Galle in one place",
      "Drill into any transaction from any number",
      "Mobile-first: the dashboard fits a phone",
    ],
  },
  {
    id: "sl-native",
    eyebrow: "SL-native compliance",
    title: "VAT, WHT, EPF, PAYE, cheques — built in.",
    body: "Sri Lankan compliance is part of the foundation, not an add-on. Statutory returns are auto-prepared. The cheque lifecycle follows the Bounced Cheques Act. When the IRD changes the rules, your system updates automatically.",
    bullets: [
      "VAT returns, SSCL, WHT certificates, EPF C-form, ETF R-form, PAYE T-10",
      "9-state cheque lifecycle with bounce-event tracking",
      "Bank disbursement files for Commercial, HNB, Sampath, BOC, People's, NDB, NSB",
    ],
  },
] as const;

export const steps = [
  {
    n: 1,
    title: "Sign up",
    body: "Two minutes. No credit card. Your 30-day trial starts instantly.",
  },
  {
    n: 2,
    title: "Import or start fresh",
    body: "We migrate from BUSY, Tally, QuickBooks, or Excel. Or begin clean today.",
  },
  {
    n: 3,
    title: "Post your first invoice today",
    body: "Onboarding wizard walks you through it. Help is one message away.",
  },
] as const;

export const migrationSources = [
  "BUSY",
  "Tally",
  "QuickBooks",
  "Zoho Books",
  "Xero",
  "Sage",
  "Excel",
];

export const migrationTiers = [
  {
    name: "Self-serve",
    tagline: "Coming from spreadsheets, small datasets",
    price: "Free",
    features: [
      "CSV import template",
      "In-app import wizard",
      "Migration guides and videos",
      "Community support",
    ],
    cta: "Start importing",
  },
  {
    name: "Assisted",
    tagline: "Typical SME with an existing system",
    price: "LKR 25,000 – 50,000",
    highlight: true,
    features: [
      "Data extraction from your current system",
      "Field mapping and validation",
      "30-day parallel-run setup",
      "Dedicated migration specialist",
      "Email and phone support",
    ],
    cta: "Talk to migration team",
  },
  {
    name: "White-glove",
    tagline: "Complex setups, large datasets",
    price: "LKR 100,000+",
    features: [
      "Dedicated migration engineer",
      "On-site visit in Colombo, Kandy, or Jaffna",
      "Custom extraction scripts",
      "60-day parallel run",
      "Priority 24/7 support",
    ],
    cta: "Request a call",
  },
] as const;

export const pricingPlans = [
  {
    name: "Starter",
    tagline: "Solo operators and very small teams",
    monthly: "LKR 4,900",
    yearly: "LKR 49,000",
    features: [
      "Up to 3 users",
      "500 invoices / month",
      "1 branch, 1 warehouse",
      "Sell, Buy, Inventory basics",
      "VAT, WHT, cheque lifecycle",
      "Email support",
      "30-day free trial",
    ],
    cta: "Start free trial",
  },
  {
    name: "Growth",
    tagline: "Growing SMEs — most popular",
    monthly: "LKR 12,900",
    yearly: "LKR 129,000",
    highlight: true,
    features: [
      "Up to 15 users",
      "Unlimited invoices",
      "3 branches, 5 warehouses",
      "Everything in Starter",
      "Payroll (EPF / ETF / PAYE)",
      "AI-assisted bill entry",
      "Priority email + chat support",
    ],
    cta: "Start free trial",
  },
  {
    name: "Scale",
    tagline: "Established businesses with multi-branch operations",
    monthly: "LKR 29,900",
    yearly: "LKR 299,000",
    features: [
      "Unlimited users",
      "Unlimited invoices",
      "Unlimited branches / warehouses",
      "Everything in Growth",
      "Supplier portal",
      "Advanced approval workflows",
      "Phone support + dedicated CSM",
    ],
    cta: "Start free trial",
  },
] as const;

export const industries = [
  { name: "Wholesale", blurb: "Pettah's home turf. Credit sales, cheques, aged receivables." },
  { name: "Pharmacy", blurb: "Batch, expiry, MRP enforcement, bin-card workflows." },
  { name: "Retail", blurb: "POS, barcode, multi-till, end-of-day cashup." },
  { name: "Restaurant", blurb: "Menu, tables, KOT, daily sales summary." },
  { name: "Services", blurb: "Retainers, recurring invoices, time-based billing." },
  { name: "Manufacturing", blurb: "BOM, routing, WIP, finished-goods costing." },
] as const;

export const trust = [
  { icon: "ShieldCheck", label: "SL VAT & WHT compliant", body: "Built to IRD specifications" },
  { icon: "Lock", label: "Bank-grade encryption", body: "TLS in transit, AES-256 at rest" },
  { icon: "Server", label: "Hosted in Singapore", body: "AWS ap-southeast-1, low latency to SL" },
  { icon: "FileCheck", label: "Quarterly audits", body: "Independent penetration testing" },
  { icon: "UserCheck", label: "GDPR-ready", body: "Subject access request support" },
  { icon: "Globe", label: "Tamil, Sinhala, English", body: "Trilingual customer documents" },
] as const;

export const faqs = [
  {
    q: "Can I bring my existing accounting data in?",
    a: "Yes. Our Assisted migration handles extraction, field mapping, and validation from most SL and global systems — BUSY, Tally, QuickBooks, Zoho, Xero, Sage, and spreadsheets. Your current system keeps running in parallel for 30 days so you switch only when both balance.",
  },
  {
    q: "Does this work offline?",
    a: "The POS does. Sales are queued locally when internet drops and sync when connectivity returns. The rest of the platform needs a connection.",
  },
  {
    q: "Is my data safe if I cancel?",
    a: "You own your data. Export the full books as Excel or CSV at any time — including after cancellation. We retain your data for 90 days post-cancellation, then delete permanently.",
  },
  {
    q: "Do you support Tamil and Sinhala?",
    a: "Yes. Customer-facing documents (invoices, receipts, payslips) render in English, Tamil, or Sinhala. The product UI is English initially, with Tamil and Sinhala coming.",
  },
  {
    q: "Is my data hosted in Sri Lanka?",
    a: "Currently AWS Singapore (ap-southeast-1) — the closest region with the reliability SL businesses need. Data sovereignty options under review.",
  },
  {
    q: "Do you integrate with PayHere, FriMi, Genie, LankaQR?",
    a: "PayHere and LankaQR are live. FriMi, Genie, and iPay integrations are in private beta with select customers.",
  },
  {
    q: "Can my accountant log in?",
    a: "Yes. Add your accountant as a user with read-only or full accounting access. Multiple accountants supported, each with their own audit trail.",
  },
  {
    q: "What happens after my trial ends?",
    a: "We'll email you 7 days before, then again at 3 days. Your data stays put. Pick a plan when you're ready — no auto-charge.",
  },
  {
    q: "Who owns my data?",
    a: "You do. Full stop. We process data on your behalf; we don't sell it, share it, or train third-party models on it.",
  },
] as const;

export const finalCta = {
  title: "Start free. Migrate later. Cancel anytime.",
  ctaPrimary: { label: "Start 30-day free trial", href: "/signup" },
  ctaSecondary: { label: "Book a 20-min walkthrough →", href: "/demo" },
};

export const footer = {
  columns: [
    {
      title: "Product",
      links: [
        { label: "Features", href: "#features" },
        { label: "Pricing", href: "#pricing" },
        { label: "Migration", href: "#migration" },
        { label: "Security", href: "/security" },
        { label: "Changelog", href: "/changelog" },
      ],
    },
    {
      title: "Solutions",
      links: [
        { label: "For wholesale", href: "/for/wholesale" },
        { label: "For pharmacy", href: "/for/pharmacy" },
        { label: "For retail", href: "/for/retail" },
        { label: "For accountants", href: "/for/accountants" },
      ],
    },
    {
      title: "Company",
      links: [
        { label: "About", href: "/about" },
        { label: "Careers", href: "/careers" },
        { label: "Contact", href: "/contact" },
        { label: "Press", href: "/press" },
      ],
    },
    {
      title: "Resources",
      links: [
        { label: "Blog", href: "/blog" },
        { label: "Guides", href: "/guides" },
        { label: "Help Center", href: "/help" },
        { label: "API docs", href: "/developers" },
      ],
    },
    {
      title: "Legal",
      links: [
        { label: "Terms", href: "/terms" },
        { label: "Privacy", href: "/privacy" },
        { label: "Refund policy", href: "/refund" },
        { label: "Cookie settings", href: "/cookies" },
      ],
    },
  ],
  address: "PettahPro · Colombo, Sri Lanka",
  copyright: "© 2026 PettahPro. Made in Sri Lanka for Sri Lankan businesses.",
} as const;
