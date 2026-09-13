---
name: webhook-cron-auth
description: >-
  How to authenticate unauthenticated-by-default endpoints in this app — Vercel
  cron routes (src/app/api/cron/**) and third-party webhooks (e.g. Plaid at
  src/app/api/plaid/webhook). Use whenever you add or edit a cron job, a webhook
  receiver, or any route that runs without a logged-in user session. Covers
  failing closed on missing secrets and verifying provider signatures.
---

# Authenticating cron jobs and webhooks

These endpoints have no user session, so they must authenticate the *caller*.
Two recurring mistakes to avoid.

## Cron routes: fail CLOSED on a missing secret

Never compare the header against an interpolated env var directly:

```ts
// ❌ WRONG — if CRON_SECRET is unset, the target is the literal
// "Bearer undefined", which an attacker can send.
if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) ...
```

Use the shared guard in [`src/lib/cron-auth.ts`](../../../src/lib/cron-auth.ts),
which returns `false` when `CRON_SECRET` is unset and uses a constant-time
compare:

```ts
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  }
  // ...
}
```

Any new cron route must call this first, before touching the admin client.

## Webhooks: verify the provider's signature over the RAW body

A webhook body is attacker-forgeable on its own. Verify the provider's signature
**before doing any work**, and never `await request.json()` first — you need the
exact raw bytes for the hash check.

Pattern (see [`src/app/api/plaid/webhook/route.ts`](../../../src/app/api/plaid/webhook/route.ts)
and [`src/lib/plaid-webhook-verify.ts`](../../../src/lib/plaid-webhook-verify.ts)):

```ts
const rawBody = await request.text();
const verified = await verifyPlaidWebhook(
  plaid,
  request.headers.get("plaid-verification"),
  rawBody,
);
if (!verified) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
const payload = JSON.parse(rawBody);
```

A correct verifier checks all of:
- the signature (correct algorithm, key fetched from the provider by `kid`),
- freshness (`iat` within a few minutes — blocks replay),
- body integrity (SHA-256 of the raw body matches the signed claim), and
- key validity (reject expired/revoked keys).

For a **new** provider, prefer the provider's documented verification helper or
a vetted JWS/HMAC library over hand-rolling crypto. Reuse
`plaid-webhook-verify.ts` as the shape to follow (ES256 JWT + body-hash).

## Checklist

- [ ] Cron routes call `isAuthorizedCronRequest` and fail closed if the secret is unset.
- [ ] Webhooks read the raw body and verify the signature before parsing/working.
- [ ] Verification checks signature + freshness + body hash + key validity.
- [ ] Comparisons of secrets/hashes are constant-time (`timingSafeEqual`).
