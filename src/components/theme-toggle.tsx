"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div
        className="h-10 w-56 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800"
        aria-hidden
      />
    );
  }

  const btn = (t: "light" | "dark" | "system", label: string) => (
    <button
      key={t}
      type="button"
      onClick={() => setTheme(t)}
      className={`rounded-md px-3 py-2 text-xs font-semibold ${
        theme === t
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      className="inline-flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-900/60"
      role="group"
      aria-label="Color theme"
    >
      {btn("light", "Light")}
      {btn("dark", "Dark")}
      {btn("system", "System")}
    </div>
  );
}
