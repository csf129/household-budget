import Link from "next/link";
import { redirect } from "next/navigation";
import { HouseholdSetupForm } from "@/components/household-setup-form";
import { SignOutButton } from "@/components/sign-out-button";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser } from "@/lib/household";

export default async function SetupPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const household = await getHouseholdForUser(supabase, user.id);
  if (household) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-full flex-col bg-zinc-50 px-6 py-12 font-sans dark:bg-zinc-950">
      <main className="mx-auto w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Set up your household
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Signed in as{" "}
          <span className="font-medium text-zinc-800 dark:text-zinc-200">{user.email}</span>.
          Create a new budget household or join one with a code from your
          partner.
        </p>
        <div className="mt-8">
          <HouseholdSetupForm />
        </div>
        <div className="mt-10 flex flex-col gap-4 border-t border-zinc-100 pt-8 dark:border-zinc-800">
          <SignOutButton />
          <Link
            href="/"
            className="text-center text-sm text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Back to home
          </Link>
        </div>
      </main>
    </div>
  );
}
