import { NextResponse } from "next/server";
import { getHouseholdForUser } from "@/lib/household";
import { createClient } from "@/lib/supabase/server";
import { callAi } from "@/lib/call-ai";
import { getHouseholdAiModel } from "@/lib/get-household-ai-model";

export const maxDuration = 30;

type Action = {
  type: "set_category_budget";
  categoryId: string;
  categoryName: string;
  monthlyBudget: number;
  reason?: string;
};

export async function POST(request: Request) {
  let body: { question?: string; reply?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const question = (body.question ?? "").trim();
  const reply = (body.reply ?? "").trim();
  if (!question || !reply) {
    return NextResponse.json({ actions: [] satisfies Action[] });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) return NextResponse.json({ error: "No household." }, { status: 403 });

  const [{ data: categories, error }, modelId] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, monthly_budget")
      .eq("household_id", household.householdId)
      .order("sort_order", { ascending: true }),
    getHouseholdAiModel(supabase, household.householdId),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const catList = (categories ?? []).map((c) => ({
    id: String(c.id),
    name: String(c.name ?? ""),
    monthly_budget:
      c.monthly_budget == null || c.monthly_budget === ""
        ? null
        : Number(c.monthly_budget),
  }));

  let raw = "";
  try {
    raw = await callAi({
      modelId,
      temperature: 0,
      maxTokens: 512,
      jsonMode: true,
      messages: [
        {
          role: "system",
          content:
            "Return JSON only. Create up to 4 concrete budget update actions when useful. If none, return empty actions. Do not invent category ids.",
        },
        {
          role: "user",
          content: `Question: ${question}\nAssistant reply: ${reply}\nCategories:\n${catList
            .map(
              (c) =>
                `- ${c.id} | ${c.name} | current=${c.monthly_budget == null ? "none" : c.monthly_budget}`,
            )
            .join("\n")}\n\nOutput schema: {"actions":[{"type":"set_category_budget","categoryId":"uuid","categoryName":"name","monthlyBudget":123.45,"reason":"short"}]}`,
        },
      ],
    });
  } catch {
    return NextResponse.json({ actions: [] satisfies Action[] });
  }

  if (!raw) return NextResponse.json({ actions: [] satisfies Action[] });
  let parsed: { actions?: unknown } = {};
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return NextResponse.json({ actions: [] satisfies Action[] });
  }
  const allowed = new Map(catList.map((c) => [c.id, c.name]));
  const actions: Action[] = [];
  for (const x of Array.isArray(parsed.actions) ? parsed.actions : []) {
    if (!x || typeof x !== "object") continue;
    const row = x as Record<string, unknown>;
    const type = String(row.type ?? "");
    const categoryId = String(row.categoryId ?? "").trim();
    const monthlyBudget = Number(row.monthlyBudget);
    if (type !== "set_category_budget" || !allowed.has(categoryId) || !Number.isFinite(monthlyBudget)) {
      continue;
    }
    actions.push({
      type: "set_category_budget",
      categoryId,
      categoryName: allowed.get(categoryId)!,
      monthlyBudget: Math.max(0, Math.round(monthlyBudget * 100) / 100),
      reason: typeof row.reason === "string" ? row.reason : undefined,
    });
  }

  return NextResponse.json({ actions: actions.slice(0, 4) });
}
