"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { AlertItem } from "@/lib/alerts";

type Props = {
  alerts: AlertItem[];
  householdId: string;
};

const READ_KEY_PREFIX = "alerts-read:";

function readStoredIds(householdId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(`${READ_KEY_PREFIX}${householdId}`);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveReadIds(householdId: string, ids: Set<string>) {
  try {
    window.localStorage.setItem(
      `${READ_KEY_PREFIX}${householdId}`,
      JSON.stringify([...ids]),
    );
  } catch { /* ignore */ }
}

function formatAlertDate(iso: string): string {
  try {
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Math.abs(amount));
}

const SEVERITY_STYLES = {
  warning: {
    dot: "bg-amber-500",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    icon: (
      <svg className="h-5 w-5 text-amber-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
      </svg>
    ),
  },
  info: {
    dot: "bg-blue-500",
    badge: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    icon: (
      <svg className="h-5 w-5 text-blue-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm8.706-1.442c1.146-.573 2.437.463 2.126 1.706l-.709 2.836.042-.02a.75.75 0 01.67 1.34l-.04.022c-1.147.573-2.438-.463-2.127-1.706l.71-2.836-.042.02a.75.75 0 11-.671-1.34l.041-.022zM12 9a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
      </svg>
    ),
  },
};

const TYPE_LABELS: Record<AlertItem["type"], string> = {
  missing_receipt: "Missing receipt",
};

export function AlertsInbox({ alerts, householdId }: Props) {
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Load read state from localStorage after mount
  useEffect(() => {
    setReadIds(readStoredIds(householdId));
  }, [householdId]);

  // Auto-select first alert
  useEffect(() => {
    if (alerts.length > 0 && !selectedId) {
      setSelectedId(alerts[0]!.id);
    }
  }, [alerts, selectedId]);

  function markRead(id: string) {
    setReadIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveReadIds(householdId, next);
      return next;
    });
  }

  function markAllRead() {
    const next = new Set(alerts.map((a) => a.id));
    setReadIds(next);
    saveReadIds(householdId, next);
  }

  function handleSelect(id: string) {
    setSelectedId(id);
    markRead(id);
  }

  const selected = useMemo(
    () => alerts.find((a) => a.id === selectedId) ?? null,
    [alerts, selectedId],
  );

  const unreadCount = alerts.filter((a) => !readIds.has(a.id)).length;

  if (alerts.length === 0) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <svg className="h-12 w-12 text-zinc-300 dark:text-zinc-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.2} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-base font-medium text-zinc-500 dark:text-zinc-400">All clear — no alerts</p>
        <p className="text-sm text-zinc-400 dark:text-zinc-500">
          Alerts appear here when action is needed, such as business expenses missing receipts.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-0 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {/* Left panel — alert list */}
      <div className="flex w-80 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
        {/* List header */}
        <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Inbox
            </span>
            {unreadCount > 0 && (
              <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-violet-600 px-1.5 text-[10px] font-bold text-white">
                {unreadCount}
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Mark all read
            </button>
          )}
        </div>

        {/* Alert list */}
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {alerts.map((alert) => {
            const isRead = readIds.has(alert.id);
            const isSelected = selectedId === alert.id;
            const s = SEVERITY_STYLES[alert.severity];
            return (
              <li key={alert.id}>
                <button
                  type="button"
                  onClick={() => handleSelect(alert.id)}
                  className={`w-full border-b border-zinc-100 px-4 py-3 text-left transition-colors dark:border-zinc-800 ${
                    isSelected
                      ? "bg-violet-50 dark:bg-violet-950/30"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {/* Unread dot */}
                    <span className="mt-1.5 flex h-2 w-2 shrink-0 items-center justify-center">
                      {!isRead && (
                        <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className={`truncate text-sm ${isRead ? "font-normal text-zinc-600 dark:text-zinc-400" : "font-semibold text-zinc-900 dark:text-zinc-100"}`}>
                          {alert.rawDescription}
                        </span>
                        <span className="shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500">
                          {formatAlertDate(alert.date)}
                        </span>
                      </div>
                      <p className={`mt-0.5 text-xs ${isRead ? "text-zinc-400 dark:text-zinc-500" : "text-zinc-500 dark:text-zinc-400"}`}>
                        {TYPE_LABELS[alert.type]} · {formatUsd(alert.amount)}
                      </p>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Right panel — detail */}
      <div className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <>
            {/* Detail header */}
            <div className="flex items-start gap-4 border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
              <div className="mt-0.5 shrink-0">
                {SEVERITY_STYLES[selected.severity].icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                    {selected.title}
                  </h2>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLES[selected.severity].badge}`}>
                    {TYPE_LABELS[selected.type]}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {formatAlertDate(selected.date)}
                </p>
              </div>
            </div>

            {/* Detail body */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="max-w-lg space-y-6">
                {/* Transaction details */}
                <section className="rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50">
                  <div className="border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-700">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Transaction
                    </h3>
                  </div>
                  <dl className="divide-y divide-zinc-100 dark:divide-zinc-700/60">
                    <div className="flex justify-between gap-4 px-4 py-2.5 text-sm">
                      <dt className="text-zinc-500 dark:text-zinc-400">Description</dt>
                      <dd className="font-medium text-zinc-900 dark:text-zinc-100">{selected.rawDescription}</dd>
                    </div>
                    <div className="flex justify-between gap-4 px-4 py-2.5 text-sm">
                      <dt className="text-zinc-500 dark:text-zinc-400">Amount</dt>
                      <dd className="font-medium text-zinc-900 dark:text-zinc-100">{formatUsd(selected.amount)}</dd>
                    </div>
                    <div className="flex justify-between gap-4 px-4 py-2.5 text-sm">
                      <dt className="text-zinc-500 dark:text-zinc-400">Date</dt>
                      <dd className="font-medium text-zinc-900 dark:text-zinc-100">{formatAlertDate(selected.date)}</dd>
                    </div>
                    {selected.categoryName && (
                      <div className="flex justify-between gap-4 px-4 py-2.5 text-sm">
                        <dt className="text-zinc-500 dark:text-zinc-400">Category</dt>
                        <dd className="flex items-center gap-2 font-medium text-zinc-900 dark:text-zinc-100">
                          {selected.categoryColor && (
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10"
                              style={{ backgroundColor: selected.categoryColor }}
                              aria-hidden
                            />
                          )}
                          {selected.categoryName}
                        </dd>
                      </div>
                    )}
                    <div className="flex justify-between gap-4 px-4 py-2.5 text-sm">
                      <dt className="text-zinc-500 dark:text-zinc-400">Business expense</dt>
                      <dd className="font-medium text-emerald-700 dark:text-emerald-400">Yes</dd>
                    </div>
                  </dl>
                </section>

                {/* What to do */}
                <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-950/30">
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                    Receipt required for tax reporting
                  </p>
                  <p className="mt-1 text-sm text-amber-800 dark:text-amber-300/80">
                    This transaction is marked as a business expense but has no receipt attached. Upload a receipt (image or PDF) from the transaction detail to ensure it&apos;s ready for tax time.
                  </p>
                </section>

                {/* Action */}
                <Link
                  href={`/transactions?highlight=${selected.transactionId}`}
                  className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                >
                  <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                  Open transaction to upload receipt
                </Link>
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
            Select an alert to view details
          </div>
        )}
      </div>
    </div>
  );
}
