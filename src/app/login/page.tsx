import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { createClient } from "@/lib/supabase/server";

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    redirect("/");
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-zinc-950">
      <main className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Sign in
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Use the email and password you registered with.
        </p>
        <div className="mt-8">
          <LoginForm />
        </div>
        <p className="mt-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
          <Link href="/" className="underline underline-offset-2 hover:no-underline dark:hover:text-zinc-200">
            Back to home
          </Link>
        </p>
      </main>
    </div>
  );
}
