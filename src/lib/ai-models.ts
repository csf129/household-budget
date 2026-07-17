export type AiProvider = "openai" | "anthropic";

export type AiModelConfig = {
  id: string;
  provider: AiProvider;
  displayName: string;
  description: string;
  /** 1 = lowest cost / fastest, 5 = highest cost / most capable */
  intensityLevel: 1 | 2 | 3 | 4 | 5;
};

export const AI_MODELS: AiModelConfig[] = [
  {
    id: "gpt-4o-mini",
    provider: "openai",
    displayName: "GPT-4o mini",
    description: "Fast and affordable. Great for everyday categorization and summaries.",
    intensityLevel: 1,
  },
  {
    id: "claude-haiku-4-5-20251001",
    provider: "anthropic",
    displayName: "Claude Haiku 4.5",
    description: "Claude's lightweight model. Fast, low-cost, reliable.",
    intensityLevel: 1,
  },
  {
    id: "gpt-4o",
    provider: "openai",
    displayName: "GPT-4o",
    description: "Balanced capability and cost. Strong at complex reasoning.",
    intensityLevel: 2,
  },
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    displayName: "Claude Sonnet 4.6",
    description: "Claude's everyday model. Smart, fast, and well-balanced.",
    intensityLevel: 2,
  },
  {
    id: "gpt-4.1",
    provider: "openai",
    displayName: "GPT-4.1",
    description: "High-accuracy GPT model with strong instruction following.",
    intensityLevel: 3,
  },
  {
    id: "o4-mini",
    provider: "openai",
    displayName: "o4-mini",
    description: "Reasoning-focused. Excellent for complex financial analysis.",
    intensityLevel: 4,
  },
  {
    id: "claude-opus-4-7",
    provider: "anthropic",
    displayName: "Claude Opus 4.7",
    description: "Claude's most capable model. Deep reasoning and nuanced insight.",
    intensityLevel: 4,
  },
  {
    id: "o3",
    provider: "openai",
    displayName: "o3",
    description: "OpenAI's most powerful reasoning model. Highest accuracy, highest cost.",
    intensityLevel: 5,
  },
];

export const DEFAULT_AI_MODEL_ID = "gpt-4o-mini";

export function getModelConfig(modelId: string): AiModelConfig | undefined {
  return AI_MODELS.find((m) => m.id === modelId);
}

export const INTENSITY_LABELS: Record<number, string> = {
  1: "Economy",
  2: "Standard",
  3: "Enhanced",
  4: "Premium",
  5: "Ultra",
};
