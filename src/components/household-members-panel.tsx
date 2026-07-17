"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  ASSIGNABLE_ROLES,
  HOUSEHOLD_ROLE_LABELS,
  isHead,
  type HouseholdMember,
  type HouseholdRole,
} from "@/lib/household";

type Props = {
  initialMembers: HouseholdMember[];
  currentUserId: string;
};

export function HouseholdMembersPanel({ initialMembers, currentUserId }: Props) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const headCount = members.filter((m) => isHead(m.role)).length;

  async function changeRole(member: HouseholdMember, role: HouseholdRole) {
    setError(null);
    setOkMessage(null);
    setBusyId(member.id);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("set_household_member_role", {
      p_member_id: member.id,
      p_role: role,
    });
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setMembers((prev) =>
      prev.map((m) => (m.id === member.id ? { ...m, role } : m)),
    );
    setOkMessage(
      `${memberLabel(member)} is now a ${HOUSEHOLD_ROLE_LABELS[role].toLowerCase()}.`,
    );
    router.refresh();
  }

  async function saveDisplayName(member: HouseholdMember) {
    const next = draftName.trim();
    setError(null);
    setOkMessage(null);
    setBusyId(member.id);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc(
      "set_household_member_display_name",
      { p_member_id: member.id, p_display_name: next },
    );
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setMembers((prev) =>
      prev.map((m) =>
        m.id === member.id ? { ...m, displayName: next || null } : m,
      ),
    );
    setEditingId(null);
    setOkMessage("Name saved.");
    router.refresh();
  }

  async function removeMember(member: HouseholdMember) {
    const label = memberLabel(member);
    if (
      !window.confirm(
        `Remove ${label} from this household? They lose access immediately. Transactions they added stay.`,
      )
    ) {
      return;
    }
    setError(null);
    setOkMessage(null);
    setBusyId(member.id);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("remove_household_member", {
      p_member_id: member.id,
    });
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setMembers((prev) => prev.filter((m) => m.id !== member.id));
    setOkMessage(`${label} was removed.`);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {members.map((member) => {
          const isSelf = member.userId === currentUserId;
          const isLastHead = isHead(member.role) && headCount <= 1;
          const isCreatorRow = member.role === "creator";
          const busy = busyId === member.id;

          return (
            <li
              key={member.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                {editingId === member.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={`name-${member.id}`} className="sr-only">
                      Display name for {member.email}
                    </label>
                    <input
                      id={`name-${member.id}`}
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      maxLength={60}
                      placeholder="e.g. Sam"
                      className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                    <button
                      type="button"
                      onClick={() => void saveDisplayName(member)}
                      disabled={busy}
                      className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                    >
                      {busy ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      <span className="truncate">{memberLabel(member)}</span>
                      {isSelf ? (
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                          You
                        </span>
                      ) : null}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          member.role === "creator"
                            ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100"
                            : member.role === "owner"
                              ? "bg-violet-100 text-violet-900 dark:bg-violet-950/60 dark:text-violet-100"
                              : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                        }`}
                      >
                        {HOUSEHOLD_ROLE_LABELS[member.role]}
                      </span>
                    </p>
                    {member.displayName ? (
                      <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {member.email}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(member.id);
                        setDraftName(member.displayName ?? "");
                      }}
                      className="mt-1 text-xs font-medium text-violet-700 hover:underline dark:text-violet-300"
                    >
                      {member.displayName ? "Edit name" : "Add a name"}
                    </button>
                  </>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <label htmlFor={`role-${member.id}`} className="sr-only">
                  Level for {member.email}
                </label>
                <select
                  id={`role-${member.id}`}
                  value={member.role}
                  disabled={busy || isLastHead || isCreatorRow}
                  onChange={(e) =>
                    void changeRole(member, e.target.value as HouseholdRole)
                  }
                  title={
                    isCreatorRow
                      ? "The creator level is granted in the database and can't be changed here."
                      : isLastHead
                        ? "A household must have at least one head."
                        : undefined
                  }
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                >
                  {isCreatorRow ? (
                    <option value="creator">
                      {HOUSEHOLD_ROLE_LABELS.creator}
                    </option>
                  ) : null}
                  {ASSIGNABLE_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {HOUSEHOLD_ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void removeMember(member)}
                  disabled={busy || isSelf || isCreatorRow}
                  title={
                    isCreatorRow
                      ? "A creator can't be removed from the app."
                      : isSelf
                        ? "You cannot remove yourself."
                        : undefined
                  }
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      {okMessage ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">
          {okMessage}
        </p>
      ) : null}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Anyone joining with the invite code starts as a family member. Family
        members can use the whole app except settings; heads can do everything.
      </p>
    </div>
  );
}

function memberLabel(member: HouseholdMember): string {
  return member.displayName ?? member.email;
}
