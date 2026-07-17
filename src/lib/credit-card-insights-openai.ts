import { callAi } from "@/lib/call-ai";
import { DEFAULT_AI_MODEL_ID } from "@/lib/ai-models";
import type { CardInsights } from "@/types/credit-card";

export type CardForInsights = {
  name: string;
  pointsProgram: string | null;
  rewardSummary: string | null;
  annualFee: number | null;
  pointsBalance: number | null;
  currentBalance: number | null;
  status: "active" | "review" | "cancelled";
};

export type CategorySpend = { category: string; amount: number };

const SYSTEM_PROMPT = [
  "You are a credit-card rewards strategist for a single household.",
  "You help the user route spending to the right card, spot cards that aren't earning their keep, and decide whether to keep or cancel each card.",
  "IMPORTANT LIMITATION: You have a training cutoff and NO live internet access. You do NOT know any issuer's CURRENT sign-up bonuses, limited-time promotions, or this year's exact earn rates. Never invent a specific live promotion. Base advice on the reward structure the user provided and general, durable knowledge of how these programs work. When a current offer would matter, tell the user to check the issuer's app rather than stating one.",
  "Reply with compact JSON only — no prose outside the JSON.",
].join(" ");

function buildUserContent(cards: CardForInsights[], spending: CategorySpend[]): string {
  const cardLines = cards.map((c) => {
    const parts = [`name="${c.name.replace(/"/g, "'")}"`, `status=${c.status}`];
    if (c.pointsProgram) parts.push(`program="${c.pointsProgram.replace(/"/g, "'")}"`);
    if (c.rewardSummary) parts.push(`rewards="${c.rewardSummary.replace(/"/g, "'").slice(0, 240)}"`);
    if (c.annualFee != null) parts.push(`annualFee=$${c.annualFee.toFixed(2)}`);
    if (c.pointsBalance != null) parts.push(`pointsBalance=${c.pointsBalance}`);
    if (c.currentBalance != null) parts.push(`balanceOwed=$${c.currentBalance.toFixed(2)}`);
    return `- ${parts.join(" ")}`;
  });

  const spendLines =
    spending.length > 0
      ? spending.map((s) => `- ${s.category}: $${s.amount.toFixed(2)}`).join("\n")
      : "- (no recent categorized spending available)";

  return [
    "The household's credit cards:",
    cardLines.join("\n"),
    "",
    "Spending by category over roughly the last 90 days:",
    spendLines,
    "",
    'Return JSON with this exact shape: {"perCategory":[{"category":"...","recommendedCard":"...","why":"..."}],"underusedCards":[{"card":"...","reason":"..."}],"verdicts":[{"card":"...","verdict":"keep"|"consider cancelling"|"cancel","reasoning":"..."}],"tips":["..."]}',
    "Rules: recommendedCard and card MUST be one of the card names listed above. For perCategory, cover the top spending categories. For verdicts, include every card and weigh its annual fee against the value it earns for this household's actual spending. Keep every string under ~240 characters. tips: 2-5 short, durable optimization tips (no fabricated live offers).",
  ].join("\n");
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export async function fetchCardInsights(
  cards: CardForInsights[],
  spending: CategorySpend[],
  modelId?: string,
): Promise<CardInsights> {
  if (cards.length === 0) throw new Error("No credit cards to analyze.");

  const raw = await callAi({
    modelId: modelId ?? DEFAULT_AI_MODEL_ID,
    temperature: 0.3,
    maxTokens: 2048,
    jsonMode: true,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserContent(cards, spending) },
    ],
  });

  if (!raw) throw new Error("Empty response from AI.");

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

  const obj = parsed as Record<string, unknown>;
  const cardNames = new Set(cards.map((c) => c.name));

  const perCategory = arr(obj.perCategory)
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return { category: asStr(o.category), recommendedCard: asStr(o.recommendedCard), why: asStr(o.why) };
    })
    .filter((r) => r.category && cardNames.has(r.recommendedCard));

  const underusedCards = arr(obj.underusedCards)
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return { card: asStr(o.card), reason: asStr(o.reason) };
    })
    .filter((r) => cardNames.has(r.card) && r.reason);

  const verdicts = arr(obj.verdicts)
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return { card: asStr(o.card), verdict: asStr(o.verdict), reasoning: asStr(o.reasoning) };
    })
    .filter((r) => cardNames.has(r.card) && r.verdict);

  const tips = arr(obj.tips)
    .map((t) => asStr(t))
    .filter(Boolean)
    .slice(0, 6);

  return { perCategory, underusedCards, verdicts, tips };
}
