# Pricing Plan Architecture Spec — Multi-Tenant Accounting SaaS (Sri Lanka)

> The commercial shape of the platform — tier structure, feature gating, LKR pricing, usage limits, add-ons, migration pricing, support tiers, plan-change mechanics, grandfathering, coupon strategy, competitive positioning, and pricing-page design. Companion document to Super Admin (Layer 1), which holds the *mechanics* of plan management; this document defines the *values and strategy*. Target market: **Sri Lanka only**. Scope: **full system, not MVP**.

---

## 1. Scope & Foundational Principles

### 1.1 Architecture principle
**Structure is locked in this document; values are configurable via Super Admin.**

- What tiers exist, what's in each tier, how metrics are capped, how overages work — **locked here**
- Specific LKR prices, specific usage-limit numbers, specific add-on rates, specific overage rates — **editable in Super Admin's Platform Config** without code deploy

This reflects SL market reality: competitive landscape shifts, regulatory changes affect pricing, customer conversations reveal willingness-to-pay. Pricing must be tunable.

### 1.2 Commercial positioning summary
- **4-tier structure**: Starter / Growth / Scale / Enterprise (custom)
- **Hybrid feature gating** — core modules everywhere; advanced modules tier-gated; usage limits scale
- **Strategy B positioning vs BUSY** — match BUSY year-1 cost at Growth tier; value prop wins over 3 years
- **Add-on architecture** — buy individual advanced features without upgrading full tier
- **30-day full-feature trial** — no freemium, no card required, migration extension available
- **Monthly + Annual only** — 20% annual discount; no quarterly, no multi-year

### 1.3 Foundational decisions carried forward
- SL-only market; LKR single currency throughout
- Full system, not MVP — don't hold back features just to upsell
- Multi-role user reality — pricing doesn't penalize one-person-many-hats SME structure
- Data sovereignty — tenant can export + leave anytime

---

## 2. Tier Positioning

### 2.1 Starter
**For**: Single-branch shop or service business, 1-3 users, <100 invoices/month, Owner doing own bookkeeping.

**Target profile**:
- Pettah retail shop with single outlet
- Solo consultant / professional services
- Single-outlet clinic / salon
- Small restaurant or café

**Competitive anchor**: BUSY Basic (~LKR 35K one-time). We win on cloud + mobile + AI + migration support.

### 2.2 Growth
**For**: Multi-branch OR multi-user OR medium transaction volume. 3-15 users, 100-1000 invoices/month, has dedicated bookkeeper/cashier.

**Target profile**:
- Multi-branch textile wholesaler (Pettah + Kandy)
- Medium pharmacy (5-10 staff)
- Growing restaurant group (2-4 outlets)
- Multi-outlet retail chain

**Competitive anchor**: BUSY Standard (~LKR 60-80K one-time multi-user) + Tally multi-user (~LKR 90K). We win on cloud + branches + payroll + WhatsApp readiness.

### 2.3 Scale
**For**: Established SME with formal structure, 15-50 users, 1000+ invoices/month, has Accountant + Finance team, multi-branch, complex approvals.

**Target profile**:
- Distributor with 50+ suppliers
- 5+ branch retail chain
- Established manufacturer
- Mid-market service company

**Competitive anchor**: Tally Enterprise, Zoho Books Elite, entry-level SAP Business One (USD 1000+/user).

### 2.4 Enterprise (custom)
**For**: 50+ users, complex needs, API-heavy, white-label, negotiated pricing.

**Features**: Dedicated Customer Success Manager, priority support, custom integrations, white-label portals, all advanced modules included.

**Pricing**: Custom, anchored at LKR 300K/year minimum.

---

## 3. Feature Gating Philosophy

**Hybrid model** — three tiers of gating:

1. **Core** (everywhere) — essential business operations that every customer needs
2. **Tier-gated** — features unlock at higher tiers (Payroll in Growth+, API in Scale+)
3. **Add-on available** — lower-tier customers can buy individual advanced features without upgrading

This respects SL SME buying psychology (BUSY-style "pay for what you use") while creating natural upgrade paths.

---

## 4. Full Feature Matrix

