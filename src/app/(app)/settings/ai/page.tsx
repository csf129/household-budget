import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser } from "@/lib/household";
import { redirect } from "next/navigation";
import { AiModelSettingsForm } from "@/components/ai-model-settings-form";
import { getHouseholdAiModel } from "@/lib/get-household-ai-model";

export default async function AiSettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) redirect("/");

  const modelId = await getHouseholdAiModel(supabase, household.householdId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">AI Model</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Choose which AI model powers categorization, income classification, budget proposals,
          email insights, and the assistant. Models are listed from lowest to highest token
          intensity.
        </p>
      </div>
      <AiModelSettingsForm initialModelId={modelId} />
    </div>
  );
}
