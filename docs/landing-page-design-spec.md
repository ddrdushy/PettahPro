# Landing Page Design Spec — PettahPro

> Public-facing landing page specification for PettahPro — cloud accounting for Sri Lankan SMEs, replacing BUSY and Tally. Covers sections, menu structure, content inventory, and the split between static code and admin-configurable elements. Target market: **Sri Lanka only**. Aligned with PettahPro brand kit, UI system, and UX patterns.

---

## Table of Contents

1. [Audience](#1-audience)
2. [Brand application](#2-brand-application)
3. [Menu / header navigation](#3-menu--header-navigation)
4. [Page structure (top to bottom)](#4-page-structure-top-to-bottom)
5. [Admin-configurable (dynamic) elements](#5-admin-configurable-dynamic-elements)
6. [What should NOT be dynamic](#6-what-should-not-be-dynamic)
7. [Localization](#7-localization)
8. [SL-specific details to surface](#8-sl-specific-details-to-surface)
9. [Technical implementation](#9-technical-implementation)
10. [SEO and analytics](#10-seo-and-analytics)
11. [Performance targets](#11-performance-targets)
12. [Accessibility](#12-accessibility)
13. [Launch readiness checklist](#13-launch-readiness-checklist)

---

## 1. Audience

Two distinct visitors, both served by the same page:

- **Business owner / office manager** *(primary)* — typing on mobile, skeptical, Tamil/Sinhala/English mix, worried *"will this break my books?"*. Often in Pettah, Kandy, Galle, Jaffna, Negombo, Kurunegala commercial clusters. Currently running BUSY on a desktop in the back office, or Tally, or Excel, or paper.
- **IT / operations lead at a larger SME** *(secondary)* — evaluating against Zoho Books, ERPNext, Odoo, BUSY, Tally. Wants compliance, integrations, security proof. Will read the pricing, migration, and security sections closely before deciding.

The page must answer three questions in 10 seconds:

1. **What is this?** — Cloud accounting for SL SMEs
2. **Why is it better than what I use now?** — Cloud + mobile + SL-native compliance + migration handled for you
3. **How do I try it without risk?** — 30-day free trial, no card, migration included

---

## 2. Brand application

Per brand kit (`brand-kit.md`):

- **Name**: PettahPro (one word, CamelCase)
- **Primary tagline**: *"Accounting for how Sri Lanka actually does business"*
- **Palette**: Charcoal `#1A1A1A` + Mint `#7FB89A` on off-white `#FAFAF9` backgrounds
- **Typography**: Inter 400 + 500 only, Noto Sans Tamil/Sinhala fallbacks
- **Voice**: Direct, practical, warm, locally rooted. No buzzwords. Sentence case throughout.
- **Imagery**: Real SL businesses and people (when available), custom line illustrations otherwise. Never stock photography of Western office workers.

The landing page is the brand's most visible surface. It follows the brand kit rigorously.

---

## 3. Menu / header navigation

Sticky top bar, 64px height, off-white background with 0.5px bottom border. Left-to-right:

| Element | Content | Behaviour |
|---|---|---|
| Logo | PettahPro wordmark (charcoal, 28px height) | Links to home |
| Product ▾ | Features, AI-assisted entry, Mobile & POS, Integrations, Security | Mega-menu on desktop, accordion on mobile |
| Solutions ▾ | By industry: Wholesale, Pharmacy, Retail, Restaurant, Services, Manufacturing | Each links to a vertical-specific landing page |
| Pricing | Flat link | Dedicated `/pricing` page |
| Migration | Flat link | **Dedicated page — this is the wedge, give it menu real estate** |
| Resources ▾ | Blog, Guides, Customer Stories, Help Center | Dropdown |
| Language | EN / TA / SI toggle | Auto-detect on first visit; persist in cookie |
| Sign in | Text link (charcoal) | Returning users |
| Start free trial | Primary button (charcoal fill, white text) | Primary CTA |

Above the nav: an optional **announcement bar** — one line, dismissible — for launch offers, seasonal promos (Avurudu, Christmas, Vesak), or downtime notices. Fully admin-controlled. Height 40px. Mint surface background with charcoal text.

**Mobile**: Nav collapses to hamburger. Drawer slides in from right. Sign-in and Start free trial persist as buttons in the top bar (not hidden in drawer).

---

## 4. Page structure (top to bottom)

### 4.1 Hero (above the fold)

Two-column on desktop (60/40 split), stacked on mobile.

**Left column — copy**:
- Eyebrow pill (small label, mint surface background, 11px micro text): e.g. *"New — AI-assisted bill entry"* or *"30-day free trial"*
- **H1 headline**: *"Built for how Pettah actually does business"* (Display 44px, charcoal, 500 weight)
- **Subhead** (2 lines): *"The cloud accounting platform replacing BUSY and Tally for Sri Lankan SMEs. WhatsApp-ready. AI-assisted. Fully SL-compliant."* (18px body-large, text-secondary)
- Two CTAs:
  - Primary: *"Start 30-day free trial"* (charcoal button, large 48px)
  - Secondary: *"See how it works"* (outline button, large 48px) — opens 90-second product tour video in modal
- Small trust line under CTAs: *"No credit card. BUSY/Tally migration included."*

**Right column — product preview**:
- Clean UI screenshot showing dashboard with realistic SL data: LKR figures, Perera Textiles / Fathima Importers / Lanka Hardware as customers, mint/charcoal styling
- No fake drop shadow or 3D perspective — just the UI sitting on the page, credible
- Mobile: show phone frame with mobile dashboard view instead

**Tagline placement**: Primary tagline appears as supporting text lower in the hero or elsewhere on page, not as the H1. H1 is specific and confident; tagline is the brand summary.

### 4.2 Trust bar

Thin horizontal band beneath hero:
- **Pre-launch placeholder**: *"Now in private beta — trusted partners welcome. Request early access →"* (replaces customer logos until real logos exist)
- **Post-launch**: 5-8 real SL customer logos (grayscale, rotating) + one headline stat (e.g., *"LKR 2.3B in invoices processed"*)

**Do not** use fake customer counts or invented stats pre-launch. Use honest "private beta" language until there's real traction.

### 4.3 Problem → Solution (3-column block)

Three pains, each a short card (flat, 0.5px border, 12px radius, mint-accent left border for emphasis):

| Pain | PettahPro's answer |
|---|---|
| Stuck on desktop BUSY or Tally? | Cloud + mobile, works anywhere. Licenses never tied to one machine. |
| Hours lost typing supplier invoices? | Photo → AI-extracted → posted in seconds. OCR trained on SL invoices. |
| Afraid to switch? | We migrate your data for you, run BUSY and PettahPro in parallel for 30 days. |

Each card has a mint icon (Lucide: `cloud`, `scan-line`, `git-branch` — matching brand icon system).

### 4.4 Feature sections (4 alternating blocks)

Alternating image left/right, H2 + 2-line description + screenshot or short Loom-style video (silent, autoplay, looping, 15s max).

Suggested order:

1. **AI-assisted entry** — photo of a bill → OCR extracts vendor, amount, date, line items → user reviews → posts. Saves hours daily.
2. **WhatsApp-ready** *(Phase 2 preview — badged as "Coming soon")* — send invoices and payment reminders via WhatsApp. Customers pay with one tap.
3. **Real-time cash position** — see your cash, AR, AP, and P&L in one dashboard. Updated as transactions post, not at month-end.
4. **Multi-branch, multi-role, SL-native** — Pettah + Kandy branches, one place. Owner sees everything; cashier sees register; accountant sees books. All with SL compliance (VAT, WHT, EPF, PAYE, cheques) built in.

Each feature section: H2 (22px, 500 weight), supporting paragraph (16px body, text-secondary), UI screenshot or short video. Consistent whitespace.

### 4.5 How it works (3 steps)

Numbered horizontal strip (flat, centered):

1. **Sign up** — 2 minutes. No card. Your trial starts instantly.
2. **Import or start fresh** — Migrate from BUSY/Tally (we handle it) or begin clean today.
3. **Post your first invoice today** — Onboarding wizard walks you through it.

Optional: 60-second demo video link below.

### 4.6 Migration section *(wedge — give it real estate)*

The single most important section on the page. This is why visitors leave BUSY/Tally for PettahPro.

- **Headline**: *"Switching from BUSY, Tally, or QuickBooks? We'll handle it."*
- **Subhead**: *"30-day parallel run. Both systems running side-by-side. Switch only when your books match."*
- Logo row of supported sources: BUSY, Tally, QuickBooks, Zoho Books, Xero, Sage, Excel (grayscale logos)
- Three-tier card layout (card styling per UI system):

| Tier | Who it's for | Price | What's included |
|---|---|---|---|
| **Self-serve** | CSV/Excel users, small datasets | Free | CSV template, in-app import wizard, support docs |
| **Assisted** | BUSY/Tally users, typical SME | LKR 25,000 – 50,000 | Data extraction, field mapping, validation, parallel-run setup |
| **White-glove** | Complex setups, large datasets | LKR 100,000+ | Dedicated migration engineer, on-site visit, custom scripts, 60-day parallel run |

- Trust signal below cards: *"30-day parallel run included in Assisted and White-glove. Your books balance in both systems before you switch."*
- CTA: *"See migration plans →"* links to dedicated `/migration` page

### 4.7 Pricing

3-column cards (Starter / Growth / Scale) + Enterprise contact card.

Each card:
- Plan name + tagline
- Price (monthly/yearly toggle — yearly shows 20% discount)
- All prices in **LKR** (single currency)
- Feature checklist (9-10 key features, aligned with pricing-plan-architecture-spec)
- Primary CTA per card (Start free trial)

Growth tier marked as *"Most popular"* (mint ribbon per UI system card-recommended pattern).

Footnote: *"All plans include 30-day free trial. No credit card. Migration from CSV/Excel always free."*

Below pricing: FAQ-style reassurance strip:
- *Can I change plans later?* — Yes, anytime.
- *What if I hit my plan's limits?* — You'll get alerts before you do; upgrade when ready.
- *Is there a setup fee?* — No.

### 4.8 Industry solutions grid

6-8 vertical cards (flat card styling):
- Wholesale / distribution (primary)
- Pharmacy
- Retail (grocery, clothing, hardware)
- Restaurant / food service
- Services (consulting, salon, clinic)
- Manufacturing (small-scale)
- General SME

Each card links to its own SEO-optimized landing page (`/for/wholesale`, `/for/pharmacy`, etc.). Builds long-tail search traffic over time.

### 4.9 Testimonials

3 quote cards (once real customers exist — pre-launch: hidden or replaced with beta program CTA):
- Customer photo (44px avatar, per UI system spec)
- Short quote (1-3 sentences max)
- Name, role, business name + business logo
- Ideally one per vertical

All Sri Lankan customers with written consent for use. No stock photography. No invented testimonials pre-launch.

### 4.10 Trust & security

Badge row (Lucide icons + one-liner per badge):

- **SL VAT & WHT compliant** — built to IRD specifications
- **Bank-grade encryption** — TLS in transit, AES-256 at rest
- **Hosted in Singapore** — AWS ap-southeast-1, low-latency to SL
- **Regular security audits** — quarterly penetration testing
- **GDPR-ready** — subject access request support
- **SOC 2** *(when achieved — don't claim until audited)*

Below badges: link to `/security` page with full detail for IT-lead audience.

### 4.11 FAQ (accordion)

8-10 questions. Priority order:

1. Can I import my BUSY / Tally data?
2. Does this work offline?
3. Is my data safe if I cancel?
4. Do you support Tamil and Sinhala?
5. Is my data hosted in Sri Lanka?
6. Do you integrate with PayHere, FriMi, Genie, LankaQR?
7. How do refunds work?
8. Can my accountant log in?
9. What happens after my trial ends?
10. Who owns my data?

Answers should be direct and ≤3 sentences. No corporate fluff.

### 4.12 Final CTA banner

Full-width band with mint surface background. Centered content:

- H2: *"Start free. Migrate later. Cancel anytime."*
- Primary CTA (large): *"Start 30-day free trial"*
- Secondary link: *"Or book a 20-min walkthrough →"* (calendly link)

### 4.13 Footer

Five columns:

| Product | Solutions | Company | Resources | Legal |
|---|---|---|---|---|
| Features | By industry | About | Blog | Terms |
| Pricing | For accountants | Careers | Guides | Privacy |
| Migration | For enterprises | Contact | Help Center | Refund policy |
| Security | | Press | API docs | Cookie settings |
| Changelog | | | Status page | Data processing |

Below columns:
- PettahPro mark + address (Colombo registered office)
- Social icons (LinkedIn, Twitter, Facebook, Instagram — only channels that are actually active)
- Language switcher (again, for users who scrolled past the nav)
- Small newsletter signup (email + submit button)
- Copyright line: *"© 2026 PettahPro. Made in Sri Lanka for Sri Lankan businesses."*

---

## 5. Admin-configurable (dynamic) elements

Build a CMS-style admin surface where authorized platform admins can update each object without a code deploy.

| Object | Fields admin edits | Why dynamic |
|---|---|---|
| Announcement bar | Text, link, color, dismiss behavior, start/end dates | Seasonal promos (Avurudu, Christmas, Vesak) |
| Hero | Headline, subhead, CTA labels + URLs, hero image/video, trust line | A/B tests, campaigns |
| Eyebrow pill | Text, color, link | Feature launches, campaign flags |
| Customer logos | Upload logo, URL, alt text, order, active dates | Wins displayed as they happen |
| Stat counters | Number, label, optional live data source | Updated monthly |
| Feature blocks | Title, description, image/video, button, order | Launch new features without deploy |
| Migration sources | Logo, name, tier availability | Add connectors as built |
| Migration tiers | Name, price (LKR), turnaround, inclusions | Pricing experiments |
| Pricing plans | Name, price (LKR), included features, CTA | Pricing experiments, promos |
| Industry cards | Title, icon, short description, link, order, show/hide | Vertical focus shifts |
| Testimonials | Photo, quote, name, role, company logo, order | Customer stories |
| Trust badges | Image, label, link, active flag | New certifications earned |
| Payment gateway logos | Logo, label, link | PayHere, FriMi, Genie, iPay, LankaQR as supported |
| FAQ | Question, answer, category, order | Support team adds as questions recur |
| Footer links | Column groupings and individual links | Legal updates, new content |
| Translations | Per-language override of any string above (EN / TA / SI) | Community contributions |

**Implementation options**: headless CMS (Payload, Sanity, Strapi) — or a Postgres-backed admin built in Next.js alongside the main app. Render landing pages server-side for SEO; revalidate on CMS publish via ISR (incremental static regeneration).

---

## 6. What should NOT be dynamic

Draw the governance line clearly. Admin controls *content*, not *structure*:

- Layout grid and section order *(prevents design drift)*
- Brand colors and typography *(lives in code, theme tokens)*
- Legal pages *(separate content system with versioning and audit trail)*
- Section existence itself — don't let admin accidentally hide Pricing or remove the Footer
- Routing and URL structure
- Currency (LKR) and tax terminology (VAT, WHT, SSCL) — code-level constants for the SL market
- Brand name (PettahPro) — never configurable

If someone wants a new section type, that's an engineering ticket, not a CMS field.

---

## 7. Localization

Three languages supported from day one: **English (default), Tamil, Sinhala**.

Language switching is not just translation — it's cultural adaptation:

- Auto-detect on first visit (browser locale); persist choice in cookie
- **Tamil content for Pettah audiences needs a real copywriter, not machine translation** — the Pettah wholesaler can smell machine translation. Budget for native copy editing per language.
- **Sinhala content** similarly needs native voice — avoid literal translation of English marketing phrases.
- Currency: **LKR** always, formatted per SL convention (comma thousand separators, two decimal places: `LKR 2,50,000.00`)
- Date format: DD/MM/YYYY
- Phone format: `+94 XX XXX XXXX` with auto-format on input
- Tax terminology: **VAT** (not GST), with correct SSCL and WHT references
- Testimonials and customer logos rotated by region within SL where possible (Colombo, Kandy, Jaffna, Galle representation)
- Font stack honors language: Inter + Noto Sans Tamil / Noto Sans Sinhala (fallbacks per UI system typography spec)

### 7.1 Language-specific H1 examples

| Language | H1 variant |
|---|---|
| English | *"Built for how Pettah actually does business"* |
| Tamil | Needs native copywriter — do not use machine translation |
| Sinhala | Needs native copywriter — do not use machine translation |

The final Tamil and Sinhala taglines must come from a native speaker with marketing experience, not direct translation. Budget for this before launch.

---

## 8. SL-specific details to surface

These build credibility with a local audience:

- **Payment gateway logos** visible in pricing or trust section — PayHere, FriMi, Genie, iPay, LankaQR
- **Compliance copy** — SL VAT returns, SSCL handling, PAYE, EPF/ETF for payroll, Stamp Duty where applicable
- **Bank integration list** — Commercial Bank, HNB, Sampath, BOC, People's Bank, NDB, NSB (for disbursement file formats)
- **Courier partners** *(Phase 2)* — Pronto, Domex, Aramex SL, Pick Me Flash (for e-store / fulfilment module)
- **Hosting transparency** — *"Data hosted in Singapore AWS region (ap-southeast-1) for low latency and compliance"*
- **Support hours in SLST** — e.g., *"Mon-Sat 8am-8pm SLST"*
- **SL business forms** — IRD-ready VAT return file format, EPF C-form, ETF return, PAYE T-10
- **Cheque-aware** — built for SL cheque lifecycle (Bounced Cheques Act compliant)

---

## 9. Technical implementation

### 9.1 Stack

- **Framework**: Next.js (same as product app — shared components possible)
- **Rendering**: Server-side rendering (SSR) for SEO + incremental static regeneration (ISR) for CMS-updated pages
- **Hosting**: Vercel or AWS Amplify (for matching AWS infrastructure)
- **CMS**: See options in section 5

### 9.2 Component reuse

The landing page shares design tokens and select components with the product app:
- Buttons, cards, form elements — reuse from UI system
- Logo, typography, colors — identical tokens
- Icons — same Lucide set

**Do NOT** reuse:
- Navigation (landing page nav is marketing-specific, different from product sidebar)
- Product-specific components (dashboards, tables, etc.)

### 9.3 URL structure

```
pettahpro.lk/                   — home (this spec)
pettahpro.lk/pricing            — pricing detail
pettahpro.lk/migration          — migration wedge page
pettahpro.lk/security           — security detail
pettahpro.lk/for/wholesale      — industry landing
pettahpro.lk/for/pharmacy       — industry landing
pettahpro.lk/blog               — blog index
pettahpro.lk/blog/{slug}        — blog post
pettahpro.lk/help               — help center
pettahpro.lk/about              — about us
pettahpro.lk/contact            — contact
pettahpro.lk/terms              — legal
pettahpro.lk/privacy            — legal
app.pettahpro.lk/signup         — signup (app subdomain)
app.pettahpro.lk/login          — login
```

### 9.4 Environment variants

- **Production**: `pettahpro.lk`
- **Staging**: `staging.pettahpro.lk` (password-protected)
- **Preview deploys**: `pr-{number}.pettahpro.lk` (per-PR preview URLs)

---

## 10. SEO and analytics

### 10.1 SEO priorities

Target keywords (Sri Lanka context):
- "cloud accounting Sri Lanka"
- "BUSY alternative Sri Lanka"
- "Tally replacement Sri Lanka"
- "accounting software Pettah"
- "VAT software Sri Lanka"
- "payroll software Sri Lanka"
- "accounting software Sinhala/Tamil"
- Industry + location combinations ("pharmacy accounting Sri Lanka", "wholesaler accounting Colombo")

### 10.2 On-page SEO

- Every page has unique title, meta description, OG image
- Structured data (JSON-LD) for Organization, Product, FAQ, BreadcrumbList
- Fast loading (see performance targets)
- Mobile-first responsive
- Language hreflang tags for EN/TA/SI variants
- Sitemap auto-generated and submitted to Google/Bing
- robots.txt allows indexing

### 10.3 Analytics

- **Privacy-respecting analytics** — Plausible, Fathom, or self-hosted Umami (not Google Analytics by default — EU privacy concerns, and SL audience doesn't require GA4)
- Track: page views, signup funnel (land → signup start → signup complete → email verify → first login → first invoice posted)
- A/B testing framework for hero variants, CTA wording, pricing display
- No third-party tracking cookies

### 10.4 Conversion goals

Tracked events:
- `cta_click_start_trial`
- `cta_click_book_demo`
- `signup_started`
- `signup_completed`
- `migration_inquiry`
- `pricing_viewed`
- `video_played`

Funnel analysis feeds back into landing page optimization.

---

## 11. Performance targets

Landing page is marketing — speed is revenue.

| Metric | Target |
|---|---|
| Largest Contentful Paint (LCP) | < 2.0s |
| First Input Delay (FID) | < 100ms |
| Cumulative Layout Shift (CLS) | < 0.1 |
| Total Blocking Time (TBT) | < 200ms |
| Page weight (compressed) | < 500KB for above-fold content |
| Lighthouse Performance score | > 90 |
| Lighthouse SEO score | > 95 |
| Lighthouse Accessibility score | > 95 |

### 11.1 Techniques

- Static generation where possible (ISR for dynamic sections)
- Image optimization via Next.js Image component (WebP/AVIF)
- Font loading: `font-display: swap`, preload critical fonts
- JavaScript splitting — don't ship the whole app to a landing page visitor
- Lazy-load below-fold images and videos
- CDN edge caching (Vercel Edge Network or CloudFront)
- No auto-playing videos with sound (respects user + saves bandwidth)
- No third-party scripts that block rendering

### 11.2 Low-bandwidth mode

SL internet is not uniformly fast. Test landing page on throttled 3G connection. Ensure core content (hero, CTA) is usable within 3 seconds on 3G.

---

## 12. Accessibility

Target: **WCAG 2.1 AA** (matches product app spec from ui-system.md).

Landing page specifics:

- All interactive elements keyboard-navigable (Tab, Enter, Esc)
- Focus indicators visible (charcoal ring per UI system)
- Color contrast verified (already done in brand kit — AA passing across all pairs)
- Alt text on every image (descriptive, not just "logo")
- Headings hierarchical (one H1, H2s follow, H3s within H2s — no skipping)
- Language attributes per text block (`lang="ta"` for Tamil content)
- Skip-to-main-content link at top of page
- Form labels visible (not placeholder-only)
- No auto-playing video with sound
- Respects `prefers-reduced-motion` for animations
- Screen reader tested (VoiceOver, NVDA) for the critical path: land → click CTA → reach signup form

---

## 13. Launch readiness checklist

Before the landing page goes live:

### 13.1 Content
- [ ] All placeholder text replaced with final copy
- [ ] Customer logos and testimonials removed or replaced with real ones (or pre-launch messaging used)
- [ ] Tamil and Sinhala copy reviewed by native speakers
- [ ] Legal pages finalized (Terms, Privacy, Refund, Cookie policy)
- [ ] FAQ answers reviewed for accuracy

### 13.2 Design
- [ ] All screens match PettahPro brand kit
- [ ] Images and videos optimized
- [ ] Responsive tested on mobile, tablet, desktop, large desktop
- [ ] All interactive states implemented (hover, focus, active, disabled)
- [ ] Dark mode considered (Phase 2 — if implementing now, test every section)

### 13.3 Technical
- [ ] Performance targets met (Lighthouse > 90)
- [ ] All CTAs link to correct destinations
- [ ] Forms submit correctly (signup, newsletter, contact)
- [ ] Analytics events firing correctly
- [ ] 404 page designed and functional
- [ ] `robots.txt` and sitemap configured
- [ ] Structured data (JSON-LD) validated
- [ ] SSL certificate installed (HTTPS only, HSTS enabled)
- [ ] CMS admin tested for all dynamic elements

### 13.4 SEO
- [ ] Meta titles and descriptions set for every page
- [ ] Open Graph images generated for each page
- [ ] Hreflang tags set for EN/TA/SI variants
- [ ] Canonical URLs set
- [ ] Google Search Console verified
- [ ] Bing Webmaster Tools verified

### 13.5 Accessibility
- [ ] Axe DevTools audit passed
- [ ] Lighthouse Accessibility score > 95
- [ ] Keyboard navigation tested end-to-end
- [ ] Screen reader tested on critical path
- [ ] Color contrast verified on all pairs

### 13.6 Localization
- [ ] EN / TA / SI versions of all content
- [ ] Language switcher works correctly
- [ ] Locale persists across navigation
- [ ] Date, time, currency format correctly per locale

### 13.7 Legal & compliance
- [ ] Cookie consent banner (if using any cookies requiring consent)
- [ ] Privacy policy compliant with SL Data Protection Act + GDPR
- [ ] Terms of service reviewed by lawyer
- [ ] Refund policy clear
- [ ] Data processing addendum available on request

---

## Next steps

Three candidate follow-ups:

1. **Migration flow IA** — information architecture for the BUSY/Tally migration onboarding experience (the wedge we talk about on this landing page must be delivered seamlessly in-product)
2. **Industry landing pages** — templates for `/for/wholesale`, `/for/pharmacy`, etc. — each a SEO-optimized variant of this home page focused on a single vertical
3. **Blog + content strategy** — editorial calendar, topics, authors, distribution

---

*Document version: 3.0 · Scope: Sri Lanka only · PettahPro landing page specification · Aligned with brand-kit.md, ui-system.md, ux-patterns.md*