| Feature | Starter | Growth | Scale | Enterprise |
|---|---|---|---|---|
| **Core modules** | | | | |
| Accounting (full engine) | ✅ | ✅ | ✅ | ✅ |
| Sell (invoicing, credit notes, AR) | ✅ | ✅ | ✅ | ✅ |
| Buy (PO, GRN, Bill, AP) | ✅ | ✅ | ✅ | ✅ |
| Inventory (basic) | ✅ | ✅ | ✅ | ✅ |
| Cheque module | ✅ | ✅ | ✅ | ✅ |
| Petty cash | ✅ | ✅ | ✅ | ✅ |
| Customer credit limits | ✅ | ✅ | ✅ | ✅ |
| VAT/SSCL compliance + return generation | ✅ | ✅ | ✅ | ✅ |
| **Branching** | | | | |
| Single branch | ✅ | ✅ | ✅ | ✅ |
| Multi-branch | ❌ (add-on) | ✅ | ✅ | ✅ |
| Multi-warehouse per branch | ❌ | ✅ | ✅ | ✅ |
| Cross-branch stock transfers | ❌ | ✅ | ✅ | ✅ |
| **Inventory depth** | | | | |
| Basic items + single UoM | ✅ | ✅ | ✅ | ✅ |
| Multi-UoM + variants | ❌ (add-on) | ✅ | ✅ | ✅ |
| Batch/serial/expiry tracking | ❌ (add-on) | ✅ | ✅ | ✅ |
| Landed cost tracking | ❌ | ✅ | ✅ | ✅ |
| ABC/XYZ classification | ❌ | ❌ | ✅ | ✅ |
| **People & Payroll** | | | | |
| User management (multi-role) | ✅ | ✅ | ✅ | ✅ |
| Basic attendance (manual/QR) | ✅ | ✅ | ✅ | ✅ |
| Payroll module (full) | ❌ (add-on) | ✅ | ✅ | ✅ |
| Biometric file import | ❌ | ✅ | ✅ | ✅ |
| Loans + bonus schemes | ❌ | ✅ | ✅ | ✅ |
| **Sales depth** | | | | |
| Basic invoicing + POS | ✅ | ✅ | ✅ | ✅ |
| Quotation + SO workflow | ❌ (add-on) | ✅ | ✅ | ✅ |
| Recurring/batch/consolidated invoicing | ❌ | ✅ | ✅ | ✅ |
| Commission engine | ❌ | ✅ | ✅ | ✅ |
| Customer portal | ❌ | ❌ | ✅ | ✅ |
| Loyalty program | ❌ (add-on) | ❌ (add-on) | ✅ | ✅ |
| FX sales (export invoicing) | ❌ | ❌ | ✅ | ✅ |
| **Procurement depth** | | | | |
| Basic PO/GRN/Bill | ✅ | ✅ | ✅ | ✅ |
| 3-way matching | ❌ | ✅ | ✅ | ✅ |
| Purchase requisitions (PR) | ❌ | ❌ | ✅ | ✅ |
| Supplier portal | ❌ | ❌ | ✅ | ✅ |
| FX on imports | ❌ | ✅ | ✅ | ✅ |
| **Accounting depth** | | | | |
| Standard reports (P&L, BS, TB) | ✅ | ✅ | ✅ | ✅ |
| Cash Flow Statement | ❌ | ✅ | ✅ | ✅ |
| Custom report builder | ❌ | ❌ | ✅ | ✅ |
| Budgeting module | ❌ | ❌ | ✅ | ✅ |
| Fixed Asset Register + dual depreciation | ❌ | ✅ | ✅ | ✅ |
| Recurring journals | ❌ | ✅ | ✅ | ✅ |
| External CA / auditor access | ❌ | ✅ | ✅ | ✅ |
| **Approvals** | | | | |
| Basic approval workflows | ✅ | ✅ | ✅ | ✅ |
| Multi-step chains | ❌ | ❌ | ✅ | ✅ |
| Custom workflow designer | ❌ | ❌ | ✅ | ✅ |
| **Integrations** | | | | |
| SL payment gateways | ✅ | ✅ | ✅ | ✅ |
| Bank file generation | ✅ | ✅ | ✅ | ✅ |
| Attendance file import | ❌ | ✅ | ✅ | ✅ |
| API access (REST) | ❌ | ❌ | ✅ | ✅ |
| Webhooks | ❌ | ❌ | ✅ | ✅ |
| **Advanced / Premium** | | | | |
| Manufacturing / BOM | ❌ (add-on) | ❌ (add-on) | ❌ (add-on) | ✅ |
| E-store integration | ❌ (add-on) | ❌ (add-on) | ❌ (add-on) | ✅ |
| White-label customer portal | ❌ | ❌ | ❌ | ✅ |
| Custom integrations | ❌ | ❌ | ❌ | ✅ |
| **Support** | | | | |
| Support tier | Email only | Email + chat | Email + chat + phone | Dedicated CSM |
| Support SLA (response) | 48 hours | 24 hours | 8 hours | 2 hours |
| Onboarding | Self-serve docs | 1-hour virtual | 2-hour virtual | Dedicated onboarding week |

