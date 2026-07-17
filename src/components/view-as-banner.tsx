"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { clearViewAs } from "@/app/(app)/view-as-actions";
import { HOUSEHOLD_ROLE_LABELS, type HouseholdRole } from "@/lib/household";

type Props = {
  role: HouseholdRole;
  label: string;
};

export function ViewAsBanner({ role, label }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-400 px-4 py-1.5 text-center text-xs font-semibold text-amber-950">
      <span>
        Viewing as {label ? `${label} — ` : ""}
        {HOUSEHOLD_ROLE_LABELS[role]}. This previews the app&apos;s own gating,
        not database permissions.
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await clearViewAs();
            router.refresh();
          })
        }
        className="rounded-md bg-amber-950/15 px-2 py-0.5 font-bold underline-offset-2 hover:bg-amber-950/25 disabled:opacity-50"
      >
        {pending ? "Exiting…" : "Exit view"}
      </button>
    </div>
  );
}
