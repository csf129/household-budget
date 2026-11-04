/**
 * Route-level loading fallback for the authenticated app. Shown while a server
 * component segment streams in (navigation, Suspense), instead of a blank frame.
 */
export default function AppLoading() {
  return (
    <div
      className="flex flex-1 items-center justify-center px-6 py-16"
      role="status"
      aria-live="polite"
    >
      <span className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700 dark:border-zinc-700 dark:border-t-zinc-200"
          aria-hidden="true"
        />
        Loading…
      </span>
    </div>
  );
}
