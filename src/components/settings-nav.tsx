"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/settings/general", label: "General" },
  { href: "/settings/categories", label: "Categories" },
  { href: "/settings/budget", label: "Budget" },
  { href: "/settings/bank", label: "Bank (Plaid)" },
  { href: "/settings/rules", label: "Rules" },
  { href: "/settings/email-summaries", label: "Email Summaries" },
  { href: "/settings/ai", label: "AI Model" },
] as const;

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav
      className="flex flex-wrap gap-2 border-b border-zinc-200 pb-3 dark:border-zinc-800"
      aria-label="Settings sections"
    >
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${
              active
                ? "bg-violet-100 text-violet-950 dark:bg-violet-950/50 dark:text-violet-100"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