---

## 5. Usage Limits (Super Admin Configurable Defaults)

| Metric | Starter | Growth | Scale | Enterprise |
|---|---|---|---|---|
| Users | 3 | 15 | 50 | Unlimited |
| Branches | 1 | 5 | 20 | Unlimited |
| Warehouses | 1 | 10 | 40 | Unlimited |
| Invoices/month | 200 | 2,000 | 20,000 | Unlimited |
| GRNs/month | 100 | 1,000 | 10,000 | Unlimited |
| Payslips/month | 5 (w/ add-on) | 50 | 200 | Unlimited |
| Storage | 2 GB | 20 GB | 200 GB | 1 TB |
| API calls/month | — | — | 100,000 | 1,000,000 |
| Document attachments | 5 MB/file | 10 MB/file | 25 MB/file | 100 MB/file |
| Audit log retention | 2 years | 5 years | 7 years | 10 years |
| Custom roles | 3 | 10 | Unlimited | Unlimited |
| Approval workflow templates | 5 | 20 | Unlimited | Unlimited |
| Document templates | 3 | 10 | Unlimited | Unlimited |

All numbers editable via Super Admin Plan Management. Adjust based on market feedback.

---

## 6. LKR Pricing (Super Admin Configurable Defaults)

### 6.1 Subscription pricing

| Tier | Monthly | Annual (20% off) | Annual total |
|---|---|---|---|
| Starter | LKR 2,500 | LKR 2,000/mo | LKR 24,000/year |
| Growth | LKR 6,000 | LKR 4,800/mo | LKR 57,600/year |
| Scale | LKR 15,000 | LKR 12,000/mo | LKR 144,000/year |
| Enterprise | Custom | Custom | Starting LKR 300,000/year |

### 6.2 Pricing rationale
- **Starter LKR 2-2.5K/mo**: accessible to single-shop Pettah retailers. Annual LKR 24K beats BUSY Basic's LKR 35K one-time, with dramatically more value.
- **Growth LKR 6K/mo**: annual ~LKR 58K ≈ BUSY Standard year-1. Matches Strategy B positioning.
- **Scale LKR 15K/mo**: premium. Annual LKR 144K substantially undercuts SAP B1 while signaling enterprise quality.
- **Enterprise LKR 300K+/year**: custom, typically 50+ users with dedicated CSM.

### 6.3 Market reference (for context)
- Zoho Books Standard SL: ~LKR 3,500/mo
- Zoho Books Professional SL: ~LKR 6,500/mo
- QuickBooks SL reseller: ~LKR 5-8K/mo
- Xero: ~LKR 9K/mo (USD converted)
- BUSY one-time: LKR 35-80K depending on edition
- Tally multi-user: ~LKR 90K one-time

---

## 7. Add-Ons (Configurable by Super Admin)

Tenants can buy individual features without full tier upgrade.

| Add-on | Billing | Default Price |
|---|---|---|
| Payroll module (for Starter) | Per month | LKR 2,000 |
| Multi-branch (for Starter) | Per additional branch/month | LKR 500 |
| Batch/Serial/Expiry tracking (for Starter) | Per month | LKR 1,000 |
| Quotation + SO workflow (for Starter) | Per month | LKR 800 |
| Manufacturing / BOM module | Per month | LKR 3,000 |
| E-store integration | Per month | LKR 2,500 |
| Loyalty program | Per month | LKR 1,500 |
| Extra users | Per 5 users/month | LKR 1,500 |
| Extra storage | Per 10 GB/month | LKR 500 |
| Premium OCR (Phase 2 — Chandra integration) | Per month | LKR 2,000 |
| Dedicated onboarding session | One-time | LKR 10,000 |
| Data migration (Assisted tier) | One-time | LKR 25,000-50,000 |
| Data migration (White-glove) | One-time | LKR 100,000+ |

