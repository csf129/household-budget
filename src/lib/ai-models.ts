export type AiProvider = "openai" | "anthropic";

export type AiModelConfig = {
  id: string;
  provider: AiProvider;
  displayName: string;
  description: string;
  /** 1 = lowest cost / fastest, 5 = highest cost / most capable */
  intensityLevel: 1 | 2 | 3 | 4 | 5;
};

// Model IDs and prices verified 2026-11-01 against platform.claude.com (Anthropic)
// and developers.openai.com/api/docs/pricing (OpenAI). Use exact ID strings.
export const AI_MODELS: AiModelConfig[] = [
  // ── Level 1 · Economy ──────────────────────────────────────────────
  {
    id: "gpt-6-luna",
    provider: "openai",
    displayName: "GPT-6 Luna",
    description: "OpenAI's cheapest model. Built for high-volume, cost-sensitive work.",
    intensityLevel: 1,
  },
  {
    id: "claude-haiku-5-5",
    provider: "anthropic",
    displayName: "Claude Haiku 5.5",
    description: "Claude's lightweight model. Fast, low-cost, reliable.",
    intensityLevel: 1,
  },
  {
    id: "gpt-4o-mini",
    provider: "openai",
    displayName: "GPT-4o mini",
    description: "Older but dependable. Fine for everyday categorization and summaries.",
    intensityLevel: 1,
  },
  // ── Level 2 · Standard ─────────────────────────────────────────────
  {
    id: "gpt-6.1-terra",
    provider: "openai",
    displayName: "GPT-6.1 Terra",
    description: "Fast and efficient. A strong everyday default.",
    intensityLevel: 2,
  },
  {
    id: "claude-sonnet-5-5",
    provider: "anthropic",
    displayName: "Claude Sonnet 5.5",
    description: "Claude's everyday model. Smart, fast, and well-balanced.",
    intensityLevel: 2,
  },
  // ── Level 3 · Enhanced ─────────────────────────────────────────────
  {
    id: "gpt-6.1-sol",
    provider: "openai",
    displayName: "GPT-6.1 Sol",
    description: "Balances intelligence and cost for harder analysis.",
    intensityLevel: 3,
  },
  // ── Level 4 · Premium ──────────────────────────────────────────────
  {
    id: "o3",
    provider: "openai",
    displayName: "o3",
    description: "Reasoning-focused. Excellent for complex financial analysis.",
    intensityLevel: 4,
  },
  {
    id: "claude-opus-5-5",
    provider: "anthropic",
    displayName: "Claude Opus 5.5",
    description: "Claude's flagship. Deep reasoning and nuanced insight.",
    intensityLevel: 4,
  },
  // ── Level 5 · Ultra ────────────────────────────────────────────────
  {
    id: "gpt-6-astra",
    provider: "openai",
    displayName: "GPT-6 Astra",
    description: "OpenAI's flagship for the most demanding reasoning and coding.",
    intensityLevel: 5,
  },
  {
    id: "claude-fable-5-1",
    provider: "anthropic",
    displayName: "Claude Fable 5.1",
    description: "Anthropic's most capable model. Highest quality, highest cost.",
    intensityLevel: 5,
  },
];

export const DEFAULT_AI_MODEL_ID = "gpt-4o-mini";

export function getModelConfig(modelId: string): AiModelConfig | undefined {
  return AI_MODELS.find((m) => m.id === modelId);
}

/**
 * Provider for a model ID. Falls back to prefix inference for IDs not in the
 * list (e.g. a household's previously-saved model that has since been rotated
 * out), so a Claude ID never gets misrouted to the OpenAI endpoint.
 */
export function resolveProvider(modelId: string): AiProvider {
  const config = getModelConfig(modelId);
  if (config) return config.provider;
  return /^claude/i.test(modelId) ? "anthropic" : "openai";
}

export const INTENSITY_LABELS: Record<number, string> = {
  1: "Economy",
  2: "Standard",
  3: "Enhanced",
  4: "Premium",
  5: "Ultra",
};
