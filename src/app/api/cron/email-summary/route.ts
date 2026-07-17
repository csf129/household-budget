import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchEmailSummaryData } from "@/lib/fetch-summary-data";
import { buildSummaryEmail } from "@/lib/email-summary-template";
import type { SummarySections, SummaryFrequency, SummaryPeriod } from "@/types/email-summary";

function frequencyMatchesToday(frequency: SummaryFrequency): boolean {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const date = now.getDate();
  const month = now.getMonth() + 1; // 1-based

  if (frequency === "weekly") return day === 1; // every Monday
  if (frequency === "monthly") return date === 1; // 1st of month
  if (frequency === "quarterly") return date === 1 && [1, 4, 7, 10].includes(month);
  return false;
}

function frequencyToPeriod(frequency: SummaryFrequency): SummaryPeriod {
  if (frequency === "weekly") return "week";
  if (frequency === "quarterly") return "quarter";
  return "month";
}

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  }

  const adminClient = createSupabaseAdminClient();

  // Fetch all households with at least one frequency and at least one recipient
  const { data: rows, error } = await adminClient
    .from("email_summary_settings")
    .select("*, households(id, name)")
    .neq("frequencies", "{}")
    .neq("recipients", "{}");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return NextResponse.json({ error: "RESEND_API_KEY not set" }, { status: 500 });

  const resend = new Resend(resendKey);
  const fromAddress = process.env.RESEND_FROM_EMAIL ?? "summaries@resend.dev";
  const results: { householdId: string; frequency: string; status: string }[] = [];

  for (const row of rows ?? []) {
    const frequencies: SummaryFrequency[] = Array.isArray(row.frequencies)
      ? (row.frequencies as string[]).filter((f): f is SummaryFrequency =>
          ["weekly", "monthly", "quarterly"].includes(f),
        )
      : [];
    const matchingFrequencies = frequencies.filter(frequencyMatchesToday);
    if (matchingFrequencies.length === 0) continue;

    const householdId = String(row.household_id);
    const household = row.households as { id: string; name: string } | null;
    const householdName = household?.name ?? "Household";
    const recipients = Array.isArray(row.recipients) ? (row.recipients as string[]) : [];
    if (recipients.length === 0) continue;

    const sections: SummarySections = {
      income_spending: Boolean(row.section_income_spending),
      category_breakdown: Boolean(row.section_category_breakdown),
      budget_progress: Boolean(row.section_budget_progress),
      top_transactions: Boolean(row.section_top_transactions),
      business_expenses: Boolean(row.section_business_expenses),
      savings_plans: Boolean(row.section_savings_plans),
      card_reminders: Boolean(row.section_card_reminders),
      ai_insights: Boolean(row.section_ai_insights),
    };

    // Send one email per matching frequency (e.g. both weekly + monthly on the 1st)
    for (const frequency of matchingFrequencies) {
      try {
        const period = frequencyToPeriod(frequency);
        const summaryData = await fetchEmailSummaryData(
          adminClient,
          householdId,
          householdName,
          period,
          sections,
        );

        const html = buildSummaryEmail(summaryData);
        const subject = `${householdName} — ${summaryData.periodLabel} Summary`;

        const { error: sendError } = await resend.emails.send({
          from: fromAddress,
          to: recipients,
          subject,
          html,
        });

        if (sendError) throw new Error(sendError.message);

        results.push({ householdId, frequency, status: "sent" });
      } catch (err) {
        results.push({
          householdId,
          frequency,
          status: `error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    await adminClient
      .from("email_summary_settings")
      .update({ last_sent_at: new Date().toISOString() })
      .eq("household_id", householdId);
  }

  return NextResponse.json({ ok: true, results });
}
