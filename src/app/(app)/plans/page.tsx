import { SavingsPlansManager } from "@/components/savings-plans-manager";
import { createClient } from "@/lib/supabase/server";
import { fetchSavingsPlansWithProgress } from "@/lib/fetch-savings-plans";
import { getHouseholdForUser } from "@/lib/household";
import { mapSavingsContribution } from "@/lib/map-savings-plan";

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

  return (
    <SavingsPlansManager
      householdId={household.householdId}
      initialPlans={initialPlans}
      initialContributions={initialContributions}
    />
  );
}
