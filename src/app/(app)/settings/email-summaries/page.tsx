import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser } from "@/lib/household";
import { redirect } from "next/navigation";
import { EmailSummarySettingsForm } from "@/components/email-summary-settings-form";
import type { EmailSummarySettings, SummaryFrequency } from "@/types/email-summary";

export default async function EmailSummariesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) redirect("/");

  const { data } = await supabase
    .from("email_summary_settings")
    .select("*")
    .eq("household_id", household.householdId)
    .maybeSingle();

  const initial: EmailSummarySettings = data
    ? {
        recipients: Array.isArray(data.recipients) ? (data.recipients as string[]) : [],
        frequencies: Array.isArray(data.frequencies)
          ? (data.frequencies as string[]).filter((f): f is SummaryFrequency =>
              ["weekly", "monthly", "quarterly"].includes(f),
            )
          : [],
        sections: {
          income_spending: Boolean(data.section_income_spending ?? true),
          category_breakdown: Boolean(data.section_category_breakdown ?? true),
          budget_progress: Boolean(data.section_budget_progress ?? false),
          top_transactions: Boolean(data.section_top_transactions ?? false),
          business_expenses: Boolean(data.section_business_expenses ?? false),
          savings_plans: Boolean(data.section_savings_plans ?? false),
        },
        last_sent_at: data.last_sent_at ? String(data.last_sent_at) : null,
      }
    : {
        recipients: [],
        frequencies: [],
        sections: {
          income_spending: true,
          category_breakdown: true,
          budget_progress: false,
          top_transactions: false,
          business_expenses: false,
          savings_plans: false,
        },
        last_sent_at: null,
      };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Email Summaries</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Send periodic spending summaries to one or more email addresses. Requires a{" "}
          <code className="rounded bg-zinc-100 px-1 text-xs dark:bg-zinc-800">RESEND_API_KEY</code>{" "}
          and optionally{" "}
          <code className="rounded bg-zinc-100 px-1 text-xs dark:bg-zinc-800">RESEND_FROM_EMAIL</code>{" "}
          environment variables.
        </p>
      </div>
      <EmailSummarySettingsForm initial={initial} />
    </div>
  );
}
