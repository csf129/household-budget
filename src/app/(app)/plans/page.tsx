import type { SupabaseClient } from "@supabase/supabase-js";
import { SavingsPlansManager } from "@/components/savings-plans-manager";
import type {
  SavingsAccountInfo,
  SavingsAccountMonthlyTx,
} from "@/components/savings-account-flow-chart";
import { createClient } from "@/lib/supabase/server";
import { fetchSavingsPlansWithProgress } from "@/lib/fetch-savings-plans";
import { getHouseholdForUser } from "@/lib/household";
import { mapSavingsContribution } from "@/lib/map-savings-plan";

async function buildSavingsChartData(
  supabase: SupabaseClient,
  householdId: string,
): Promise<{ accounts: SavingsAccountInfo[]; txByAccount: SavingsAccountMonthlyTx[] }> {
  const { data: acctRaw } = await supabase
    .from("bank_accounts")
    .select("id, name, display_name, mask, subtype, current_balance")
    .eq("household_id", householdId)
    .order("name", { ascending: true });

  const accounts: SavingsAccountInfo[] = (acctRaw ?? []).map(
    (a: { id: string; name: string | null; display_name: string | null; mask: string | null; subtype: string | null; current_balance: string | number | null }) => ({
      id: String(a.id),
      name: String(a.name ?? ""),
      displayName: a.display_name ? String(a.display_name) : null,
      mask: a.mask ? String(a.mask) : null,
      subtype: a.subtype ? String(a.subtype) : null,
      currentBalance: a.current_balance !== null && a.current_balance !== undefined
        ? (typeof a.current_balance === "string" ? parseFloat(a.current_balance) : Number(a.current_balance))
        : null,
    }),
  );

  if (accounts.length === 0) return { accounts: [], txByAccount: [] };

  const allIds = accounts.map((a) => a.id);

  // Limit to last 24 months to keep payload small
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 2);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const { data: txRaw } = await supabase
    .from("transactions")
    .select("bank_account_id, amount, occurred_on")
    .eq("household_id", householdId)
    .not("bank_account_id", "is", null)
    .in("bank_account_id", allIds)
    .gte("occurred_on", cutoffStr)
    .order("occurred_on", { ascending: true });

  // Aggregate by accountId + monthKey
  const map = new Map<string, { inflow: number; outflow: number }>();
  for (const row of txRaw ?? []) {
    const accountId = String((row as { bank_account_id: string }).bank_account_id);
    const monthKey = String((row as { occurred_on: string }).occurred_on).slice(0, 7);
    const rawAmt = (row as { amount: string | number }).amount;
    const amount = typeof rawAmt === "string" ? parseFloat(rawAmt) : Number(rawAmt);
    if (!Number.isFinite(amount)) continue;
    const key = `${accountId}::${monthKey}`;
    if (!map.has(key)) map.set(key, { inflow: 0, outflow: 0 });
    const m = map.get(key)!;
    if (amount >= 0) m.inflow += amount;
    else m.outflow += amount;
  }

  const txByAccount: SavingsAccountMonthlyTx[] = Array.from(map.entries()).map(([key, val]) => {
    const [accountId, monthKey] = key.split("::");
    return {
      accountId,
      monthKey,
      transfersIn: Math.round(val.inflow * 100) / 100,
      transfersOut: Math.round(val.outflow * 100) / 100,
    };
  });

  return { accounts, txByAccount };
}

export default async function PlansPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) return null;

  const { rows: initialPlans, error: plansErr } =
    await fetchSavingsPlansWithProgress(supabase, household.householdId, {
      includeArchived: true,
    });

  if (plansErr) {
    return (
      <div className="space-y-2" role="alert">
        <p className="text-sm text-red-600 dark:text-red-400">
          Could not load plans: {plansErr}
        </p>
        {plansErr.toLowerCase().includes("savings_plans") ||
        plansErr.toLowerCase().includes("include_in_projection") ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            In the Supabase SQL Editor, run{" "}
            <code className="rounded bg-zinc-100 px-1 text-xs dark:bg-zinc-800 dark:text-zinc-200">
              20260411100000_savings_plans.sql
            </code>{" "}
            first, then{" "}
            <code className="rounded bg-zinc-100 px-1 text-xs dark:bg-zinc-800 dark:text-zinc-200">
              20260412100000_savings_plans_cadence_projection.sql
            </code>
            , then reload.
          </p>
        ) : null}
      </div>
    );
  }

  const { data: contribRaw, error: cErr } = await supabase
    .from("savings_plan_contributions")
    .select("*")
    .eq("household_id", household.householdId)
    .order("contributed_on", { ascending: false });

  if (cErr) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400" role="alert">
        Could not load contributions: {cErr.message}
      </p>
    );
  }

  const initialContributions = (contribRaw ?? []).map(mapSavingsContribution);

  const { accounts: savingsAccounts, txByAccount: savingsTxByAccount } =
    await buildSavingsChartData(supabase, household.householdId);

  return (
    <SavingsPlansManager
      householdId={household.householdId}
      initialPlans={initialPlans}
      initialContributions={initialContributions}
      savingsAccounts={savingsAccounts}
      savingsTxByAccount={savingsTxByAccount}
    />
  );
}
