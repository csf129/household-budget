/**
 * Server-only: map imported spreadsheet lines to household category monthly budgets.
 */

import type { CategoryContext } from "@/lib/auto-categorize-openai";

export type BudgetLineForLlm = {
  description: string;
  sheetCategory: string;
  monthlyEquivalent: number;
  period: "monthly" | "annual";
};

export type CategoryBudgetProposal = {
  categoryId: string;
  monthlyBudget: number;
};

export type BudgetProposeResult = {
  proposals: CategoryBudgetProposal[];
  summary: string;
};

function buildUserContent(
  categories: CategoryContext[],
  lines: BudgetLineForLlm[],
  linesMonthlyTotal: number,
): string {
  const catLines = categories.map(
    (c) =>
      `- id=${c.id} name="${c.name.replace(/"/g, "'")}"${c.description ? ` notes: ${c.description.slice(0, 240)}` : ""}`,
  );
  const lineSummaries = lines.map((l) => {
    const desc = l.description.replace(/"/g, "'").slice(0, 200);
    const cat = l.sheetCategory.replace(/"/g, "'").slice(0, 80);
    return `- "${desc}" [sheet category: ${cat}] → $${l.monthlyEquivalent.toFixed(2)}/mo equivalent (${l.period})`;
  });

  const total = linesMonthlyTotal.toFixed(2);

  return `Household categories (use these ids only):\n${catLines.join("\n")}\n\nSpreadsheet-derived expense lines (allocate each line’s monthly equivalent to the best-matching category; every dollar must land in exactly one category):\n${lineSummaries.join("\n")}\n\nCRITICAL: The sum of all line monthly equivalents above is EXACTLY $${total}. The sum of every "monthlyBudget" in your proposals MUST equal $${total} within $1.00 (rounding only). Do not shrink or inflate the total.\n\nReturn JSON: {"summary":"short explanation for the user","proposals":[{"categoryId":"<uuid>","monthlyBudget":123.45}]}\nRules: Include every category id from the list exactly once. monthlyBudget is USD per month, >= 0, two decimal places. If no lines map to a category, use 0.`;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function fetchCategoryBudgetsFromOpenAI(
  apiKey: string,
  categories: CategoryContext[],
  lines: BudgetLineForLlm[],
  linesMonthlyTotal: number,
): Promise<BudgetProposeResult> {
  if (categories.length === 0) {
    throw new Error("No categories available.");
  }
  if (lines.length === 0) {
    throw new Error("No spreadsheet lines to allocate.");
  }

  const content = buildUserContent(categories, lines, linesMonthlyTotal);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a household budgeting assistant. Map spreadsheet budget lines to the user’s app categories. Reply with compact JSON only.",
        },
        { role: "user", content },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `OpenAI request failed (${res.status}): ${errText.slice(0, 500)}`,
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error("Empty response from OpenAI.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } else {
      throw new Error("Model did not return valid JSON.");
    }
  }

  const obj = parsed as {
    summary?: unknown;
    proposals?: unknown;
  };
  const summary =
    typeof obj.summary === "string" ? obj.summary : "Proposed budgets from your file.";

  const proposalsRaw = obj.proposals;
  if (!Array.isArray(proposalsRaw)) {
    throw new Error('Expected JSON with "proposals" array.');
  }

  const allowedIds = new Set(categories.map((c) => c.id));
  const byId = new Map<string, number>();

  for (const row of proposalsRaw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const categoryId =
      typeof r.categoryId === "string" ? r.categoryId.trim() : "";
    let monthlyBudget = 0;
    if (typeof r.monthlyBudget === "number" && Number.isFinite(r.monthlyBudget)) {
      monthlyBudget = r.monthlyBudget;
    } else if (typeof r.monthlyBudget === "string") {
      const n = Number.parseFloat(r.monthlyBudget);
      if (Number.isFinite(n)) monthlyBudget = n;
    }
    if (!categoryId || !allowedIds.has(categoryId)) continue;
    const add = Math.max(0, roundMoney(monthlyBudget));
    byId.set(categoryId, (byId.get(categoryId) ?? 0) + add);
  }

  const proposals: CategoryBudgetProposal[] = categories.map((c) => ({
    categoryId: c.id,
    monthlyBudget: byId.get(c.id) ?? 0,
  }));

  return { proposals, summary };
}
