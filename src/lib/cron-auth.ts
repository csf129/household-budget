import { timingSafeEqual } from "crypto";

/**
 * Authorize a Vercel Cron / manual trigger request.
 *
 * Returns true only when CRON_SECRET is configured AND the request carries a
 * matching bearer token. Critically, it fails CLOSED when the secret is unset:
 * comparing against `Bearer ${process.env.CRON_SECRET}` directly would accept a
 * literal "Bearer undefined" header whenever the env var is missing, silently
 * exposing the endpoint. The comparison is length-safe and constant-time.
 */
export function isAuthorizedCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