### 7.1 Add-on lifecycle
- **Purchase**: immediate activation; pro-rated charge for remainder of cycle; add-on billing aligned with main subscription cycle
- **Remove**: takes effect at next renewal (same logic as downgrade); impact preview shown
- **Auto-removal on tier upgrade**: when tenant upgrades from Starter (with Payroll add-on) → Growth (Payroll included), add-on auto-removed (no double charge); confirmation shown
- **Upgrade recommendation**: if tenant has 3+ add-ons totaling more than tier upgrade cost, system suggests: *"You're paying LKR X/mo in add-ons. Growth plan includes all these for LKR Y/mo total — save LKR Z"*

### 7.2 Pricing logic
- Add-ons priced so 2-3 add-ons on Starter nudges toward Growth upgrade (natural graduation)
- Each add-on cheaper than tier jump — buying 2 add-ons saves vs upgrading
- Manufacturing + E-store priced as premium add-ons even for Scale — genuinely advanced
- Enterprise tier includes all add-ons by default

---

## 8. Overage Behavior (Hybrid Model)

### 8.1 Metrics with hard block (irreversible)
- Users
- Branches
- Storage
- Custom roles
- Workflow templates

Behavior: at 100% → new additions blocked; existing continue to function; upgrade required to add more.

### 8.2 Metrics with auto-overage billing (operational)
- Invoices/month
- GRNs/month
- Payslips/month
- API calls/month

Behavior: tenant continues to operate at cost; overage billed on next cycle.

### 8.3 Tenant overage cap protection
- Tenant sets maximum overage they'll tolerate (e.g. *"Don't let me exceed my plan by more than LKR 5K/month"*)
- At cap: system prompts for upgrade decision or auto-throttles
- Prevents bill shock

### 8.4 Warning levels
- **80%**: Owner dashboard tile + weekly email summary
- **95%**: prominent banner + upgrade CTA + email every 2 days
- **100%**: hard-block actions (for hard metrics) OR auto-overage with transparent billing (for operational)

---

## 9. Trial Strategy

### 9.1 Trial structure
- **30 days full-feature access** — trial gets all Scale-tier capabilities
- **No credit card required** at signup
- **Downgrade at trial end** — if tenant doesn't pick a plan, tenant auto-moves to Starter with trial feature lockouts (data preserved)
- **Migration extension**: if tenant is actively migrating, Super Admin can extend trial by 30 days (already in Super Admin billing ops)

### 9.2 No freemium
Permanent free tier rejected. Attracts non-payers, high support cost, confuses positioning. Trial is enough.

### 9.3 Trial end notifications
- 7 days before: email reminder with plan recommendations based on usage
- 3 days before: urgency nudge
- Day of expiry: payment prompt; data preserved if no action
- Post-expiry: 14-day grace (read-only); then data access restricted until payment

---

## 10. Billing Cycles

### 10.1 Monthly vs Annual
- **Monthly**: standard price, billed monthly, easier entry for cautious tenants
- **Annual**: 20% discount, billed once annually, cash flow benefit for us, higher retention

### 10.2 Not supported
- **Quarterly**: billing complexity not worth niche demand
- **Multi-year**: too long for a new platform where product evolves rapidly

### 10.3 Refund policy
- **Monthly plans**: no refunds (low-commitment already)
- **Annual plans**: pro-rated refund of unused months MINUS annual discount portion (fair — discount was given based on commitment)
- **Pause**: refund unused days on pre-paid annual plans

---

## 11. Plan Change Mechanics

### 11.1 Upgrade (Starter → Growth → Scale)
- **Takes effect immediately**
- Pro-rated charge for remainder of current cycle
- New features unlock instantly
- Usage limits raised instantly; current overages reset to zero on new cycle

### 11.2 Downgrade (Scale → Growth → Starter)
- **Takes effect at next renewal** (not instant)
- Reasons: prevent sudden data/feature loss; give tenant time to export or remove data exceeding new plan limits
- **Impact preview**: *"Downgrading to Growth on renewal will: disable API access, reduce users from 45 to 15 (you'll need to remove 30), reduce storage from 150GB to 20GB (export or delete 130GB)"*
- **Grace**: if tenant doesn't resolve overages by renewal, new writes blocked until resolved

