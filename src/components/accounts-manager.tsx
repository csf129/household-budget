"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AccountRow } from "@/types/finance";

type Props = {
  householdId: string;
  initialAccounts: AccountRow[];
};

export function AccountsManager({ householdId, initialAccounts }: Props) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountRow[]>(initialAccounts);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setAccounts(initialAccounts);
  }, [initialAccounts]);

  async function addAccount(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) {
      setError("Enter an account name (e.g. Chase Checking).");
      return;
    }
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { data, error: insErr } = await supabase
      .from("accounts")
      .insert({ household_id: householdId, name: n })
      .select("id, name")
      .single();
    setLoading(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    if (data) {
      setAccounts((prev) =>
        [...prev, { id: String(data.id), name: String(data.name) }].sort(
          (a, b) => a.name.localeCompare(b.name),
        ),
      );
      setName("");
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Accounts label where transactions and imports belong (e.g. checking vs
        card). Choose one when importing CSV or adding a transaction.
      </p>
      {accounts.length === 0 ? (
        <p className="text-sm text-amber-800 dark:text-amber-200">
          No accounts yet. Add at least one so imports can be tagged.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-700">
          {accounts.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between px-3 py-2 text-sm"
            >
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {a.name}
              </span>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => void addAccount(e)}
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <div className="min-w-0 flex-1">
          <label
            htmlFor="new-account-name"
            className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
          >
            New account name
          </label>
          <input
            id="new-account-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Chase Checking"
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {loading ? "Adding…" : "Add account"}
        </button>
      </form>
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
