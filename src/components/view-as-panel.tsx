"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setViewAs } from "@/app/(app)/view-as-actions";
import {
  HOUSEHOLD_ROLE_LABELS,
  type HouseholdMember,
  type HouseholdRole,
} from "@/lib/household";

type Props = {
  realRole: HouseholdRole;
  effectiveRole: HouseholdRole;
  viewingAsMemberId: string | null;
  members: HouseholdMember[];
};

const LEVELS: HouseholdRole[] = ["creator", "owner", "member"];

export function ViewAsPanel({
  realRole,
  effectiveRole,
  viewingAsMemberId,
  members,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function apply(input: { role?: HouseholdRole; memberId?: string }) {
    startTransition(async () => {
      await setViewAs(input);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 border-t border-zinc-100 p-3 dark:border-zinc-800">
      <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        View as
      </p>

      <div className="grid grid-cols-2 gap-1.5">
        {LEVELS.map((level) => {
          const active = !viewingAsMemberId && effectiveRole === level;
          return (
            <button
              key={level}
              type="button"
              disabled={pending}
              onClick={() => apply({ role: level })}
              className={`rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                active
                  ? "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-400 dark:bg-emerald-950/60 dark:text-emerald-100 dark:ring-emerald-700"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              }`}
            >
              {HOUSEHOLD_ROLE_LABELS[level]}
              {active ? " ✓" : ""}
            </button>
          );
        })}
      </div>

      <div>
        <label
          htmlFor="view-as-user"
          className="block px-1 text-[10px] text-zinc-400 dark:text-zinc-500"
        >
          View as a specific user:
        </label>
        <select
          id="view-as-user"
          value={viewingAsMemberId ?? ""}
          disabled={pending}
          onChange={(e) => {
            const memberId = e.target.value;
            if (!memberId) {
              apply({ role: realRole });
              return;
            }
            apply({ memberId });
          }}
          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
        >
          <option value="">Select a user…</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {(m.displayName ?? m.email)} — {HOUSEHOLD_ROLE_LABELS[m.role]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
