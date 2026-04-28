# Household budget

Shared budgeting and spending tracker for two people, built with [Next.js](https://nextjs.org) and [Supabase](https://supabase.com). The goal is a Chase Track & Plan–style experience: categories, rules from corrections, and dashboards on phone and desktop (PWA-friendly responsive UI).

## Prerequisites

- Node.js 18+
- A free Supabase project ([app.supabase.com](https://app.supabase.com))

## 1. Install and run locally

```bash
cd household-budget
npm install
```

Then copy `.env.local.example` to `.env.local` (e.g. `copy .env.local.example .env.local` on Windows, or `cp` on macOS/Linux).

Edit `.env.local` with your Supabase **Project URL** and **anon/public key** (Project Settings → API in the Supabase dashboard).

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## 2. Create the database

In the Supabase dashboard, open **SQL Editor** → **New query**, paste the contents of:

`supabase/migrations/20260401000000_initial_schema.sql`

Run it once. This creates:

- Households and membership (with invite codes for a second person)
- Accounts, categories, category rules, transactions
- Row Level Security so only household members see their data
- RPCs: `create_household`, `join_household`, `regenerate_household_invite`

Then run the follow-up migration once (same SQL Editor):

`supabase/migrations/20260403000000_category_description_and_defaults.sql`

This adds optional **category descriptions**, **Chase-style default categories** for new households, `seed_default_categories`, `ensure_default_categories_for_my_household`, and updates **`create_household`** to insert those defaults automatically.

Turn on **Email** auth (**Authentication → Providers → Email**).

For local development, set **Authentication → URL Configuration**:

- **Site URL:** `http://localhost:3000`
- **Redirect URLs:** add `http://localhost:3000/auth/callback`

Then use **Create account** at [http://localhost:3000/signup](http://localhost:3000/signup) (strong password rules apply on the form). If **Confirm email** is enabled, users finish via the link to `/auth/callback`.

### Inviting your partner (in the UI)

1. Owner: sign in → **Set up household** (`/setup`) → **Start a household** → open **Overview** (`/dashboard`) and copy the **Partner invite** code (or use **New code** to rotate it).
2. Partner: create their own account → go to **`/setup`** → **Join with code** → enter the code.

## Project layout

| Path | Purpose |
|------|---------|
| `src/lib/supabase/client.ts` | Browser Supabase client |
| `src/lib/supabase/server.ts` | Server Components / Route Handlers |
| `src/proxy.ts` | Refreshes auth session cookies (Next.js proxy) |
| `src/lib/normalize-description.ts` | Shared normalization for rule matching |
| `supabase/migrations/` | Schema and RLS to apply in Supabase |

## Data model notes

- **Amount:** Use negative numbers for outflows (spending) and positive for inflows (income), or pick one convention and stay consistent in the UI.
- **Rules:** `category_rules` stores `exact_normalized`, `contains`, or `prefix` patterns with `priority`. Higher priority wins. Matching against `transactions.normalized_description` is the next feature to implement when adding the “this only vs all like this” recategorize flow.

## Learn more

- [Supabase + Next.js auth](https://supabase.com/docs/guides/auth/server-side/nextjs)
- [Next.js documentation](https://nextjs.org/docs)
