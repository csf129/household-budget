import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdForUser } from "@/lib/household";
import { getHouseholdAiModel } from "@/lib/get-household-ai-model";
import { fetchCreditCards } from "@/lib/fetch-credit-cards";
import {
  fetchCardInsights,
  type CardForInsights,
  type CategorySpend,
} from "@/lib/credit-card-insights-openai";

export const maxDuration = 60;

function ninetyDaysAgoIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().slice(0, 10);
}

async function spendingByCategory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string,
): Promise<CategorySpend[]> {
  const { data } = await supabase
    .from("transactions")
    .select("amount, categories ( name )")
    .eq("household_id", householdId)
    .lt("amount", 0)
    .gte("occurred_on", ninetyDaysAgoIso());

  const totals = new Map<string, number>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const rawAmt = row.amount;
    const amount = typeof rawAmt === "string" ? parseFloat(rawAmt) : Number(rawAmt);
    if (!Number.isFinite(amount) || amount >= 0) continue;
    const cat = Array.isArray(row.categories)
      ? (row.categories[0] as { name?: unknown } | undefined)
      : (row.categories as { name?: unknown } | null);
    const name = cat && cat.name ? String(cat.name) : "Uncategorized";
    totals.set(name, (totals.get(name) ?? 0) + -amount);
  }

  return [...totals.entries()]
    .map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 12);
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) return NextResponse.json({ error: "No household." }, { status: 403 });

  const { rows, error: cardErr } = await fetchCreditCards(supabase, household.householdId);
  if (cardErr) return NextResponse.json({ error: cardErr }, { status: 500 });
  if (rows.length === 0) {
    return NextResponse.json({ error: "No credit cards to analyze." }, { status: 400 });
  }

  const cards: CardForInsights[] = rows.map((c) => ({
    name: c.name,
    pointsProgram: c.pointsProgram,
    rewardSummary: c.rewardSummary,
    annualFee: c.annualFee,
    pointsBalance: c.pointsBalance,
    currentBalance: c.currentBalance,
    status: c.status,
  }));

  const spending = await spendingByCategory(supabase, household.householdId);
  const modelId = await getHouseholdAiModel(supabase, household.householdId);

  try {
    const insights = await fetchCardInsights(cards, spending, modelId);
    return NextResponse.json({ insights });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI error.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
