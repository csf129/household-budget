"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import "./globals.css";

/**
 * Last-resort boundary for errors thrown in the root layout or an (app)/layout
 * — the cases the segment-level error.tsx cannot catch. It replaces the root
 * layout when active, so it must render its own <html>/<body> and pull in global
 * styles itself (fonts from the root layout are not available here).
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[app] global render error", error);
  }, [error]);

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        <div className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
          <main className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h1 className="text-xl font-semibold">Something went wrong</h1>
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              The app hit an unexpected error and could not finish loading.
            </p>
            {error.digest ? (
              <p className="mt-2 font-mono text-xs text-zinc-400 dark:text-zinc-500">
                Reference: {error.digest}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => unstable_retry()}
              className="mt-8 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              Try again
            </button>
          </main>
        </div>
      </body>
    </html>
  );
}
