"use client";

import { useMemo, useState } from "react";
import { formatUsd } from "@/lib/money";

type PlaidAccountRow = {
  id: string;
  name: string;
  display_name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  current_balance: number | string | null;
};

type Props = {
  accounts: PlaidAccountRow[];
};

export function PlaidAccountsTable({ accounts }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverNames, setServerNames] = useState<Record<string, string | null>>(
    () =>
      Object.fromEntries(
        accounts.map((a) => [a.id, a.display_name ?? null]),
      ),
  );

  const rows = useMemo(
    () =>
      accounts.map((a) => {
        const persisted = serverNames[a.id] ?? a.display_name ?? null;
        const draft = drafts[a.id];
        const currentText = draft !== undefined ? draft : persisted ?? "";
        const label = persisted?.trim() || a.name;
        return { ...a, persisted, currentText, label };
      }),
    [accounts, drafts, serverNames],
  );

  async function saveRow(id: string) {
    setError(null);
    setSaved(null);
    setSavingId(id);
    const value = (drafts[id] ?? "").trim();
    try {
      const res = await fetch("/api/plaid/bank-accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bank_account_id: id,
          display_name: value.length > 0 ? value : null,
        }),
      });
      const data = (await res.json()) as { error?: string; display_name?: string | null };
      if (!res.ok) {
        setError(data.error || "Could not save account nickname.");
        return;
      }
      setServerNames((prev) => ({ ...prev, [id]: data.display_name ?? null }));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setSaved("Saved account nickname.");
    } catch {
      setError("Network error while saving account nickname.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-xs">
        <thead>
          <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            <th className="pb-2 font-medium">Nickname</th>
            <th className="pb-2 font-medium">Plaid name</th>
            <th className="pb-2 font-medium">Type</th>
            <th className="pb-2 text-right font-medium">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-b border-zinc-100 dark:border-zinc-800">
              <td className="py-2 pr-3 align-top">
                <div className="flex min-w-[220px] items-center gap-2">
                  <input
                    value={a.currentText}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [a.id]: e.target.value }))
                    }
                    placeholder={a.name}
                    maxLength={80}
                    className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
                  />
                  <button
                    type="button"
                    disabled={savingId === a.id}
                    onClick={() => void saveRow(a.id)}
                    className="shrink-0 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    {savingId === a.id ? "Saving…" : "Save"}
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                  Used throughout the app when available.
                </p>
              </td>
              <td className="py-2 text-zinc-900 dark:text-zinc-100">
                {a.name}
                {a.mask ? <span className="text-zinc-500"> ·•••{a.mask}</span> : null}
              </td>
              <td className="py-2 text-zinc-600 dark:text-zinc-400">
                {a.subtype || a.type || "—"}
              </td>
              <td className="py-2 text-right tabular-nums text-zinc-800 dark:text-zinc-100">
                {a.current_balance != null
                  ? formatUsd(Number(a.current_balance))
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300" role="status">
          {saved}
        </p>
      ) : null}
    </div>
  );
}

