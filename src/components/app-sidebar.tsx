"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { SignOutButton } from "@/components/sign-out-button";

const nav = [
  { href: "/dashboard", label: "Overview" },
  { href: "/transactions", label: "Transactions" },
  { href: "/plans", label: "Plans" },
  { href: "/credit-cards", label: "Credit Cards" },
  { href: "/alerts", label: "Alerts & Messages" },
  { href: "/settings/general", label: "Settings" },
] as const;

type NavHref = (typeof nav)[number]["href"];

function isActiveNav(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/settings/general") return pathname.startsWith("/settings");
  return pathname === href || pathname.startsWith(`${href}/`);
}

type Props = {
  householdName: string;
  userEmail: string;
  /** Badge counts keyed by nav href. Shown as pill next to the label. */
  badgeCounts?: Partial<Record<NavHref, number>>;
};

export function AppSidebar({ householdName, userEmail, badgeCounts = {} }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/plaid/sync-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSyncError(data.error ?? "Sync failed.");
      } else {
        router.refresh();
      }
    } catch {
      setSyncError("Network error during sync.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <aside
      className="sticky top-0 z-40 flex h-[100dvh] max-h-screen w-56 shrink-0 flex-col self-start overflow-y-auto border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
      aria-label="Main navigation"
    >
      <div className="flex flex-col gap-1 border-b border-zinc-100 p-4 dark:border-zinc-800">
        <Link
          href="/dashboard"
          className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
        >
          Household budget
        </Link>
        <p className="text-xs leading-snug text-zinc-500 dark:text-zinc-400">
          <span className="block truncate font-medium text-zinc-600 dark:text-zinc-300">
            {householdName}
          </span>
          <span className="mt-0.5 block truncate text-zinc-500 dark:text-zinc-400">
            {userEmail}
          </span>
        </p>
      </div>

      <nav className="flex flex-col gap-0.5 p-3" aria-label="App sections">
        {nav.map((item) => {
          const active = isActiveNav(item.href, pathname);
          const badge = badgeCounts[item.href] ?? 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-violet-100 text-violet-950 dark:bg-violet-950/50 dark:text-violet-100"
                  : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              }`}
            >
              {item.label}
              {badge > 0 && (
                <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-violet-600 px-1.5 text-[10px] font-bold text-white">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto space-y-2 border-t border-zinc-100 p-3 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => void handleSync()}
          disabled={syncing}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <svg
            className={`h-4 w-4 shrink-0 ${syncing ? "animate-spin" : ""}`}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.75}
            stroke="currentColor"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
            />
          </svg>
          {syncing ? "Syncing…" : "Sync bank transactions"}
        </button>
        {syncError ? (
          <p className="px-3 text-xs text-red-600 dark:text-red-400">{syncError}</p>
        ) : null}
        <Link
          href="/"
          className={`block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
            pathname === "/"
              ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
              : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          }`}
        >
          Home
        </Link>
        <SignOutButton className="w-full border-zinc-200 py-2.5 text-zinc-600 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-100" />
      </div>
    </aside>
  );
}
