import { callAi } from "@/lib/call-ai";
import { DEFAULT_AI_MODEL_ID } from "@/lib/ai-models";
import type { ReportData } from "@/types/report";

/**
 * AI "where to save the most, easiest first" narrative for the in-app report.
 * Runs on the household's configured model (Claude or OpenAI) via `call-ai`,
 * grounded in the assembled `ReportData` so it never invents figures.
 */

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

const BILL_HINTS = [
  "electric",
  "gas",
  "propane",
  "water",
  "power",
  "utility",
  "utilities",
  "internet",
  "phone",
  "cable",
  "insurance",
  "subscription",
  "streaming",
  "membership",
];
const CAR_HINTS = ["gas", "fuel", "auto", "car", "vehicle", "insurance", "dmv", "registration"];

function matchesAny(name: string, hints: string[]): boolean {
  const n = name.toLowerCase();
  return hints.some((h) => n.includes(h));
}

const dirArrow = (d: string) => (d === "up" ? "↑" : d === "down" ? "↓" : "→");

/** Build the grounded data block the model reasons over. Exported for testing. */
export function buildSavingsPromptInput(data: ReportData): string {
  const lines: string[] = [];
  const cur = data.months[data.currentIndex];
  lines.push(`Household: ${data.householdName}`);
  if (cur) {
    lines.push(
      `Current month (${cur.label}): income ${fmtUSD(cur.income)}, spending ${fmtUSD(cur.spending)}, net ${fmtUSD(cur.net)} (${cur.net >= 0 ? "surplus" : "deficit"}).`,
    );
  }
  lines.push(
    `Trailing avg: income ${fmtUSD(data.totals.avgIncome)}, spending ${fmtUSD(data.totals.avgSpending)}.`,
  );

  const risen = data.categories
    .filter((c) => c.direction === "up" && c.trendDelta > 0)
    .slice(0, 10);
  if (risen.length) {
    lines.push("Categories UP vs their trailing average (overage = monthly saving if reverted):");
    for (const c of risen) {
      lines.push(
        `  - ${c.name} ${dirArrow(c.direction)}: now ${fmtUSD(c.current)}, avg ${fmtUSD(c.trailingAvg)}, over by ${fmtUSD(c.trendDelta)}.`,
      );
    }
  }

  const bills = data.categories.filter((c) => matchesAny(c.name, BILL_HINTS)).slice(0, 12);
  if (bills.length) {
    lines.push("Bills / subscriptions / utilities (current vs trailing avg):");
    for (const c of bills) {
      lines.push(
        `  - ${c.name} ${dirArrow(c.direction)}: ${fmtUSD(c.current)} (avg ${fmtUSD(c.trailingAvg)}).`,
      );
    }
  }

  const cars = data.categories.filter((c) => matchesAny(c.name, CAR_HINTS)).slice(0, 8);
  if (cars.length) {
    lines.push("Car-related (fuel, insurance, vehicle):");
    for (const c of cars) {
      lines.push(`  - ${c.name} ${dirArrow(c.direction)}: ${fmtUSD(c.current)} (avg ${fmtUSD(c.trailingAvg)}).`);
    }
  }

  if (data.creditCards.length) {
    lines.push("Credit cards:");
    for (const c of data.creditCards) {
      const util = c.utilization != null ? `${Math.round(c.utilization * 100)}% utilization` : "utilization n/a";
      const fee = c.annualFee ? `, ${fmtUSD(c.annualFee)} annual fee` : "";
      const bal = c.balance != null ? `balance ${fmtUSD(c.balance)}` : "balance n/a";
      lines.push(`  - ${c.name}: ${bal}, ${util}${fee}.`);
    }
  }

  const behind = data.savingsPlans.filter((p) => p.pace < 0);
  if (behind.length) {
    lines.push("Savings plans behind pace:");
    for (const p of behind) {
      lines.push(
        `  - ${p.title}: saved ${fmtUSD(p.saved)} of ${fmtUSD(p.target)}, behind by ${fmtUSD(-p.pace)}.`,
      );
    }
  }

  return lines.join("\n");
}

export async function generateSavingsInsights(
  data: ReportData,
  modelId?: string,
): Promise<string> {
  const input = buildSavingsPromptInput(data);
  try {
    return await callAi({
      modelId: modelId ?? DEFAULT_AI_MODEL_ID,
      temperature: 0.3,
      maxTokens: 1600,
      messages: [
        {
          role: "system",
          content:
            "You are a household finance advisor. From the data below, find the highest-impact, " +
            "lowest-effort ways this household can save money, and rank them by impact × ease — the " +
            "biggest, easiest wins first. For each opportunity give: what it is, estimated monthly " +
            "dollars saved, effort (easy / medium / hard), and a one-line action. Ground every number " +
            "in the data provided; never invent a figure that isn't there. Finish with a short 'Do " +
            "these first' shortlist and a rough total monthly saving. Use concise markdown: a numbered " +
            "list, then the shortlist. No preamble.",
        },
        { role: "user", content: input },
      ],
    });
  } catch {
    return "";
  }
}
