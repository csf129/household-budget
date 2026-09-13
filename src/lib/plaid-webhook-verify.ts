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

/**
 * Reject with a logged reason. The verifier fails closed, so a silent `false`
 * used to make a broken auto-sync indistinguishable from an attack. Logging the
 * specific reason (visible in Vercel logs) is safe — the JWT is Plaid's, not a
 * user secret — and turns "transactions silently stopped" into a diagnosable
 * event. Reasons are coarse-grained on purpose: enough to triage, nothing that
 * would help forge a token.
 */
function reject(reason: string): false {
  console.warn(`[plaid] webhook verification rejected: ${reason}`);
  return false;
}

export async function verifyPlaidWebhook(
  plaid: PlaidApi,
  verificationHeader: string | null,
  rawBody: string,
): Promise<boolean> {
  if (!verificationHeader) return reject("missing Plaid-Verification header");

  const parts = verificationHeader.split(".");
  if (parts.length !== 3) return reject("header is not a 3-part JWT");
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; kid?: string };
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
  } catch {
    return reject("JWT header is not valid base64url JSON");
  }
  if (header.alg !== "ES256" || !header.kid) {
    return reject(`unexpected JWT header (alg=${header.alg}, kid set=${!!header.kid})`);
  }

  const jwk = await getVerificationJwk(plaid, header.kid);
  if (!jwk) {
    return reject(
      `no usable verification key for kid=${header.kid} ` +
        "(key fetch failed, revoked, or Plaid env/credentials mismatch)",
    );
  }

  let publicKey;
  try {
    publicKey = createPublicKey({ key: jwk, format: "jwk" });
  } catch {
    return reject(`could not import verification key for kid=${header.kid}`);
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
    return reject("signature verification threw");
  }
  if (!signatureValid) return reject("JWS signature did not match");

  let payload: { iat?: number; request_body_sha256?: string };
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return reject("JWT payload is not valid base64url JSON");
  }

  if (typeof payload.iat !== "number") return reject("JWT payload has no numeric iat");
  const nowSec = Math.floor(Date.now() / 1000);
  const skew = nowSec - payload.iat;
  if (Math.abs(skew) > MAX_IAT_SKEW_SEC) {
    return reject(
      `iat outside ±${MAX_IAT_SKEW_SEC}s window (skew=${skew}s; check server clock)`,
    );
  }

  if (typeof payload.request_body_sha256 !== "string") {
    return reject("JWT payload has no request_body_sha256");
  }
  const bodyHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  if (!timingSafeEqualStr(bodyHash, payload.request_body_sha256)) {
    return reject("body hash did not match pinned request_body_sha256");
  }
  return true;
}
