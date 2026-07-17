import { callAi } from "@/lib/call-ai";
import { DEFAULT_AI_MODEL_ID } from "@/lib/ai-models";

type InsightInput = {
  periodLabel: string;
  totalIncome: number;
  totalSpending: number;
  categoryRows: { name: string; amount: number }[];
  budgetRows: { name: string; spent: number; budget: number }[];
  modelId?: string;
};

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

export async function generateAiInsights(input: InsightInput): Promise<string> {
  const { periodLabel, totalIncome, totalSpending, categoryRows, budgetRows } = input;
  const modelId = input.modelId ?? DEFAULT_AI_MODEL_ID;
  const net = totalIncome - totalSpending;

  const lines: string[] = [
    `Period: ${periodLabel}`,
    `Income: ${fmtUSD(totalIncome)}, Spending: ${fmtUSD(totalSpending)}, Net: ${fmtUSD(net)} (${net >= 0 ? "surplus" : "deficit"})`,
  ];

  if (categoryRows.length > 0) {
    lines.push("Top spending categories:");
    for (const c of categoryRows.slice(0, 8)) {
      const pct = totalSpending > 0 ? Math.round((c.amount / totalSpending) * 100) : 0;
      lines.push(`  - ${c.name}: ${fmtUSD(c.amount)} (${pct}% of spending)`);
    }
  }

  if (budgetRows.length > 0) {
    lines.push("Budget status:");
    for (const b of budgetRows) {
      const pct = b.budget > 0 ? Math.round((b.spent / b.budget) * 100) : 0;
      const over = b.spent > b.budget ? " — OVER BUDGET" : "";
      lines.push(`  - ${b.name}: ${fmtUSD(b.spent)} of ${fmtUSD(b.budget)} (${pct}%${over})`);
    }
  }

  try {
    return await callAi({
      modelId,
      temperature: 0.4,
      maxTokens: 400,
      messages: [
        {
          role: "system",
          content:
            "You are a personal finance advisor reviewing household spending data. Provide 2-3 specific observations about spending patterns and 2-3 actionable improvement suggestions. Be concise and practical. Use the bullet character • for each point. Keep each point to 1-2 sentences. Do not use markdown, headers, or bold formatting. Do not add section labels like 'Observations:' — just write the bullets.",
        },
        { role: "user", content: lines.join("\n") },
      ],
    });
  } catch {
    return "";
  }
}
