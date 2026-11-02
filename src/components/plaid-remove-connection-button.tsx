"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  bankConnectionId: string;
  institutionName: string;
  disabled?: boolean;
};

/**
 * Removes a bank connection (soft-remove on the server: stops syncing and
 * revokes the Plaid item, but keeps imported transactions). Two-click confirm
 * so a stray click never drops a bank.
 */
export function PlaidRemoveConnectionButton({
  bankConnectionId,
  institutionName,
  disabled = false,
}: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/plaid/remove-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bank_connection_id: bankConnectionId }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Could not remove this connection.");
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch {
      setError("Network error while removing the connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="ml-2 inline-flex items-center gap-2">
      {confirming ? (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className="rounded-md border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/70"
          >
            {busy ? "Removing…" : `Remove ${institutionName}?`}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(false)}
            className="text-xs text-zinc-500 hover:text-zinc-700 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setConfirming(true)}
          className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Remove
        </button>
      )}
      {error ? (
        <span className="text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
