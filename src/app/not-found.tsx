import Link from "next/link";

/** Root 404. Served for any unmatched URL. */
export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-zinc-950">
      <main className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          Page not found
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          That page doesn’t exist or may have moved.
        </p>
        <div className="mt-8">
          <Link
            href="/dashboard"
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            Back to overview
          </Link>
        </div>
      </main>
    </div>
  );
}
