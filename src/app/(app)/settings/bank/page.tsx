import { PlaidConnectPanel } from "@/components/plaid-connect-panel";
import { PlaidManualDedupePanel } from "@/components/plaid-manual-dedupe-panel";
import { PlaidAccountsTable } from "@/components/plaid-accounts-table";
import { PlaidRelinkButton } from "@/components/plaid-relink-button";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser } from "@/lib/household";
import { getPlaidEnv } from "@/lib/plaid-server";

export default async function SettingsBankPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) return null;

  const { data: connections, error: connErr } = await supabase
    .from("bank_connections")
    .select(
      "id, institution_name, institution_id, status, last_sync_at, created_at",
    )
    .eq("household_id", household.householdId)
    .order("created_at", { ascending: false });

  const { data: bankAccounts, error: acctErr } = await supabase
    .from("bank_accounts")
    .select(
      "id, name, display_name, mask, type, subtype, current_balance, plaid_account_id, bank_connection_id",
    )
    .eq("household_id", household.householdId)
    .order("name", { ascending: true });

  const { count: plaidTxCount, error: txCountErr } = await supabase
    .from("plaid_transactions")
    .select("id", { count: "exact", head: true })
    .eq("household_id", household.householdId);

  const connError = connErr?.message || acctErr?.message || txCountErr?.message;

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Connect accounts
        </h2>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          Link institutions with Plaid. Access tokens stay on the server
          (encrypted). Sync updates{" "}
          <code className="rounded bg-zinc-100 px-1 text-[11px] dark:bg-zinc-800">
            plaid_transactions
          </code>{" "}
          and, when a bank transaction matches a file import (same date, amount,
          and raw or normalized description), replaces the imported row in{" "}
          <code className="rounded bg-zinc-100 px-1 text-[11px] dark:bg-zinc-800">
            transactions
          </code>{" "}
          with the Plaid-backed row.
        </p>
        <div className="mt-4">
          <PlaidConnectPanel
            disabled={Boolean(connError)}
            plaidEnv={getPlaidEnv()}
          />
        </div>
      </section>

      {connError ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          Could not load bank data. Run the migration{" "}
          <code className="rounded bg-zinc-100 px-1 text-xs dark:bg-zinc-800">
            20260414100000_plaid_bank_link.sql
          </code>{" "}
          in Supabase if tables are missing: {connError}
        </p>
      ) : null}

      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Linked institutions
        </h2>
        {!connections?.length ? (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-500">
            No banks linked yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {connections.map((c) => (
              <li
                key={c.id}
                className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700"
              >
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {c.institution_name || "Bank"}
                </span>
                <span className="ml-2 text-zinc-500 dark:text-zinc-500">
                  {c.status}
                </span>
                {c.last_sync_at ? (
                  <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-500">
                    Last sync: {new Date(c.last_sync_at).toLocaleString()}
                  </span>
                ) : null}
                <PlaidRelinkButton bankConnectionId={String(c.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Plaid accounts
        </h2>
        {!bankAccounts?.length ? (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-500">
            No accounts yet.
          </p>
        ) : (
          <PlaidAccountsTable
            accounts={bankAccounts.map((a) => ({
              id: String(a.id),
              name: String(a.name ?? ""),
              display_name:
                a.display_name != null && String(a.display_name).trim() !== ""
                  ? String(a.display_name)
                  : null,
              mask: a.mask != null ? String(a.mask) : null,
              type: a.type != null ? String(a.type) : null,
              subtype: a.subtype != null ? String(a.subtype) : null,
              current_balance:
                a.current_balance != null ? Number(a.current_balance) : null,
            }))}
          />
        )}
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-500">
          Plaid transaction rows in DB:{" "}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {plaidTxCount ?? 0}
          </span>
        </p>
      </section>

      <PlaidManualDedupePanel />

      <section className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-xs text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
        <p className="font-medium">Server environment</p>
        <p className="mt-1">
          Add{" "}
          <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/50">
            SUPABASE_SERVICE_ROLE_KEY
          </code>
          , Plaid keys, and{" "}
          <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/50">
            PLAID_TOKEN_ENCRYPTION_KEY
          </code>{" "}
          (64 hex chars) to{" "}
          <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/50">
            .env.local
          </code>
          . See{" "}
          <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/50">
            .env.local.example
          </code>
          . Never expose the service role or Plaid secret to the browser.
        </p>
      </section>
    </div>
  );
}
