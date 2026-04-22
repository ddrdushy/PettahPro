# PettahPro Build Status

Living counterweight to [`_roadmap.md`](./_roadmap.md). The roadmap says what's shipped; this says what's *broken, fragile, or at-risk right now.* Consult before picking up any task that touches a listed module — the fastest way to ship a regression is to assume everything is fine because a feature is in the "shipped" list.

Every PR should end with a check: does anything here need to be added, cleared, or bumped?

Last updated: 2026-04-22 (PR #48 — RLS hardening: non-superuser app role + SECURITY DEFINER auth helpers)

---

## 1. Known bugs

Open bugs, grouped by module. **Severity**: `S1` = data loss or posting correctness, `S2` = workflow broken, `S3` = UX / cosmetic. Include a reproducer when you have one.

| # | Module | Severity | Summary | Reproducer | Opened |
|---|---|---|---|---|---|
| — | — | — | *No known open bugs.* | — | — |

> Adding one? Keep the reproducer concrete enough that a cold reader can hit it. Empty reproducer is fine if unknown — mark it "Unknown, reported by …".

---

## 2. Typecheck debt baseline (frozen 2026-04-22)

These errors existed *before* PR #44. Every one is known, intentional-ish, and not a blocker for shipping features. **Don't let the total grow.** New PRs should add zero new errors; fixing entries here is welcome but out-of-scope for feature PRs.

**Baseline total: 32 errors** — api: 21, web: 10, db: 1. PR #47 executed both queued sweeps: the `pdfResponse()` helper collapses 9 PDF-route `Buffer → BodyInit` errors into one typed boundary; the `nextDocumentNumber()` helper (now in `@pettahpro/db`) removes 6 destructure-pattern errors. Net −15 errors from the baseline (47 → 32). Remaining api errors are all `noUncheckedIndexedAccess` array-index access inside bills / invoices / cheques / payroll / salary-components / statutory and the dashboard aging-label union mismatch; remaining web errors are marketing tuple drift + one `TaxCode.taxType` field rename + the reveal.tsx TS2590.

### `packages/db` (1)

| File:Line | Error | Why we tolerate |
|---|---|---|
| `drizzle.config.ts` (top) | TS6059 — outside `rootDir` | `drizzle.config.ts` is at package root but tsconfig rootDir is `src/`. Fix = `exclude` it from the build tsconfig or move it. Low value; fix when adjusting tsconfig next. |

### `apps/api` (21)

All `TS2339: Property 'X' does not exist on type '{…} | undefined'` and `TS2538: Type 'undefined' cannot be used as an index type` errors stem from the same root cause: **destructuring `await tx.execute(sql\`…\`)` results without guarding `undefined`** (under `noUncheckedIndexedAccess`). The fix pattern (already applied in `stock-transfers.ts`):

```ts
const rows = (await tx.execute(sql`…`)) as unknown as Array<{ … }>;
const first = rows[0];
if (!first) throw new Error("…");
```

| File:Line | Error | Notes |
|---|---|---|
| `modules/buy/bills.ts:506,601,602` | TS2538 × 3 | Array index access without guard |
| `modules/cheques/routes.ts:225,453` | TS2538 × 2 | Array index access without guard |
| `modules/hr/payroll-runs.ts:1166,1302,1303` | TS2538 × 3 | Array index access without guard |
| `modules/hr/salary-components.ts:170,213,370` | TS2538 × 3 | Array index access without guard |
| `modules/hr/statutory.ts:162,165` | TS2538 × 2 | Array index access without guard |
| `modules/reports/dashboard.ts:117,124,168,175` | TS2322 + TS2345 × 4 | `AgingBucket['label']` is a string literal union, dashboard uses generic `string` — fix is to narrow the computed label to the union or widen `AgingBucket` |
| `modules/sell/invoices.ts:742` | TS2322 `string \| undefined` → `string` | Missing null coalesce before assignment |
| `modules/sell/invoices.ts:761,859,860` | TS2538 × 3 | Array index access without guard |

### `apps/web` (10)

| File:Line | Error | Notes |
|---|---|---|
| `app/app/bills/[id]/page.tsx:36` | TS2339 `taxType` on `TaxCode` | Old field name; schema renamed. Trivial rename. |
| `components/features.tsx:28,30` | TS2339 `badge` on tuple union | Marketing site tuple type is too narrow. |
| `components/migration.tsx:34,39,58` | TS2339 `highlight` on tuple union | Same root cause as above (readonly tuples + optional member). |
| `components/pricing.tsx:56,61,86` | TS2339 `highlight` on tuple union | Same root cause. |
| `components/reveal.tsx:45` | TS2590 union too complex | `Motion` component type inference blowup. |

### Recommended debt-paydown sweeps (when we get to them)

1. ~~**`next_document_number` helper**~~ — **Done in PR #47**. Helper lives in `packages/db/src/next-document-number.ts` and is re-exported from `@pettahpro/db`. All 6 broken destructure call sites migrated.
2. ~~**PDF route `Buffer → BodyInit`**~~ — **Done in PR #47**. Helper lives in `apps/web/lib/pdf-response.ts`. All 9 PDF routes now call `pdfResponse(pdf, filename)` instead of hand-rolling the Response.
3. **Remaining `noUncheckedIndexedAccess` array-index leaks in `apps/api`** — bills / invoices / cheques / payroll / salary-components / statutory all still have 1–3 sites apiece. Same pattern: `const row = rows[i]; if (!row) throw …`. Mechanical sweep; ~15 minutes.
4. **Reports dashboard aging bucket labels** — widen the source or narrow via `as const` at the call site.
5. **Marketing tuple types** (`components/features.tsx`, `migration.tsx`, `pricing.tsx`) — add optional fields to the declared tuple type or use `satisfies`.

---

## 3. Fragile areas

Modules where a past change surprised us. Touch with care and re-test the listed surface.

| Module | What's fragile | What to re-test when touching |
|---|---|---|
| `postJournal` choke point (`apps/api/src/modules/accounting/journal-posting.ts`) | Every new module that posts accounting entries routes through here. Period-lock, approval-threshold, and balance-check are all enforced at this single point. A bad refactor here breaks every post-invoice / post-bill / payroll / bonus flow. | Post: invoice, bill, customer payment, supplier payment, payroll, bonus run, manual JE under + over approval threshold, JE into a soft-closed period. |
| `next_document_number(kind)` sequence helper | ~~Used by invoices, bills, delivery notes, POs, GRNs, payroll runs, stock transfers, bonus runs, journals.~~ **Now funnelled through `nextDocumentNumber(tx, kind)` in `@pettahpro/db`** (PR #47). 9 call sites still use the hand-rolled guard-and-return-error pattern because they're inside discriminated-union return shapes; those still need to return `{ error: "NUMBER_ALLOC_FAILED" }` rather than throw. Helper is the canonical shape for any new doc type. | Any new doc-type allocation: use `await nextDocumentNumber(tx, 'kind')`. |
| PDF routes (9 of them) | ~~All share the same `renderToBuffer` → `new Response(pdf)` pattern~~ **Now funnelled through `pdfResponse(pdf, filename)` in `apps/web/lib/pdf-response.ts`** (PR #47). Single place to change response headers, `Cache-Control`, `Content-Disposition`, or the Buffer-to-BodyInit boundary. | Any new PDF route: use `pdfResponse()`, don't hand-roll. |
| WAVG propagation on stock movements | `quantity_on_hand`, `total_value_cents`, `average_cost_cents`, `last_movement_at` on `item_balances` + matching `stock_ledger` row must move together. Any path that mutates one without the others silently breaks WAVG. | Bill post, invoice post, delivery-note deliver (if stockRelieveOn=deliver), credit-note post (reversal), stock-transfer dispatch + receive, future: stock count adjustments. |
| Multi-tenant via `withTenant` + `current_tenant_id()` | Every raw SQL query (`tx.execute(sql\`\`)`) must include `WHERE tenant_id = current_tenant_id()`. Forgetting this leaks across tenants. Drizzle ORM queries inherit the RLS context automatically; raw SQL does not. Since PR #48 the app connects as `pettahpro_app` (NOBYPASSRLS), so a missing tenant predicate on an RLS table will now silently return 0 rows instead of leaking — fail-closed but still a bug. | Search for new `tx.execute(sql\`` additions and verify tenant predicate. |
| Cross-tenant auth lookups | Signup/login/me run before we know the tenant, so they call SECURITY DEFINER helpers (`auth_find_user_by_email`, `auth_find_user_by_id`, `auth_email_in_use`, `auth_touch_last_login`) in `docker/postgres/init/44-auth-helpers.sql`. These functions are owned by the superuser and bypass RLS. Adding a new auth-time cross-tenant read means adding a new helper there — don't widen any existing one to return more columns. | Run signup → login → logout → login → /me end-to-end. Verify `Set-Cookie` fires, /me returns the right user/tenant pair. |
| Cheque lifecycle (9 states) | Every state transition has a reverse path; transitions are gated by current state + what document linked the cheque. | When adding a cheque-using module, run through: issued → handed → deposited → presented → cleared, and separately: bounced, stopped, cancelled, stale. |
| Payroll compute engine (`sl-tax`) | Used by regular payroll runs + bonus runs. Any change to EPF/ETF/PAYE math affects both. | Run a regular payroll + a bonus run (both flat_amount and percent_of_basic) and spot-check EPF/ETF/PAYE deductions. |
| Period lock on back-dated transactions | Soft-closed = warn, closed = block. Enforced in `postJournal`. Salary revisions also enforce against revision effective dates. | Try posting a JE into a closed period, try a salary revision effective in a closed period. |

---

## 4. Regression log

Bugs that shipped, were caught, and how. One-liner each. Teaches the project its own sore spots — consult before touching a module listed here.

| Date | PR | Module | What broke | How it was caught |
|---|---|---|---|---|
| — | — | — | *No shipped regressions logged yet.* | — |

> The point of this table isn't shame — it's so the next person touching that module knows where the landmines were.

---

## 5. Module health

Quick read on which corners are stale. `Tests`: "unit" = unit tests exist, "route" = API route-level tests exist, "—" = none. `Last touched` = most recent PR that substantively changed the module.

| Module | Last PR | Tests | Open issues | Notes |
|---|---|---|---|---|
| Auth / session | #1 | — | 0 | Foundational, hasn't needed change in ages — a good sign. |
| Customers | early | — | 0 | Stable. |
| Quotations | early | — | 0 | Stable. |
| Sales orders | early | — | 0 | Stable. |
| Delivery notes | early | — | 0 | Has `taxType` → new field name drift (see typecheck debt). |
| Invoices | early + #32 (period lock) + #35 (credit) + #36 (bad debt) | — | 5 typecheck | Heavy module. Any change risks post-flow. |
| Recurring invoices | mid | — | 0 | Hourly BullMQ cron. Has never misfired in dev but untested in load. |
| Credit notes | early + #46 (PDF) | — | 1 typecheck (new PDF route) | Stable. |
| Customer payments | early + #36 (bad debt reverse) | — | 1 typecheck | Stable. |
| Suppliers | early | — | 0 | Stable. |
| Purchase orders | early | — | 0 | Stable. |
| GRNs | early | — | 0 | Stable. |
| Bills | early + #45 (PDF) | — | 5 typecheck (4 existing + 1 new PDF route) | Feeds WAVG — fragile. See fragile areas §3. |
| Debit notes | early + #46 (PDF) | — | 1 typecheck (new PDF route) | Stable. |
| Supplier payments | early + #33 (WHT) | — | 1 typecheck | WHT integration here is non-obvious. |
| Items | early | — | 0 | Stable. |
| Stock on-hand / ledger | #43 (in-transit) | — | 0 | Just touched. |
| Stock transfers | #43 | — | 0 | Just shipped. |
| Low-stock report | mid | — | 0 | Stable. |
| Chart of accounts | early | — | 0 | Stable. |
| Tax codes | early | — | 0 | Schema field rename drift (see `bills/[id]/page.tsx:36`). |
| Journal entries | early + #32 + #37 | — | 1 typecheck | Choke point. See fragile areas. |
| Fixed assets | mid | — | 0 | Monthly depreciation cron, untested in load. |
| Bank reconciliation | mid | — | 0 | CSV parsing has sharp edges per bank. |
| Cheques | mid | — | 2 typecheck | 9-state lifecycle — fragile. |
| Period lock | #32 | — | 0 | Enforced in one place. See fragile areas. |
| WHT | #33 | — | 0 | Supplier-payment integration is non-obvious. |
| Opening balance | #34 | — | 0 | One-shot, has guardrails. |
| Credit enforcement | #35 | — | 0 | Stable. |
| Bad debt write-off | #36 | — | 0 | VAT-relief math is load-bearing. |
| JE approval workflow | #37 | — | 0 | SOD enforced. |
| Employees | early + #41 (exit) | — | 0 | Stable. |
| Salary components | early | — | 3 typecheck | Sprouted debt but functional. |
| Payroll runs | early + #41 (pro-rata) + #42 (bonus integration) | — | 4 typecheck | Compute engine = load-bearing. See fragile areas. |
| Leave types + requests | mid | — | 0 | Stable. |
| Statutory filings | mid | — | 2 typecheck | EPF/ETF/PAYE remit. |
| Salary revisions (arrears) | late | — | 0 | Period-lock enforced on revision dates. |
| Staff loans | late | — | 0 | Atomically claimed at draft. |
| Mid-period payroll events | #41 | — | 0 | Pro-rata engine. |
| Bonus schemes | #42 | — | 0 | Just shipped. |
| Reports (TB, P&L, BS, GL, VAT, cash flow) | mid | — | 0 | Read-only, low risk. |
| Reports (dashboard) | mid | — | 4 typecheck | Aging bucket label union mismatch. |
| AR aging / AP aging / 3-way match | mid | — | 0 | Stable. |
| Notifications | mid | — | 0 | In-app only so far. |
| Marketing site | ongoing | — | 8 typecheck | Tuple type drift. Doesn't affect app. |

---

## 6. Current environment drift (things to know)

Session-start checks that aren't bugs but will surprise you:

- **No CI gate exists yet.** `pnpm typecheck` is a local concern; broken typechecks won't fail a merge. If you want to raise the floor, a CI workflow that fails on **new** errors (baseline-delta, not total count) would be high-value. Not yet built.
- **No automated tests exist.** There is no `pnpm test` target that runs meaningfully. Every "test plan" in a PR is manual. Treat this as a known constraint, not a bug.
- **No lint on commit.** Prettier / ESLint exist but aren't gated. Style drift is low-priority but ambient.
- **`packages/db/drizzle.config.ts`** is outside the `rootDir` — see typecheck debt. Doesn't affect runtime, does affect `pnpm -r typecheck` exit code.

---

## 7. Update rules

Every PR should:

1. **Check §2 before blaming your own code** for a typecheck error.
2. **Add to §1** if you found (or caused) a new bug that isn't landing in this PR.
3. **Update §3** if you discovered something fragile, or if your PR hardened something (then remove / downgrade the entry).
4. **Add to §4** if a previously-shipped bug was fixed or a post-merge regression was caught.
5. **Bump `Last PR` in §5** for every module you touched substantively.
6. **Bump `Last updated`** at the top.

Don't be precious — stale is worse than terse. A one-line entry today beats a detailed one next month.
