# Claude Code transfer brief — household-budget

Use this document to onboard **Claude Code** (or any assistant) on what this repo is, how it is structured, and what has been built so far. It complements `README.md` (setup) and `AGENTS.md` / `CLAUDE.md` (Next.js-specific agent rules).

---

## Product intent

- **Audience:** Two-person household (shared data, invite-based joining).
- **Direction:** Chase Track & Plan–style workflow: categories, learn-from-corrections rules, responsive UI (PWA-friendly goal).
- **Core loop:** Import or sync transactions → categorize (manually, rules, optional AI) → view dashboards and budgets → savings plans.

---

## Tech stack

| Layer | Choice |
|--------|--------|
| Framework | **Next.js 16.2.2** (App Router, React 19) |
| UI | **Tailwind CSS v4**, `next-themes`, Geist fonts |
| Backend / DB | **Supabase** (Postgres + Auth + RLS) |
| Bank linking | **Plaid** (`plaid`, `react-plaid-link`) — server routes + webhook |
| Charts | **Recharts** |
| CSV / spreadsheets | **Papaparse**, **xlsx** |
| Optional AI | **OpenAI** (server-only) for categorization / budget assist (see env) |

**Important:** `AGENTS.md` states this Next.js version may differ from older training data — check `node_modules/next/dist/docs/` when unsure about APIs or file layout.

---

## Repository facts

- **Path alias:** `@/*` → `./src/*` (`tsconfig.json`).
- **Auth session refresh:** `src/proxy.ts` — Supabase SSR client refreshes cookies on matched routes (not named `middleware.ts`; same role).
- **Strict TypeScript** is enabled.
- **Git:** Workspace may not be initialized as a git repo in all environments; do not assume git history exists.

---

## Environment variables

Copy `.env.local.example` → `.env.local`.

