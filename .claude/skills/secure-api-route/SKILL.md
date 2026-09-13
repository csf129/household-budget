---
name: secure-api-route
description: >-
  Rules for writing or reviewing Next.js route handlers in this app
  (src/app/api/**/route.ts) and server actions. Use whenever you add, edit, or
  review an API route, especially anything that reads or mutates household data,
  uses the Supabase service-role/admin client, or backs a Settings screen. Covers
  authentication, household scoping, and the head-only role check that RLS does
  NOT enforce.
---

# Securing API routes

Every route handler that touches household data must pass three gates, in order.
Getting any of them wrong is the most common class of bug in this codebase.

## 1. Authenticate + resolve household — use the shared guards

Do **not** hand-roll `supabase.auth.getUser()` + `getHouseholdForUser()` in each
route. Use the guards in [`src/lib/api-auth.ts`](../../../src/lib/api-auth.ts):

```ts
import { NextResponse } from "next/server";
import { requireHouseholdMember } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const auth = await requireHouseholdMember(supabase);
  if (auth instanceof NextResponse) return auth; // 401 / 403 already formed
  const { user, household } = auth;
  // ...
}
```

## 2. Enforce the head-only restriction where the UI does

RLS scopes every table to the household but grants **any member** full
read/write (`for all`). The Creator/Head/Family-member split is enforced only in
the UI (`(app)/settings/layout.tsx`). So a family member can call a settings
endpoint directly unless the route checks the role itself.

**If the route backs a head-only screen (anything under Settings — budgets,
credit cards, budget import, bank linking, AI/email settings), use
`requireHouseholdHead` instead of `requireHouseholdMember`.**

```ts
const auth = await requireHouseholdHead(supabase); // 403 for family members
if (auth instanceof NextResponse) return auth;
```

Use the *effective* role (view-as aware), which `requireHouseholdHead` already
does. Never gate on a role value sent in the request body or a cookie.

## 3. Scope every query to the resolved household

- With the user-JWT client (`createClient`), RLS enforces scoping, but still add
  `.eq("household_id", household.householdId)` on reads/writes for defense in
  depth and correct 404s.
- With the **admin/service-role client** (`createSupabaseAdminClient`), RLS is
  **bypassed entirely** — you MUST filter by `household.householdId` (or verify
  ownership first) on every query, or you leak/allow cross-household access.
  Only use the admin client when the user JWT genuinely can't (e.g. Plaid token
  secrets); resolve and check the household with the user client first.

## Input validation

- Parse `await request.json()` in a try/catch; return 400 on failure.
- Validate every field: whitelist enums (`new Set([...]).has(x)`), clamp numbers,
  cap string lengths, and confirm referenced ids belong to this household
  (see the `allowed` set pattern in `category-budgets/route.ts`).
- Never trust ids, roles, recipients, or amounts from the body without checking
  them against the caller's own household rows.

## Review checklist

- [ ] Auth gate present (`requireHouseholdMember` / `requireHouseholdHead`).
- [ ] Head check on every settings-mutation route.
- [ ] Admin-client queries all filtered by `household_id`.
- [ ] Body inputs validated; referenced ids confirmed in-household.
- [ ] No role/permission decision driven by request body or cookie.