### 11.3 Pause
- **Available on all plans** (not restricted to Scale)
- Tenant pauses → billing stops, data retained read-only
- 90-day max pause (re-pause allowed with 30-day gap)
- Resume anytime → billing resumes from resume date (no back-billing)

### 11.4 Cancel
- Available anytime, no lock-in
- Takes effect at next renewal (current period continues)
- Data retained 90 days post-cancellation
- Data export prompted in cancel flow
- Feedback reason captured for Super Admin churn analytics

---

## 12. Grandfathering Mechanics

### 12.1 Price increase
- **Existing tenants**: stay on old price until next renewal (respected via annual subscription) OR minimum 6-month grace on monthly plans
- **New signups**: get new price immediately
- **60-day notification** to existing tenants before grandfathering expires with rate-lock-in option (switch to annual now to lock current rate for another year)

### 12.2 Price decrease
- **Existing tenants**: auto-switched to new lower price on next renewal
- **Immediate application** option via Super Admin toggle (delight-the-customer mode)

### 12.3 Feature additions
- Additive change (e.g. moving "Customer portal" from Scale to Growth): existing tenants at Growth tier benefit immediately — get new feature free

### 12.4 Feature restrictions
- Restrictive change (e.g. moving feature from Starter to Growth): existing Starter tenants grandfathered — continue to have the feature; new Starter signups don't

### 12.5 Plan discontinuation
- **6-month notice**
- Migration path offered (closest equivalent plan)
- Pricing honored if equivalent available

---

## 13. Migration Tier Pricing

### 13.1 Tiers

| Tier | Price | Turnaround | Sources | Who does the work |
|---|---|---|---|---|
| **Self-serve** | Free (all plans) | <1 hour | CSV / Excel / Zoho Books export / QuickBooks IIF | Customer uploads, LLM field mapping, customer confirms |
| **Assisted** | LKR 25-50K one-time | 2-3 days | + BUSY .BDB / Tally XML | Our migration specialist: mapping + validation + 1 training session |
| **White-glove** | LKR 100-300K one-time | 1-2 weeks | Any source, multi-year history | Our specialist: full extraction + COA cleanup + UAT + phased cutover + 4-week support |

### 13.2 Price banding within tier
- Data volume (1 year vs 5 years history)
- Complexity (single-branch vs multi-branch vs multi-entity)
- COA alignment (standard SL COA vs custom/inherited mess)

### 13.3 Quoting workflow
1. Customer fills Migration Discovery Form (source system, history length, branches, transactions)
2. Super Admin reviews, sends fixed quote within 24 hours
3. Customer accepts → work begins
4. Payment on completion (Assisted) OR 50% upfront (White-glove)

### 13.4 Parallel-run included
- Assisted + White-glove: 30-day UiPath parallel-run at no extra cost
- Self-serve: customer migrates on own timeline (no parallel-run)

### 13.5 Tier independence
- Any subscription plan can purchase any migration tier
- Starter tenant can buy White-glove migration (rare but allowed)
- Enterprise customers typically get White-glove included in negotiated pricing

---

## 14. Support Tiers and SLAs

| Plan | Channels | Response SLA | Resolution target | Hours |
|---|---|---|---|---|
| Starter | Email only, help center | 48 hours | Best-effort | Business hours SLST |
| Growth | Email + chat | 24 hours | 5 business days | Business hours SLST |
| Scale | Email + chat + phone | 8 hours | 3 business days | 8am-8pm SLST Mon-Sat |
| Enterprise | All + dedicated CSM + Slack channel | 2 hours | Same day for critical | 24/7 for critical |

### 14.1 Critical issue definition (Enterprise 24/7)
- Platform-wide outage affecting customer's business operations
- Payment processing failure
- Data loss event
- Security breach

### 14.2 Non-critical (business-hours only)
- Feature questions, how-to, report issues, bug reports, enhancement requests

### 14.3 Ticket volume caps per plan
- Starter: soft cap 10 tickets/month (excess → nudge toward upgrade or help center)
- Growth: 30 tickets/month
- Scale: unlimited
- Enterprise: unlimited + dedicated CSM

