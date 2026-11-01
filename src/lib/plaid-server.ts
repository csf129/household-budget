import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
} from "plaid";

export function getPlaidEnv(): "sandbox" | "development" | "production" {
  const raw = process.env.PLAID_ENV;
  let e = (raw ?? "sandbox").trim().toLowerCase();
  if (
    (e.startsWith('"') && e.endsWith('"')) ||
    (e.startsWith("'") && e.endsWith("'"))
  ) {
    e = e.slice(1, -1).trim().toLowerCase();
  }
  if (e === "production" || e === "development" || e === "sandbox") return e;
  if (raw != null && String(raw).trim() !== "") {
    console.warn(
      `[plaid] Invalid PLAID_ENV="${raw}" — falling back to sandbox. Use production, development, or sandbox.`,
    );
  }
  return "sandbox";
}

export function createPlaidClient(): PlaidApi {
  const clientId = process.env.PLAID_CLIENT_ID?.trim();
  const secret = process.env.PLAID_SECRET?.trim();
  if (!clientId || !secret) {
    throw new Error("Missing PLAID_CLIENT_ID or PLAID_SECRET.");
  }
  const env = getPlaidEnv();
  const basePath =
    env === "production"
      ? PlaidEnvironments.production
      : env === "development"
        ? PlaidEnvironments.development
        : PlaidEnvironments.sandbox;

  return new PlaidApi(
    new Configuration({
      basePath,
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": clientId,
          "PLAID-SECRET": secret,
        },
      },
    }),
  );
}

/**
 * OAuth redirect URI for Plaid Link. Required for OAuth institutions (most large
 * US banks in Production, e.g. Chase and Bank of America): the value must be set
 * here AND registered verbatim under Plaid Dashboard → Team Settings → API →
 * Allowed redirect URIs. Returns undefined when unset so sandbox/dev keeps the
 * non-OAuth flow.
 */
export function getPlaidRedirectUri(): string | undefined {
  const uri = process.env.PLAID_REDIRECT_URI?.trim();
  return uri || undefined;
}

export function getPlaidWebhookUrl(): string | undefined {
  const full = process.env.PLAID_WEBHOOK_URL?.trim();
  if (full) return full;
  const app = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (app) return `${app.replace(/\/$/, "")}/api/plaid/webhook`;
  return undefined;
}

export { CountryCode };
