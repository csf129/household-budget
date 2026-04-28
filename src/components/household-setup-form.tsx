"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function HouseholdSetupForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"create" | "join">("create");
  const [householdName, setHouseholdName] = useState("Our household");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const name = householdName.trim() || "Our household";
    const { error: rpcError } = await supabase.rpc("create_household", {
      p_name: name,
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.refresh();
    router.push("/dashboard");
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const code = inviteCode.trim().toUpperCase();
    if (!code) {
      setError("Enter the invite code your partner shared.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("join_household", {
      p_invite_code: code,
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.refresh();
    router.push("/dashboard");
  }

  return (
    <div className="space-y-6">
      <div className="flex rounded-lg border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-900/80">
        <button
          type="button"
          onClick={() => {
            setMode("create");
            setError(null);
          }}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
            mode === "create"
              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
              : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          }`}
        >
          Start a household
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("join");
            setError(null);
          }}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
            mode === "join"
              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
              : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          }`}
        >
          Join with code
        </button>
      </div>

      {error ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {mode === "create" ? (
        <form onSubmit={handleCreate} className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            You will be the owner and get an invite code to share with your
            partner.
          </p>
          <div>
            <label
              htmlFor="household-name"
              className="block text-sm font-medium text-zinc-800 dark:text-zinc-200"
            >
              Household name
            </label>
            <input
              id="household-name"
              type="text"
              value={householdName}
              onChange={(e) => setHouseholdName(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
              placeholder="Our household"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {loading ? "Creating…" : "Create household"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleJoin} className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Enter the code your partner sees on their dashboard (letters and
            numbers, not case-sensitive).
          </p>
          <div>
            <label
              htmlFor="invite-code"
              className="block text-sm font-medium text-zinc-800 dark:text-zinc-200"
            >
              Invite code
            </label>
            <input
              id="invite-code"
              type="text"
              autoComplete="off"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-zinc-900 shadow-sm uppercase outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
              placeholder="e.g. A1B2C3D4"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {loading ? "Joining…" : "Join household"}
          </button>
        </form>
      )}
    </div>
  );
}
