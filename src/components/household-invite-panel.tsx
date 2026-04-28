"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  initialCode: string | null;
};

export function HouseholdInvitePanel({ initialCode }: Props) {
  const [code, setCode] = useState(initialCode);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setMessage("Copied to clipboard.");
      setTimeout(() => setMessage(null), 2500);
    } catch {
      setMessage("Could not copy—select and copy manually.");
    }
  }

  async function regenerate() {
    setMessage(null);
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("regenerate_household_invite");
    setLoading(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    if (typeof data === "string") {
      setCode(data);
      setMessage("New code generated. Share this with your partner.");
    }
  }

  if (!code && !loading) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No invite code yet. Refresh the page or contact support if this
        persists.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Partner invite</h3>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Share this code so they can join this household from{" "}
        <span className="font-medium text-zinc-800 dark:text-zinc-200">Join with code</span> on the setup page.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="rounded-md bg-white px-3 py-2 font-mono text-lg font-semibold tracking-wider text-zinc-900 ring-1 ring-zinc-200 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-700">
          {loading ? "…" : code}
        </code>
        <button
          type="button"
          onClick={copy}
          disabled={!code || loading}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
        >
          Copy
        </button>
        <button
          type="button"
          onClick={regenerate}
          disabled={loading}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
        >
          {loading ? "Working…" : "New code"}
        </button>
      </div>
      {message ? (
        <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
