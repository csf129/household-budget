import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser } from "@/lib/household";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const household = await getHouseholdForUser(supabase, user.id);

    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 font-sans dark:bg-zinc-950">
        <main className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Household budget
          </h1>
          <p className="mt-3 text-pretty text-zinc-600 dark:text-zinc-400">
            You are signed in as{" "}
            <span className="font-medium text-zinc-900 dark:text-zinc-100">{user.email}</span>.
          </p>
          {household ? (
            <>
              <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
                Household:{" "}
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {household.name}
                </span>
                .
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                >
                  Open app
                </Link>
                <SignOutButton />
              </div>
            </>
          ) : (
            <>
              <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
                Finish setup by creating a household or joining with your
                partner&apos;s invite code.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/setup"
                  className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                >
                  Set up household
                </Link>
                <SignOutButton />
              </div>
            </>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 font-sans dark:bg-zinc-950">
      <main className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Household budget
        </h1>
        <p className="mt-3 text-pretty text-zinc-600 dark:text-zinc-400">
          Shared spending and categories for you and your partner. Create an
          account to get started, or sign in if you already have one.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/signup"
            className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            Create account
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-lg border border-zinc-300 px-4 py-2.5 text-center text-sm font-semibold text-zinc-900 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            Sign in
          </Link>
        </div>
        <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-400">
          After signing up, check your email to confirm your address if your
          project requires it—otherwise sign-in will not work until you do.
        </p>
      </main>
    </div>
  );
}
