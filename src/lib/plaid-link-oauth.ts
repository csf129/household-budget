"use client";

/**
 * Client helpers for resuming Plaid Link after an OAuth bank's redirect.
 *
 * OAuth institutions (Chase, Bank of America, …) send the browser away to the
 * bank and back to the registered redirect URI, which fully reloads the page.
 * To finish, Link must be re-initialized with the SAME link token plus
 * `receivedRedirectUri`. The token therefore has to survive a full navigation,
 * so we stash it in sessionStorage (single-use, cleared when the tab closes).
 *
 * `flow` disambiguates concurrent Link instances on one page — the connect
 * panel vs. a specific relink button — so only the instance that started the
 * OAuth handoff resumes it.
 */

/** Query param Plaid appends to the redirect URI when returning from a bank. */
const OAUTH_PARAM = "oauth_state_id";
const STORAGE_PREFIX = "plaid.link_token.";

/** True when this page load is Plaid returning from a bank's OAuth flow. */
export function isPlaidOAuthRedirect(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).has(OAUTH_PARAM);
  } catch {
    return false;
  }
}

/** The full URL Plaid redirected back to; required to resume Link after OAuth. */
export function plaidOAuthRedirectHref(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return window.location.href;
}

function storageKey(flow: string): string {
  return `${STORAGE_PREFIX}${flow}`;
}

/** Persist a link token so it survives the OAuth redirect. */
export function savePlaidLinkToken(flow: string, token: string): void {
  try {
    window.sessionStorage.setItem(storageKey(flow), token);
  } catch {
    // Storage blocked (private mode, etc.): OAuth resume won't work, but the
    // non-OAuth flow is unaffected.
  }
}

export function loadPlaidLinkToken(flow: string): string | null {
  try {
    return window.sessionStorage.getItem(storageKey(flow));
  } catch {
    return null;
  }
}

export function clearPlaidLinkToken(flow: string): void {
  try {
    window.sessionStorage.removeItem(storageKey(flow));
  } catch {
    // ignore
  }
}

/** Strip Plaid's oauth_state_id from the URL once Link has consumed it. */
export function stripPlaidOAuthParam(): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(OAUTH_PARAM)) return;
    url.searchParams.delete(OAUTH_PARAM);
    window.history.replaceState({}, "", url.toString());
  } catch {
    // ignore
  }
}
