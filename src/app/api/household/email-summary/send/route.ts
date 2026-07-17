import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser } from "@/lib/household";
import { fetchEmailSummaryData } from "@/lib/fetch-summary-data";
import { buildSummaryEmail } from "@/lib/email-summary-template";
import type { SummaryPeriod, SummarySections } from "@/types/email-summary";

function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  return new Resend(key);
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) return NextResponse.json({ error: "No household" }, { status: 403 });

  const body = (await req.json()) as {
    period?: SummaryPeriod;
    recipients?: string[];
    sections?: Partial<SummarySections>;
  };

  const period: SummaryPeriod = body.period ?? "month";

  // Load saved settings to get recipients + sections (overridable from request body)
  const { data: savedRow } = await supabase
    .from("email_summary_settings")
    .select("*")
    .eq("household_id", household.householdId)
    .maybeSingle();

  const recipients: string[] =
    body.recipients ??
    (Array.isArray(savedRow?.recipients) ? (savedRow!.recipients as string[]) : []);

  if (recipients.length === 0) {
    return NextResponse.json({ error: "No recipients configured" }, { status: 400 });
  }

  const sections: SummarySections = {
    income_spending: body.sections?.income_spending ?? Boolean(savedRow?.section_income_spending ?? true),
    category_breakdown: body.sections?.category_breakdown ?? Boolean(savedRow?.section_category_breakdown ?? true),
    budget_progress: body.sections?.budget_progress ?? Boolean(savedRow?.section_budget_progress ?? false),
    top_transactions: body.sections?.top_transactions ?? Boolean(savedRow?.section_top_transactions ?? false),
    business_expenses: body.sections?.business_expenses ?? Boolean(savedRow?.section_business_expenses ?? false),
    savings_plans: body.sections?.savings_plans ?? Boolean(savedRow?.section_savings_plans ?? false),
    card_reminders: body.sections?.card_reminders ?? Boolean(savedRow?.section_card_reminders ?? false),
    ai_insights: body.sections?.ai_insights ?? Boolean(savedRow?.section_ai_insights ?? false),
  };

  let summaryData;
  try {
    summaryData = await fetchEmailSummaryData(
      supabase,
      household.householdId,
      household.name,
      period,
      sections,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to build summary: ${msg}` }, { status: 500 });
  }

  const html = buildSummaryEmail(summaryData);
  const subject = `${household.name} — ${summaryData.periodLabel} Summary`;

  let resend: Resend;
  try {
    resend = getResend();
  } catch {
    return NextResponse.json({ error: "RESEND_API_KEY is not configured on the server" }, { status: 500 });
  }

  const fromAddress = process.env.RESEND_FROM_EMAIL ?? "summaries@resend.dev";

  const { error: sendError } = await resend.emails.send({
    from: fromAddress,
    to: recipients,
    subject,
    html,
  });

  if (sendError) {
    return NextResponse.json({ error: sendError.message }, { status: 500 });
  }

  // Update last_sent_at
  await supabase
    .from("email_summary_settings")
    .upsert(
      { household_id: household.householdId, last_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "household_id" },
    );

  return NextResponse.json({ ok: true, recipients, period });
}
