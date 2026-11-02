import { callAi } from "@/lib/call-ai";
import { DEFAULT_AI_MODEL_ID } from "@/lib/ai-models";
import type {
  ReportData,
  SavingsAnalysis,
  SavingsEffort,
  SavingsOpportunity,
} from "@/types/report";

/**
 * AI "where to save the most, easiest first" analysis for the in-app report.
 * Runs on the household's configured model (Claude or OpenAI) via `call-ai`,
 * grounded in the assembled `ReportData` so it never invents figures, and
 * returns a structured `SavingsAnalysis` the report renders graphically.
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

  const feedback = (data.feedback ?? []).filter((f) => f.note.trim().length > 0);
  if (feedback.length) {
    lines.push(
      "Household notes & constraints (the household told us these about their own spending — honor them: do not suggest cutting something they've said they can't or won't, respect commitments and corrections, and fold their context into your actions):",
    );
    for (const f of feedback) {
      const label = f.category.trim() ? f.category.trim() : "General";
      lines.push(`  - [${label}] ${f.note.trim()}`);
    }
  }

  return lines.join("\n");
}

const SYSTEM_PROMPT =
  "You are a household finance advisor. From the data below, find the highest-impact, " +
  "lowest-effort ways this household can save money, and rank them by impact × ease — the " +
  "biggest, easiest wins first. Ground every number in the data provided; never invent a " +
  "figure that isn't there, and never estimate a monthly saving larger than the amount a " +
  "category is over its trailing average. If the data includes household notes & " +
  "constraints, treat them as authoritative: never recommend cutting something the " +
  "household has said they can't or won't change, respect their stated commitments and " +
  "corrections, and reflect that context in your actions (e.g. defer a change until a " +
  "prepaid term ends rather than proposing to cancel it now). Return ONLY a JSON object (no markdown, no prose, " +
  "no code fences) matching exactly this shape:\n" +
  '{\n' +
  '  "headline": string,                // one plain-English sentence on the overall opportunity\n' +
  '  "totalMonthlySaving": number,      // rough total $/month across the shortlist\n' +
  '  "opportunities": [                 // ranked, biggest + easiest first, up to 6\n' +
  '    {\n' +
  '      "category": string,            // the area, e.g. "Food & drink"\n' +
  '      "current": number,             // current monthly spend ($)\n' +
  '      "avg": number,                 // trailing-average monthly spend ($)\n' +
  '      "estMonthlySaving": number,    // realistic $/month saved if acted on\n' +
  '      "effort": "easy" | "medium" | "hard",\n' +
  '      "action": string               // one concrete next step, <= 20 words\n' +
  '    }\n' +
  '  ],\n' +
  '  "shortlist": string[]              // category names worth doing first\n' +
  "}\n" +
  "All dollar amounts are plain numbers (no $ or commas).";

const EFFORTS: SavingsEffort[] = ["easy", "medium", "hard"];

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/[$,\s]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function toEffort(value: unknown): SavingsEffort {
  return typeof value === "string" && (EFFORTS as string[]).includes(value.toLowerCase())
    ? (value.toLowerCase() as SavingsEffort)
    : "medium";
}

/** Extract the JSON object from a model reply that may be wrapped in fences/prose. */
function extractJson(raw: string): unknown {
  const fenced = raw.replace(/```(?:json)?/gi, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Coerce an arbitrary parsed value into a validated SavingsAnalysis, or null. */
export function parseSavingsAnalysis(raw: string): SavingsAnalysis | null {
  const obj = extractJson(raw);
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;

  const opportunities: SavingsOpportunity[] = Array.isArray(rec.opportunities)
    ? rec.opportunities
        .map((o): SavingsOpportunity | null => {
          if (!o || typeof o !== "object") return null;
          const r = o as Record<string, unknown>;
          const category = typeof r.category === "string" ? r.category.trim() : "";
          if (!category) return null;
          return {
            category,
            current: toNumber(r.current),
            avg: toNumber(r.avg),
            estMonthlySaving: Math.max(0, toNumber(r.estMonthlySaving)),
            effort: toEffort(r.effort),
            action: typeof r.action === "string" ? r.action.trim() : "",
          };
        })
        .filter((o): o is SavingsOpportunity => o !== null)
        .slice(0, 6)
    : [];

  if (opportunities.length === 0) return null;

  const shortlist = Array.isArray(rec.shortlist)
    ? rec.shortlist.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];

  const totalFromModel = toNumber(rec.totalMonthlySaving);
  const totalMonthlySaving =
    totalFromModel > 0
      ? totalFromModel
      : opportunities.reduce((sum, o) => sum + o.estMonthlySaving, 0);

  return {
    headline:
      typeof rec.headline === "string" && rec.headline.trim()
        ? rec.headline.trim()
        : "Here's where your household can save the most, easiest first.",
    totalMonthlySaving,
    opportunities,
    shortlist,
  };
}

export async function generateSavingsInsights(
  data: ReportData,
  modelId?: string,
): Promise<SavingsAnalysis | null> {
  const input = buildSavingsPromptInput(data);
  try {
    const raw = await callAi({
      modelId: modelId ?? DEFAULT_AI_MODEL_ID,
      temperature: 0.3,
      maxTokens: 1600,
      jsonMode: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: input },
      ],
    });
    return parseSavingsAnalysis(raw);
  } catch {
    return null;
  }
}
