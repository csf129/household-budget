"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { formatPlaidExitError } from "@/lib/plaid-link-error";
import {
  clearPlaidLinkToken,
  isPlaidOAuthRedirect,
  loadPlaidLinkToken,
  plaidOAuthRedirectHref,
  savePlaidLinkToken,
  stripPlaidOAuthParam,
} from "@/lib/plaid-link-oauth";

type Props = {
  disabled?: boolean;
  /** Resolved server-side from PLAID_ENV (and defaults). */
  plaidEnv?: "sandbox" | "development" | "production";
};

/** Identifies this Link instance when resuming after an OAuth redirect. */
const LINK_FLOW = "connect";

export function PlaidConnectPanel({
  disabled = false,
  plaidEnv = "sandbox",
}: Props) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [receivedRedirectUri, setReceivedRedirectUri] = useState<
    string | undefined
  >(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSuccess = useCallback(
    async (publicToken: string) => {
      clearPlaidLinkToken(LINK_FLOW);
      stripPlaidOAuthParam();
      setError(null);
      setBusy(true);
      try {
        const res = await fetch("/api/plaid/exchange-public-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ public_token: publicToken }),
        });
        const data = (await res.json()) as { error?: string; accounts?: number };
        if (!res.ok) {
          setError(data.error || "Could not complete bank link.");
          return;
        }
        setLinkToken(null);
        router.refresh();
      } catch {
        setError("Network error while saving the bank connection.");
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    receivedRedirectUri,
    onSuccess,
    onExit: (err) => {
      clearPlaidLinkToken(LINK_FLOW);
      stripPlaidOAuthParam();
      setLinkToken(null);
      // Surface the real reason Link failed instead of swallowing it; null when
      // the user just closed the dialog.
      const msg = formatPlaidExitError(err);
      if (msg) setError(msg);
    },
  });

  // Resume Link after an OAuth bank redirected back: the page fully reloaded,
  // so restore the token we stashed before the handoff and re-open with the
  // redirect URL. Only the instance that started this flow has a stashed token.
  useEffect(() => {
    if (!isPlaidOAuthRedirect()) return;
    const stashed = loadPlaidLinkToken(LINK_FLOW);
    if (!stashed) return;
    setReceivedRedirectUri(plaidOAuthRedirectHref());
    setLinkToken(stashed);
  }, []);

  useEffect(() => {
    if (linkToken && ready) {
      open();
    }
  }, [linkToken, ready, open]);

  async function startLink() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/plaid/create-link-token", {
        method: "POST",
      });
      let data: {
        error?: string;
        code?: string;
        hint?: string;
        link_token?: string;
      };
      try {
        data = (await res.json()) as typeof data;
      } catch {
        setError(
          `Could not read server response (${res.status}). If the dev server printed an error, check that terminal.`,
        );
        return;
      }
      if (!res.ok) {
        const extra = data.hint ? ` ${data.hint}` : "";
        setError((data.error || "Could not start Plaid Link.") + extra);
        return;
      }
      if (!data.link_token) {
        setError("No link token returned.");
        return;
      }
      // Stash before opening so an OAuth bank's redirect can resume this token.
      savePlaidLinkToken(LINK_FLOW, data.link_token);
      setLinkToken(data.link_token);
    } catch {
      setError("Network error while contacting the server.");
    } finally {
      setBusy(false);
    }
  }

  async function runSync() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/plaid/sync-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as {
        error?: string;
        errors?: { connection: string; error: string }[];
      };
      if (!res.ok) {
        setError(data.error || "Sync failed.");
        return;
      }
      // The all-connections sync returns 200 even when individual banks fail
      // (so one bad item never blocks the rest). Surface those per-connection
      // errors instead of silently showing no new transactions.
      if (data.errors && data.errors.length > 0) {
        setError(data.errors.map((e) => e.error).join(" · "));
      }
      router.refresh();
    } catch {
      setError("Network error during sync.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void startLink()}
          className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-700 dark:hover:bg-violet-600"
        >
          {busy && !linkToken ? "Starting…" : "Connect bank (Plaid)"}
        </button>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void runSync()}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          Sync transactions now
        </button>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        {plaidEnv === "sandbox" ? (
          <>
            This server is using{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              Plaid Sandbox
            </span>
            . Set{" "}
            <code className="rounded bg-zinc-100 px-1 text-[10px] dark:bg-zinc-800">
              PLAID_ENV=production
            </code>{" "}
            and production keys, then restart the dev server.
          </>
        ) : (
          <>
            This server is using{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              Plaid {plaidEnv === "production" ? "Production" : "Development"}
            </span>
            . For automatic sync, set a public{" "}
            <code className="rounded bg-zinc-100 px-1 text-[10px] dark:bg-zinc-800">
              PLAID_WEBHOOK_URL
            </code>{" "}
            (or{" "}
            <code className="rounded bg-zinc-100 px-1 text-[10px] dark:bg-zinc-800">
              NEXT_PUBLIC_APP_URL
            </code>
            ).
          </>
        )}
      </p>
    </div>
  );
}
