import type { NextConfig } from "next";

/**
 * Baseline security headers applied to every response.
 *
 * Deliberately conservative: clickjacking protection, MIME sniffing, HSTS,
 * referrer and permissions policy — none of which change what the app can load.
 * A full Content-Security-Policy (script-src/default-src) is intentionally NOT
 * set globally here: it needs to be tuned and tested against Plaid Link and the
 * Next.js runtime first, so it is left as a follow-up rather than shipped broad
 * enough to be meaningless or narrow enough to break the app.
 */
const SECURITY_HEADERS = [
  // Block framing entirely (clickjacking). The app frames Plaid, never itself,
  // so DENY is safe; using X-Frame-Options avoids a second CSP header colliding
  // with the service-worker CSP below.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
      {
        // The service worker must be served fresh (never cached) and as JS.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
