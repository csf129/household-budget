"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";

/**
 * Error boundary for the authenticated app shell. Catches runtime errors thrown
 * while rendering any (app) page or its nested segments (but not the (app)
 * layout itself — that is handled by global-error).
 *
 * Next 16.2 passes `unstable_retry`, which re-fetches and re-renders the failed
 * segment; prefer it over `reset`, which only clears the boundary.
 */
export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // Surfaces in Vercel logs; the digest ties this to the server-side entry.
    console.error("[app] render error", error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <main className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          Something went wrong
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          This page hit an unexpected error. Trying again often resolves a
          temporary problem.
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-xs text-zinc-400 dark:text-zinc-500">
            Reference: {error.digest}
          </p>
        ) : null}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            Back to overview
          </a>
        </div>
      </main>
    </div>
  );
}
