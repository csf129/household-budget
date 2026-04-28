import Link from "next/link";

export default function AuthCodeErrorPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-zinc-950">
      <main className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          Could not sign you in
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          The confirmation link may have expired or already been used. Try
          signing in, or request a new confirmation email from the sign-up flow.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/login"
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            Create account
          </Link>
        </div>
      </main>
    </div>
  );
}
