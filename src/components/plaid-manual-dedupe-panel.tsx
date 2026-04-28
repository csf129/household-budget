"use client";

import { useState } from "react";
import { formatUsd } from "@/lib/money";
import {
  DEFAULT_MAX_CALENDAR_DAY_GAP,
  type PlannedManualDuplicateDeletion,
} from "@/lib/dedupe-plaid-vs-manual";

type PreviewResponse = {
  execute: false;
  scanned: number;
  deleteCount: number;
  maxCalendarDayGap: number;
  items: PlannedManualDuplicateDeletion[];
};

export function PlaidManualDedupePanel() {
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [maxCalendarDayGap, setMaxCalendarDayGap] = useState(
    DEFAULT_MAX_CALENDAR_DAY_GAP,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [executeMsg, setExecuteMsg] = useState<string | null>(null);

  async function runScan() {
    setError(null);
    setExecuteMsg(null);
    setLoading(true);
    try {
      const res = await fetch("/api/household/dedupe-plaid-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          execute: false,
          rangeStart: rangeStart.trim() || undefined,
          rangeEnd: rangeEnd.trim() || undefined,
          maxCalendarDayGap,
        }),
      });
      const data = (await res.json()) as PreviewResponse & { error?: string };
      if (!res.ok) {
        setPreview(null);
        setError(data.error ?? "Request failed.");
        return;
      }
      setPreview(data as PreviewResponse);
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  async function runDelete() {
    if (!preview || preview.deleteCount === 0) return;
    if (
      !window.confirm(
        `Delete ${preview.deleteCount} duplicate transaction(s) (same amount, similar name, dates within ${maxCalendarDayGap} day(s))? The listed “keep” row is retained. This cannot be undone.`,
      )
    ) {
      return;
    }
    setError(null);
    setExecuteMsg(null);
    setLoading(true);
    try {
      const res = await fetch("/api/household/dedupe-plaid-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          execute: true,
          rangeStart: rangeStart.trim() || undefined,
          rangeEnd: rangeEnd.trim() || undefined,
          maxCalendarDayGap,
        }),
      });
      const data = (await res.json()) as {
        deleted?: number;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Delete failed.");
        return;
      }
      setExecuteMsg(`Deleted ${data.deleted ?? 0} duplicate row(s).`);
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        Remove manual duplicates of Plaid transactions
      </h2>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
        If you imported CSVs and later linked the same bank via Plaid, you may
        see two lines for the same purchase (often a day or two apart after CSV
        vs bank posting).         This tool finds clusters of the same amount, similar merchant text, and
        dates within the day window. It keeps a Plaid-linked row when one
        exists; otherwise it keeps the copy that looks most like a raw bank
        string and removes the rest.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div>
          <label
            htmlFor="dedupe-max-gap"
            className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
          >
            Max day gap
          </label>
          <select
            id="dedupe-max-gap"
            value={maxCalendarDayGap}
            onChange={(e) =>
              setMaxCalendarDayGap(Number.parseInt(e.target.value, 10))
            }
            className="mt-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
          >
            {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                {n === 0
                  ? "0 (same day only)"
                  : `${n} day${n === 1 ? "" : "s"}`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="dedupe-start"
            className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
          >
            From (optional)
          </label>
          <input
            id="dedupe-start"
            type="date"
            value={rangeStart}
            onChange={(e) => setRangeStart(e.target.value)}
            className="mt-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
          />
        </div>
        <div>
          <label
            htmlFor="dedupe-end"
            className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
          >
            Through (optional)
          </label>
          <input
            id="dedupe-end"
            type="date"
            value={rangeEnd}
            onChange={(e) => setRangeEnd(e.target.value)}
            className="mt-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
          />
        </div>
        <button
          type="button"
          onClick={() => void runScan()}
          disabled={loading}
          className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {loading ? "Working…" : "Scan for duplicates"}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-500">
        Leave dates empty to scan your entire ledger (may take a moment).
      </p>

      {error ? (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      {executeMsg ? (
        <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">
          {executeMsg}
        </p>
      ) : null}

      {preview ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Scanned{" "}
            <span className="font-medium tabular-nums">{preview.scanned}</span>{" "}
            transaction(s), up to{" "}
            <span className="font-medium tabular-nums">
              {preview.maxCalendarDayGap}
            </span>{" "}
            calendar day(s) between dates.{" "}
            <span className="font-medium tabular-nums">{preview.deleteCount}</span>{" "}
            duplicate row(s) would be removed.
          </p>
          {preview.items.length > 0 ? (
            <>
              <div className="max-h-[280px] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="sticky top-0 border-b border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Remove date</th>
                      <th className="px-3 py-2 font-medium">Keep date</th>
                      <th className="px-3 py-2 text-right font-medium">Δ days</th>
                      <th className="px-3 py-2 font-medium">Keep source</th>
                      <th className="px-3 py-2 font-medium">Remove</th>
                      <th className="px-3 py-2 font-medium">Keep</th>
                      <th className="px-3 py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {preview.items.map((row) => (
                      <tr key={row.deleteId}>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-zinc-600 dark:text-zinc-400">
                          {row.occurred_on}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-zinc-600 dark:text-zinc-400">
                          {row.keeper_occurred_on}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-500 dark:text-zinc-500">
                          {row.calendar_day_gap}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-400">
                          {row.keeper_is_plaid ? "Plaid" : "Manual"}
                        </td>
                        <td className="max-w-[160px] px-3 py-2 text-zinc-800 dark:text-zinc-200">
                          {row.deleteDescription}
                        </td>
                        <td className="max-w-[160px] px-3 py-2 text-zinc-600 dark:text-zinc-400">
                          {row.keepDescription}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-800 dark:text-zinc-200">
                          {formatUsd(
                            row.amount < 0 ? -row.amount : row.amount,
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={() => void runDelete()}
                disabled={loading || preview.deleteCount === 0}
                className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100 disabled:opacity-50 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100 dark:hover:bg-red-950/60"
              >
                Delete {preview.deleteCount} duplicate(s)
              </button>
            </>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No matching pairs in this range.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
