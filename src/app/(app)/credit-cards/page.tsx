import Link from "next/link";
import { CreditCardsManager } from "@/components/credit-cards-manager";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser } from "@/lib/household";
import { fetchCreditCards } from "@/lib/fetch-credit-cards";

export default async function CreditCardsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) return null;

  const { rows, error } = await fetchCreditCards(supabase, household.householdId);

  if (error) {
    return (
      <div className="space-y-2" role="alert">
        <p className="text-sm text-red-600 dark:text-red-400">
          Could not load credit cards: {error}
        </p>
        {error.toLowerCase().includes("credit_cards") ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            In the Supabase SQL Editor, run{" "}
            <code className="rounded bg-zinc-100 px-1 text-xs dark:bg-zinc-800 dark:text-zinc-200">
              20260428000000_credit_cards.sql
            </code>{" "}
            first, then reload.
          </p>
        ) : null}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Credit Cards
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Balances, due dates, points, and renewal reminders for your linked credit cards.
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          <p>No credit cards are linked yet.</p>
          <p className="mt-1">
            Link a credit card through{" "}
            <Link href="/settings/bank" className="font-medium text-violet-600 underline dark:text-violet-400">
              Settings → Bank (Plaid)
            </Link>
            . Once a card with a credit account is connected, it will appear here.
          </p>
        </div>
      </div>
    );
  }

  return <CreditCardsManager initialCards={rows} />;
}