### 14.4 Escalation path
Per Layer 1 log-first model:
- Tier 1: Logs + documentation (self-service, ~80% of issues)
- Tier 2: Customer provides context (screenshots, exports)
- Tier 3: Support agent responds
- Tier 4: Consent-gated impersonation (rare)

---

## 15. Coupon & Promotion Strategy

### 15.1 Acquisition coupons
- First month free for new signups
- 50% off first 3 months from specific source (Google Ads, partner referral)
- Trial extension (+30 days)
- Migration bundle discount (signup + migration at 20% combined)

### 15.2 Seasonal SL promotions
- **Avurudu promo** (April) — annual prepay discount
- **Back-to-business** (January) — first-month free
- **Year-end** — 13 months for price of 12 on annual prepay

### 15.3 Retention / win-back
- Win-back — 30% off 3 months for churned tenants returning within 6 months
- Loyalty bonus — after 12 months, next annual renewal at 10% off

### 15.4 Partner / channel
- Accountant referral — CA brings N clients, gets X% commission; clients get Y% off
- BUSY reseller conversion — former resellers bringing customer base get generous commission + clients get discount

### 15.5 Industry-specific
- Pharmacy vertical launch — first 50 pharmacy tenants at 50% off Year 1 (market-seeding)
- Restaurant vertical launch — similar first-N pattern

### 15.6 Geographic / economic
- Outside Colombo — small discount for Galle / Kandy / Jaffna / Matara customers (regional base building)

All managed via Super Admin coupon engine (Layer 1 spec).

---

## 16. Tenant Billing Operations

### 16.1 Payment methods accepted (tenant paying us)
- **Credit/debit card via PayHere** (primary — SL-local gateway)
- **Direct bank transfer** (annual prepayments, enterprise, cards-shy tenants)
- **Cheque** (enterprise / high-touch only)
- **FriMi / Genie / LankaQR** (monthly small-ticket Starter tenants)

### 16.2 Invoice delivery (from us to tenants)
- Email PDF on billing cycle
- Visible in tenant's Billing page (download anytime)
- Tax invoice with our VAT registration number, their VAT registration number, tax breakdown

### 16.3 Payment receipts
- Auto-generated PDF on successful payment
- Emailed + available in tenant billing page
- WHT handling: tenant can upload their WHT certificate if deducted on our invoice (B2B reality)

### 16.4 Invoice customization for tenants
- Tenants can add: purchase order number, cost center, custom reference (for their own bookkeeping)
- Their accounts team can download all our invoices for audit

### 16.5 Failed payment handling (tenant-facing)
- Clear in-app banner with reason (card expired, insufficient funds, etc.)
- Grace period countdown visible
- Update payment method CTA prominent
- Email cadence transparent — *"Retry 3 of 4; next retry [date]; suspension on [date] if still failing"*

---

## 17. Competitive Positioning

### 17.1 vs BUSY
- One-time license vs subscription — frame as 3-year TCO comparison:
    - BUSY 3-year TCO: LKR 180K+ (licence + yearly AMC + customizations)
    - Our Growth 3-year: LKR 172K (LKR 57.6K × 3) with dramatically more value
- Desktop-only vs cloud + mobile — their core weakness
- Reseller-dependent vs self-serve + remote support
- No AI, no WhatsApp readiness, no mobile — all our wins
- Migration: we handle it (their customers feel locked-in)

### 17.2 vs Tally
- Similar to BUSY — legacy desktop
- Tally has better accountant familiarity in SL
- Tally Prime is moving to cloud but retrofitted, clunky
- Our angle: cloud-native, SL-specific compliance, better UX for shopkeepers

### 17.3 vs Zoho Books
- Zoho is global SaaS with SL support but not SL-first
- Doesn't deeply integrate SL-specific: WHT, EPF, ETF, cheque lifecycle, SLIPS files
- Pricing roughly comparable
- Our angle: built for SL from day 1; every SL tax/statutory/bank quirk handled natively; Tamil + Sinhala support

### 17.4 vs QuickBooks
- QB is US-centric; weak SL compliance
- QB harder for non-accountants
- Our angle: same as Zoho — SL native, easier UX

### 17.5 vs SAP B1 / Odoo / NetSuite
- Only relevant at Enterprise tier
- Positioning: *"90% of SAP B1's capability at 20% of the cost"*
- We don't compete on enterprise manufacturing depth; we compete on SL-specific SME fit

