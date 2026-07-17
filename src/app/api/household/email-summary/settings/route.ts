import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser } from "@/lib/household";
import type { EmailSummarySettings, SummaryFrequency } from "@/types/email-summary";

const VALID_FREQUENCIES: SummaryFrequency[] = ["weekly", "monthly", "quarterly"];

function rowToSettings(row: Record<string, unknown>): EmailSummarySettings {
  return {
    recipients: Array.isArray(row.recipients) ? (row.recipients as string[]) : [],
    frequencies: Array.isArray(row.frequencies)
      ? (row.frequencies as string[]).filter((f): f is SummaryFrequency =>
          VALID_FREQUENCIES.includes(f as SummaryFrequency),
        )
      : [],
    sections: {
      income_spending: Boolean(row.section_income_spending ?? true),
      category_breakdown: Boolean(row.section_category_breakdown ?? true),
      budget_progress: Boolean(row.section_budget_progress ?? false),
      top_transactions: Boolean(row.section_top_transactions ?? false),
      business_expenses: Boolean(row.section_business_expenses ?? false),
      savings_plans: Boolean(row.section_savings_plans ?? false),
      card_reminders: Boolean(row.section_card_reminders ?? false),
      ai_insights: Boolean(row.section_ai_insights ?? false),
    },
    last_sent_at: row.last_sent_at ? String(row.last_sent_at) : null,
  };
}

const EMPTY_SETTINGS: EmailSummarySettings = {
  recipients: [],
  frequencies: [],
  sections: {
    income_spending: true,
    category_breakdown: true,
    budget_progress: false,
    top_transactions: false,
    business_expenses: false,
    savings_plans: false,
    card_reminders: false,
    ai_insights: false,
  },
  last_sent_at: null,
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) return NextResponse.json({ error: "No household" }, { status: 403 });

  const { data } = await supabase
    .from("email_summary_settings")
    .select("*")
    .eq("household_id", household.householdId)
    .maybeSingle();

  return NextResponse.json(data ? rowToSettings(data as Record<string, unknown>) : EMPTY_SETTINGS);
}

export async function PUT(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) return NextResponse.json({ error: "No household" }, { status: 403 });

  const body = (await req.json()) as Partial<EmailSummarySettings>;

  if (body.recipients && !Array.isArray(body.recipients)) {
    return NextResponse.json({ error: "recipients must be an array" }, { status: 400 });
  }
  if (body.frequencies) {
    if (!Array.isArray(body.frequencies) || body.frequencies.some((f) => !VALID_FREQUENCIES.includes(f))) {
      return NextResponse.json({ error: "invalid frequencies" }, { status: 400 });
    }
  }

  const upsertRow = {
    household_id: household.householdId,
    recipients: body.recipients ?? [],
    frequencies: body.frequencies ?? [],
    section_income_spending: body.sections?.income_spending ?? true,
    section_category_breakdown: body.sections?.category_breakdown ?? true,
    section_budget_progress: body.sections?.budget_progress ?? false,
    section_top_transactions: body.sections?.top_transactions ?? false,
    section_business_expenses: body.sections?.business_expenses ?? false,
    section_savings_plans: body.sections?.savings_plans ?? false,
    section_card_reminders: body.sections?.card_reminders ?? false,
    section_ai_insights: body.sections?.ai_insights ?? false,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("email_summary_settings")
    .upsert(upsertRow, { onConflict: "household_id" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(rowToSettings(data as Record<string, unknown>));
}
