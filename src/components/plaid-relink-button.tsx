"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";

type Props = {
  bankConnectionId: string;
  disabled?: boolean;
};

export function PlaidRelinkButton({ bankConnectionId, disabled = false }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSuccess = useCallback(
    async (publicToken: string) => {
      setError(null);
      setBusy(true);
      try {
        const res = await fetch("/api/plaid/exchange-public-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            public_token: publicToken,
            bank_connection_id: bankConnectionId,
          }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          setError(data.error || "Could not relink this connection.");
          return;
        }
        setLinkToken(null);
        router.refresh();
      } catch {
        setError("Network error while relinking.");
      } finally {
        setBusy(false);
      }
    },
    [bankConnectionId, router],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: () => setLinkToken(null),
  });

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  async function startRelink() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/plaid/create-update-link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bank_connection_id: bankConnectionId }),
      });
      const data = (await res.json()) as { error?: string; link_token?: string };
      if (!res.ok || !data.link_token) {
        setError(data.error || "Could not start relink.");
        return;
      }
      setLinkToken(data.link_token);
    } catch {
      setError("Network error while requesting relink token.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => void startRelink()}
        className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
      >
        {busy ? "Relinking…" : "Re-link for full history"}
      </button>
      {error ? (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

