import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as cryptoVerify,
  type JsonWebKey,
} from "crypto";
import type { PlaidApi } from "plaid";

/**
 * Verify a Plaid webhook per Plaid's webhook-verification spec.
 * @see https://plaid.com/docs/api/webhooks/webhook-verification/
 *
 * The webhook body is unauthenticated on its own — anyone who learns an item_id
 * could otherwise POST to the endpoint and make us do work. Plaid signs each
 * delivery with an ES256 JWT in the `Plaid-Verification` header whose payload
 * pins a SHA-256 of the exact request body. We:
 *   1. parse the JWT header, require alg=ES256 and a key id (kid),
 *   2. fetch that key's public JWK from Plaid (cached, revocation-checked),
 *   3. verify the JWS signature,
 *   4. require the token to be recent (iat within 5 min), and
 *   5. require the pinned body hash to match the raw body we received.
 *
 * Any failure returns false — the caller must reject the request.
 */

type CachedKey = { jwk: JsonWebKey; expiredAt: number | null; fetchedAt: number };
const KEY_CACHE = new Map<string, CachedKey>();
const KEY_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // refresh keys daily
const MAX_IAT_SKEW_SEC = 5 * 60;

async function getVerificationJwk(
  plaid: PlaidApi,
  kid: string,
): Promise<JsonWebKey | null> {
  const cached = KEY_CACHE.get(kid);
  if (cached && Date.now() - cached.fetchedAt < KEY_CACHE_TTL_MS) {
    if (cached.expiredAt !== null) return null; // revoked/expired
    return cached.jwk;
  }

  try {
    const res = await plaid.webhookVerificationKeyGet({ key_id: kid });
    const key = res.data.key as {
      kty: string;
      crv: string;
      x: string;
      y: string;
      expired_at: number | null;
    };
    // Import only the standard EC members — extra Plaid metadata (kid, use,
    // created_at, expired_at) is not part of a crypto JWK.
    const jwk: JsonWebKey = { kty: key.kty, crv: key.crv, x: key.x, y: key.y };
    KEY_CACHE.set(kid, { jwk, expiredAt: key.expired_at, fetchedAt: Date.now() });
    if (key.expired_at !== null) return null;
    return jwk;
  } catch {
    return null;
  }
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function verifyPlaidWebhook(
  plaid: PlaidApi,
  verificationHeader: string | null,
  rawBody: string,
): Promise<boolean> {
  if (!verificationHeader) return false;

  const parts = verificationHeader.split(".");
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; kid?: string };
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  if (header.alg !== "ES256" || !header.kid) return false;

  const jwk = await getVerificationJwk(plaid, header.kid);
  if (!jwk) return false;

  let publicKey;
  try {
    publicKey = createPublicKey({ key: jwk, format: "jwk" });
  } catch {
    return false;
  }

  // JWS signatures are raw r||s (IEEE P1363), not DER.
  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`);
  const signature = Buffer.from(signatureB64, "base64url");
  let signatureValid = false;
  try {
    signatureValid = cryptoVerify(
      "sha256",
      signingInput,
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      signature,
    );
  } catch {
    return false;
  }
  if (!signatureValid) return false;

  let payload: { iat?: number; request_body_sha256?: string };
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return false;
  }

  if (typeof payload.iat !== "number") return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - payload.iat) > MAX_IAT_SKEW_SEC) return false;

  if (typeof payload.request_body_sha256 !== "string") return false;
  const bodyHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  return timingSafeEqualStr(bodyHash, payload.request_body_sha256);
}
