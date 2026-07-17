"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AccountsManager } from "@/components/accounts-manager";
import { HouseholdMembersPanel } from "@/components/household-members-panel";
import type { HouseholdMember } from "@/lib/household";
import type { AccountRow } from "@/types/finance";

type Props = {
  householdId: string;
  householdName: string;
  currentUserId: string;
  initialMembers: HouseholdMember[];
  initialAccounts: AccountRow[];
};

export function SettingsGeneralPanel({
  householdId,
  householdName,
  currentUserId,
  initialMembers,
  initialAccounts,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(householdName);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameOk, setNameOk] = useState<string | null>(null);

  useEffect(() => {
    setName(householdName);
  }, [householdName]);

  async function saveHouseholdName(e: React.FormEvent) {
    e.preventDefault();
    const next = name.trim();
    if (!next) {
      setNameError("Name cannot be empty.");
      return;
    }
    setNameError(null);
    setNameOk(null);
    setNameSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("households")
      .update({ name: next })
      .eq("id", householdId);
    setNameSaving(false);
    if (error) {
      setNameError(error.message);
      return;
    }
    setNameOk("Saved.");
    router.refresh();
  }

  return (
    <div className="space-y-10">
      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Household members
        </h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Set each person&apos;s level and name, or remove their access.
        </p>
        <div className="mt-4">
          <HouseholdMembersPanel
            initialMembers={initialMembers}
            currentUserId={currentUserId}
          />
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Household name
        </h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Shown in the header next to your email.
        </p>
        <form
          onSubmit={(e) => void saveHouseholdName(e)}
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="min-w-0 flex-1">
            <label htmlFor="household-name" className="sr-only">
              Household name
            </label>
            <input
              id="household-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameOk(null);
              }}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </div>
          <button
            type="submit"
            disabled={nameSaving}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {nameSaving ? "Saving…" : "Save name"}
          </button>
        </form>
        {nameError ? (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
            {nameError}
          </p>
        ) : null}
        {nameOk ? (
          <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">
            {nameOk}
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Accounts
        </h2>
        <div className="mt-4">
          <AccountsManager
            householdId={householdId}
            initialAccounts={initialAccounts}
          />
        </div>
      </section>
    </div>
  );
}
