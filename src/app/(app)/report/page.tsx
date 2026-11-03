import { ReportView } from "@/components/report-view";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser, isHead } from "@/lib/household";
import { getViewContext } from "@/lib/view-as";

export default async function ReportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) return null;

  // Budgets are a head-only setting; family members see the report read-only.
  const view = await getViewContext(supabase, household.role);
  const canEditBudget = isHead(view.effectiveRole);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Report
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          A full picture of{" "}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{household.name}</span>:
          income, spending trends, bills, cars, cards, and where you can save the most.
        </p>
      </div>

      <ReportView householdName={household.name} canEditBudget={canEditBudget} />
    </div>
  );
}
