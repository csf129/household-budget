import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request Content-Security-Policy with a nonce (Next 16 renamed middleware
 * to `proxy`). This is the strict CSP the baseline-headers commit deferred.
 *
 * Strategy:
 * - script-src is locked to 'self' + a per-request nonce + 'strict-dynamic'.
 *   Next automatically stamps the nonce onto its framework/bundle scripts (it
 *   reads it from this header), and 'strict-dynamic' lets those trusted scripts
 *   load what they need — including Plaid Link's injected script — without
 *   opening the door to arbitrary inline/injected script. 'unsafe-eval' is added
 *   in dev only (React dev + HMR use eval).
 * - style-src keeps 'unsafe-inline': React and Recharts set inline style
 *   attributes, which a nonce cannot cover. Inline styles are a negligible XSS
 *   vector compared to scripts, so this is the standard trade-off.
 * - connect-src is derived from the public Supabase URL so the REST/auth/realtime
 *   calls (https + wss) are allowed; falls back to 'self' only if unset.
 * - frame-src allows Plaid Link's iframe. frame-ancestors 'none' blocks framing
 *   of this app (clickjacking), complementing the X-Frame-Options header.
 *
 * Nonces require dynamic rendering; the root layout reads the x-nonce header,
 * which opts the tree into dynamic rendering automatically.
 */

/** Allowed Supabase origins for connect-src, derived from the public URL. */
function supabaseConnectSources(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) return "";
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host} wss://${u.host}`;
  } catch {
    return "";
  }
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const supabase = supabaseConnectSources();

  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self'`,
    `connect-src 'self'${supabase ? ` ${supabase}` : ""}${isDev ? " ws:" : ""}`,
    `frame-src https://cdn.plaid.com https://*.plaid.com`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    // Only in production: on http://localhost this would force https upgrades.
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ];
  const csp = directives.join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Everything except API routes, Next static assets, the service worker,
      // and static icons (which need no CSP and should not become dynamic).
      source:
        "/((?!api|_next/static|_next/image|favicon.ico|sw.js|icon.svg|apple-icon.png|manifest.webmanifest).*)",
      // Skip next/link prefetches so they are not forced dynamic.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