| Variable | Role |
|----------|------|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Required for app + browser client |
| `SUPABASE_SERVICE_ROLE_KEY` | Server/admin operations (Plaid, webhooks, some APIs) — **never** expose to client |
| `OPENAI_API_KEY` | Optional: auto-categorize, assistant, budget propose |
| Plaid: `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `PLAID_TOKEN_ENCRYPTION_KEY`, `PLAID_WEBHOOK_URL`, `NEXT_PUBLIC_APP_URL` | Bank linking (see `.env.local.example` comments) |

---

## Database and migrations

- **Location:** `supabase/migrations/*.sql`
- **README** walks through the **first two** files manually; the repo now has **many follow-on migrations** (Plaid, budgets, savings plans, income classification, subcategories, etc.).
- **For a new Supabase project:** apply **all** migration files in **lexicographic (timestamp) order** from `20260401000000_initial_schema.sql` through the latest file, unless you already have a DB that matches production (then only run new ones).

Representative migration themes (not exhaustive):

- Initial schema: households, members, accounts, categories, rules, transactions, RLS, RPCs (`create_household`, `join_household`, etc.).
- Category descriptions + Chase-style defaults.
- Description rules / rename history, transfer default category, income classification, credit-card payment category.
- Primary category groups (overview grouping).
- Rules: `amount_sign` on category rules.
- Savings plans + cadence/projection fields.
- Category budgets and reference data; subcategories; annual payment month; recurring payment metadata.
- Plaid: bank connections, encrypted tokens, `plaid_transactions`, sync state, `bank_account_id` / `plaid_transaction_id` on transactions, display names, ledger archive timestamps.

**RLS:** Data is scoped per household; server routes that bypass the user’s JWT use the admin client (`src/lib/supabase/admin.ts`) with care.

---

## App routes and navigation

- **Marketing / auth:** `/`, `/login`, `/signup`, `/setup`, `/auth/callback`, `/auth/auth-code-error`
- **Shell (requires user + household):** `src/app/(app)/layout.tsx` — sidebar, redirects to `/login` or `/setup`; includes `AiAssistantWidget`
- **Main nav** (`AppSidebar`): Overview (`/dashboard`), Transactions (`/transactions`), Plans (`/plans`), Settings (`/settings/...` — nested: general, bank, budget, categories, rules, etc.)

Other notable app paths (from file tree): `/income-rules`, `/category-rules`, `/categories` (some may parallel settings). Prefer matching existing URL patterns when adding pages.

---

## Major features implemented (high level)

### Households and auth

- Email signup/login via Supabase.
- **Household setup:** owner creates household; partner joins with **invite code** (`households.invite_code`, RPCs to regenerate).

### Transactions

- Full **transactions manager** UI (`src/components/transactions-manager.tsx` — large, central surface).
- **Amount convention:** negative = outflow, positive = inflow (documented in README; types in `src/types/finance.ts`).
- **Normalization** for rules: `src/lib/normalize-description.ts` and related helpers.
- **Ledger vs Plaid feed:** rows can be Plaid-only until promoted; soft **archive** (`ledger_archived_at`), **deduplication** (import vs Plaid, near-duplicates, manual panels).
- **Chase CSV import** (`src/components/chase-csv-import.tsx`) with Chase category matching helpers.

### Categories and rules

- Hierarchical **categories** with optional **subcategories** (one level).
- **Category rules** (`exact_normalized`, `contains`, `prefix`, **priority**, **amount_sign**).
- **Income rules** mirror pattern for overview include/exclude (`IncomeOverviewTreatment`).
- Application logic: `apply-category-rules.ts`, `apply-income-rules.ts`, `map-category-rule.ts`, etc.

### Plaid

- Link flow, token exchange, encrypted storage (`plaid-token-crypto.ts`), **sync** (`plaid-sync.ts` — `/transactions/sync`, cursors), **webhook** route.
- Promotion from feed to ledger (`promote-plaid-feed-to-ledger.ts`), supersede imported duplicates (`plaid-supersede-imported.ts`), feed mapping and hiding superseded pending (`map-plaid-transaction-feed.ts`, `plaid-feed-hide-superseded-pending.ts`).
- Dedupe API: `api/household/dedupe-plaid-duplicates`.

### Dashboard and analytics

- Overview charts and tables (`dashboard-overview-charts.tsx`, `dashboard-weekly-budget-table.tsx`, drilldown panels).
- Analytics helpers: `dashboard-analytics.ts`, `dashboard-overview-bucket-transactions.ts`, weekly budget / season logic (`weekly-spending-budget.ts`, `category-budget-season.ts`), primary groups (`primary-category-slugs.ts`, `attach-primary-group-to-transactions.ts`).

### Budgets

- Per-category budget fields on `CategoryRow` (period, annual month, date ranges, recurring flags).
- API: `api/household/category-budgets`, **spreadsheet import** and **AI propose** (`budget-import`, `budget-propose`, `parse-budget-spreadsheet.ts`, `budget-propose-openai.ts`, deterministic rollup).

### Savings plans

- Plans with targets, contributions, projection/pace (`savings-plan-*.ts`, `plans` page, managers and dashboard summary components).

### AI assistant

- Floating widget in app layout; routes under `api/household/assistant/chat` and `assistant/actions` (plus auto-categorize / classify-income where wired).

---

## API route handlers (Next.js)

Under `src/app/api/`:

- **Plaid:** `create-link-token`, `create-update-link-token`, `exchange-public-token`, `sync-transactions`, `bank-accounts`, `webhook`
- **Household:** `auto-categorize`, `classify-income`, `dedupe-plaid-duplicates`, `budget-import`, `budget-propose`, `category-budgets`, `assistant/chat`, `assistant/actions`

All are **Route Handlers** — use the project’s established Supabase server/admin patterns and env checks.

---

## Library / domain files worth knowing

| Area | Examples |
|------|-----------|
| Supabase clients | `src/lib/supabase/client.ts`, `server.ts`, `admin.ts` |
| Household | `src/lib/household.ts` |
| Types | `src/types/finance.ts` |
| Plaid | `plaid-server.ts`, `plaid-sync.ts`, `fetch-household-plaid-feed.ts` |
| Transactions fetch/map | `fetch-household-transactions.ts`, `map-transaction.ts` |
| Dedupe / duplicates | `find-duplicate-transaction-groups.ts`, `dedupe-plaid-vs-manual.ts`, `transaction-import-dedupe-key.ts` |

---

## Scripts

```bash
npm run dev    # Next dev server
npm run build  # Production build
npm run start  # Production server
npm run lint   # ESLint
```

---

## Conventions for new work

- Match existing component patterns (large client components colocated with small server pages where used).
- Prefer **focused changes**; avoid drive-by refactors in unrelated files.
- **Do not** put secrets in client code; service role and Plaid/OpenAI stay on the server.
- When changing schema, add a **new dated migration** under `supabase/migrations/` and describe what breaks for existing DBs if relevant.

---

## Gaps / README drift

- `README.md` “Data model notes” mention matching on `normalized_description` as a **next** step for some flows — verify current code paths before assuming it is unimplemented.
- Migration instructions in README should be treated as **minimum**; full feature set requires **all** migrations in the folder.

---

## Document maintenance

Update this file when you make **architectural** or **product-wide** changes (new integrations, auth changes, major new surfaces). Routine bugfixes usually do not need edits here.

_Last generated for Claude Code onboarding — project state as of repository snapshot including Next 16.2.2, React 19.2.4, and migrations through `20260420120000_category_budget_recurring_payment.sql`._