### 17.6 Content formats
- Public comparison page on landing site (one per major competitor)
- Sales battlecard (internal, for sales conversations)
- **Migration ROI calculator** — tenant inputs (invoices, users, current software cost) → 3-year TCO comparison output

---

## 18. Pricing Page Design

### 18.1 Page structure

**Top**: Monthly / Annual toggle (Annual shows 20% savings)

**3 plan cards side by side** (Enterprise separate):
- Starter — LKR 2.5K/mo
- **Growth** — LKR 6K/mo (marked *"Most popular"*)
- Scale — LKR 15K/mo

**Each card shows**:
- Price (monthly or annual based on toggle)
- 1-line description (*"For solo shops"* / *"For growing SMEs"* / *"For established businesses"*)
- Top 5-7 features (not full list)
- Usage limit highlights (users, invoices/mo)
- *"Start free trial"* CTA (no credit card)
- *"See full features"* expand link

**Enterprise strip below**:
- *"Need more? Custom Enterprise plans available"*
- *"Contact sales"* CTA

### 18.2 Feature comparison table
- Expandable full matrix showing all features per tier
- Organized by module (Accounting / Sell / Buy / Inventory / People / etc.)
- Checkmarks, add-on markers, tier availability clearly shown

### 18.3 Add-ons section
- Separate block below main plans
- Cards for each add-on with price
- *"Customize your plan"* messaging

### 18.4 Migration tier cards
- Self-serve (free) / Assisted (LKR 25-50K) / White-glove (LKR 100K+)
- *"We'll handle the switch from BUSY, Tally, QuickBooks"*

### 18.5 FAQ
- Can I change plans later? (Yes, anytime)
- What if I exceed my limit? (Hybrid overage explained)
- Is there a contract? (No, cancel anytime)
- How does billing work? (Monthly or annual)
- What about data migration from BUSY? (Self-serve free, Assisted paid)
- Refund policy
- Do you support multiple currencies? (LKR only currently)

### 18.6 Trust signals
- *"No credit card for trial"*
- *"Cancel anytime"*
- *"Your data is yours — export anytime"*
- *"Built for Sri Lankan businesses"*

### 18.7 ROI calculator widget
- Linked from pricing page
- User inputs: current software cost/year, number of users, invoices/month
- Shows: our cost vs theirs, value delta (cloud access, AI time-savings, WhatsApp delivery readiness, etc.)

---

## 19. Business Model Targets (Internal Planning)

Not a product decision; informs pricing strategy.

### 19.1 Year 1 targets
- Signups: 200-300 tenants
- Trial → paid conversion: 40% = 80-120 paying tenants
- Mix: 60% Starter / 30% Growth / 10% Scale
- ARPT: ~LKR 4-5K/mo
- MRR end of Year 1: LKR 400-600K/month = LKR 5-7M ARR

### 19.2 Year 2 targets
- Signups: 800-1200 tenants (word-of-mouth kicks in)
- Conversion: 45%
- Paying tenants: 500-700
- Mix shift: 50% Starter / 35% Growth / 12% Scale / 3% Enterprise
- ARPT grows: ~LKR 5-6K/mo
- MRR end of Year 2: LKR 3-4M/month = LKR 40-50M ARR

### 19.3 Year 3 targets
- 2000+ paying tenants
- MRR LKR 10M+
- ARR LKR 120M+

### 19.4 Churn assumptions
- Starter: 5-8% monthly (price-sensitive)
- Growth: 2-3% monthly
- Scale: <1% monthly (sticky)
- Enterprise: <0.5% monthly

### 19.5 Key metrics to monitor (Super Admin dashboard)
- CAC (Customer Acquisition Cost)
- LTV (Customer Lifetime Value)
- LTV/CAC ratio (aim >3)
- Payback period (aim <12 months)
- Net Revenue Retention (aim >100% — existing tenants expand via add-ons + upgrades)

---

## 20. SL-Specific Bakes

