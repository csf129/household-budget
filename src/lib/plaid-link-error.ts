import type { PlaidLinkError } from "react-plaid-link";

/**
 * Turn the error Plaid Link hands to `onExit` into a readable message.
 *
 * Link renders its own "Something went wrong — Internal error occurred" screen
 * inside its iframe and passes the real reason to `onExit`; discarding that
 * argument (the previous behavior) left the actual cause invisible. We always
 * append `error_code` so a failed connect/relink states exactly what Plaid hit
 * (e.g. INSTITUTION_DOWN, INVALID_FIELD, ITEM_LOCKED) instead of a generic
 * "something went wrong".
 *
 * Returns null when the user simply closed Link without an error.
 */
export function formatPlaidExitError(err: PlaidLinkError | null): string | null {
  if (!err) return null;
  const base =
    err.display_message?.trim() ||
    err.error_message?.trim() ||
    "Bank connection could not be completed.";
  return err.error_code ? `${base} (${err.error_code})` : base;
}