- **LKR-only currency** throughout pricing
- **All competitive anchors** (BUSY, Tally, Zoho, Xero) priced in LKR
- **Seasonal promos aligned with SL calendar** (Avurudu April, Christmas December)
- **SL bank transfer** as payment method (for annual prepayments)
- **PayHere / FriMi / Genie / iPay / LankaQR** as subscription payment methods
- **WHT handling** on our B2B invoices (SL withholding tax reality)
- **SL VAT** on our invoices to tenants (we're VAT-registered; our invoices have VAT line)
- **Tamil + Sinhala** pricing page translation
- **Geographic pricing flexibility** for provincial discounts (coupon engine)

---

## 21. Data Model — Pricing Entities (Mostly in Layer 1)

Most entities live in Super Admin spec (Section 7, 8, 9). Pricing-specific additions:

```
Platform
  ├── Plan (versioned — from Layer 1)
  │     ├── PlanVersion (historical versions for grandfathering)
  │     ├── PlanUsageLimit (1:n per metric per version)
  │     ├── PlanFeatureMatrix (1:n — which features in which version)
  │     └── PlanPricing (1:n — LKR monthly + annual per version)
  ├── AddOn (1:n — platform-wide catalog)
  │     ├── AddOnPricing (1:n — versioned)
  │     ├── AddOnTierAvailability (n:n — which tiers can purchase)
  │     └── AddOnAutoIncludeRule (n:n — which tiers auto-include this)
  ├── TenantSubscription (1:n per tenant — current + history)
  │     ├── TenantPlanVersion (current plan version for grandfathering)
  │     ├── TenantAddOn (1:n active add-ons)
  │     ├── TenantOverageCap (1:1 — tenant's max tolerated overage)
  │     └── TenantGrandfatheringState (1:1 — what price they're locked at)
  ├── Coupon (1:n — from Layer 1)
  │     ├── CouponApplication (1:n — tenants who redeemed)
  │     └── CouponCampaign (1:n — tracking effectiveness)
  ├── MigrationQuote (1:n — per tenant per migration job)
  │     └── MigrationTier (classification: Assisted / White-glove)
  ├── SupportTicketCap (1:1 per tenant per month)
  └── BusinessModelKPI (1:n — daily/weekly/monthly snapshots for dashboard)
```

All tenant-specific entities (TenantSubscription etc.) scoped via RLS.

---

## 22. Deferred to Later Phases

- Multi-currency pricing (multi-country expansion)
- Quarterly billing cycle
- Multi-year commitments
- Permanent freemium tier
- Educational / non-profit pricing
- Usage-based pricing (per-transaction instead of per-seat)
- Marketplace add-ons (third-party developers sell add-ons)
- White-label reseller pricing (another entity resells our platform)
- Dynamic pricing based on customer size/industry

---

## 23. Next Steps

Remaining specs in queue:
1. **Migration flow IA** — BUSY / Tally / QuickBooks / Excel onboarding screens + AI field mapping UX + parallel-run dashboard
2. **Data model deep dive** — full ERD with RLS policies (technical handoff for engineering)
3. **Module-by-module UX mockups** — getting from specs to actual screen designs

---

*Document version: 1.0 · Module: Pricing Plan Architecture · Scope: Sri Lanka only · Full system (not MVP) · Owner: Automation Practice · Prepared for multi-tenant accounting SaaS (BUSY replacement)*

*Decisions consolidated across 4 rounds covering: 4-tier positioning (Starter / Growth / Scale / Enterprise) with target profiles and competitive anchors, hybrid feature gating philosophy (core everywhere + tier-gated + add-on availability), full 50-row feature matrix, Super-Admin-configurable usage limits and LKR prices (structure locked, values tunable), full add-on catalog with auto-removal on tier upgrade, hybrid overage model (hard-block for irreversible + auto-billing for operational + tenant overage cap), 30-day full-feature trial with no freemium and migration extension, monthly + annual billing only with 20% annual discount, complete plan-change mechanics (immediate upgrade with pro-rating, next-renewal downgrade with impact preview, pause on all plans, cancel anytime with data retention), full grandfathering rules, 3-tier migration pricing with banding logic and quoting workflow, 4-tier support SLAs with ticket caps, complete coupon strategy (acquisition/seasonal/retention/partner/industry/geographic), tenant billing operations with SL payment methods, comprehensive competitive positioning (BUSY/Tally/Zoho/QB/SAP) with ROI calculator, full pricing page design, internal business model targets (Y1-Y3 MRR/ARR projections), SL-specific bakes.*
