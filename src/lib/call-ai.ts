import { getModelConfig, DEFAULT_AI_MODEL_ID } from "@/lib/ai-models";

export type AiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type TokenUsage = {
  prompt: number;
  completion: number;
  total: number;
};

/** Sentinel prefix appended at end of stream — null byte makes it unambiguous. */
export const USAGE_SENTINEL = "\x00__USAGE__";

/** o-series reasoning models don't accept temperature or max_tokens — use max_completion_tokens instead. */
function isOSeriesModel(modelId: string): boolean {
  return /^o\d/.test(modelId);
}

function tokenLimitKey(modelId: string): "max_tokens" | "max_completion_tokens" {
  return isOSeriesModel(modelId) ? "max_completion_tokens" : "max_tokens";
}

function splitSystemMessages(messages: AiChatMessage[]): {
  systemText: string;
  conversationMessages: AiChatMessage[];
} {
  const systemParts: string[] = [];
  const conversationMessages: AiChatMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
    } else {
      conversationMessages.push(m);
    }
  }
  return { systemText: systemParts.join("\n\n"), conversationMessages };
}

async function callOpenAi(opts: {
  modelId: string;
  messages: AiChatMessage[];
  temperature: number;
  maxTokens: number | null;
  jsonMode: boolean;
  stream: false;
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const body: Record<string, unknown> = {
    model: opts.modelId,
    messages: opts.messages,
  };
  // o-series uses max_completion_tokens; standard models only set max_tokens when caller specifies one
  if (isOSeriesModel(opts.modelId)) {
    body.max_completion_tokens = opts.maxTokens ?? 16000;
  } else if (opts.maxTokens !== null) {
    body.max_tokens = opts.maxTokens;
  }
  if (!isOSeriesModel(opts.modelId)) {
    body.temperature = opts.temperature;
  }
  // o-series models don't support response_format json_object; they follow JSON instructions via prompt
  if (opts.jsonMode && !isOSeriesModel(opts.modelId)) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI failed (${res.status}): ${txt.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  };
  const choice = data.choices?.[0];
  const content = choice?.message?.content?.trim() ?? "";
  if (!content) {
    const reason = choice?.finish_reason ?? "unknown";
    throw new Error(`AI returned empty content (finish_reason: ${reason}). Try switching to gpt-4o-mini in the model dropdown.`);
  }
  return content;
}

async function callAnthropic(opts: {
  modelId: string;
  messages: AiChatMessage[];
  temperature: number;
  maxTokens: number;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");

  const { systemText, conversationMessages } = splitSystemMessages(opts.messages);

  const body: Record<string, unknown> = {
    model: opts.modelId,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    messages: conversationMessages,
  };
  if (systemText) body.system = systemText;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Anthropic failed (${res.status}): ${txt.slice(0, 400)}`);
  }
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return data.content?.find((b) => b.type === "text")?.text?.trim() ?? "";
}

/** Non-streaming AI call. Returns text content from the model. */
export async function callAi(opts: {
  modelId?: string;
  messages: AiChatMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}): Promise<string> {
  const modelId = opts.modelId ?? DEFAULT_AI_MODEL_ID;
  const config = getModelConfig(modelId);
  const provider = config?.provider ?? "openai";
  const temperature = opts.temperature ?? 0.2;
  const maxTokens = opts.maxTokens ?? 1024;

  if (provider === "anthropic") {
    return callAnthropic({ modelId, messages: opts.messages, temperature, maxTokens });
  }
  return callOpenAi({
    modelId,
    messages: opts.messages,
    temperature,
    maxTokens,
    jsonMode: opts.jsonMode ?? false,
    stream: false,
  });
}

async function streamOpenAi(opts: {
  modelId: string;
  messages: AiChatMessage[];
  temperature: number;
}): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const streamBody: Record<string, unknown> = {
    model: opts.modelId,
    stream: true,
    stream_options: { include_usage: true },
    messages: opts.messages,
    [tokenLimitKey(opts.modelId)]: 1024,
  };
  if (!isOSeriesModel(opts.modelId)) {
    streamBody.temperature = opts.temperature;
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(streamBody),
  });
  if (!res.ok || !res.body) {
    const txt = await res.text();
    throw new Error(`OpenAI stream failed (${res.status}): ${txt.slice(0, 400)}`);
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const source = res.body;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = source.getReader();
      let buffer = "";
      let usage: TokenUsage | null = null;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const obj = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string } }>;
                usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
              };
              const chunk = obj.choices?.[0]?.delta?.content ?? "";
              if (chunk) controller.enqueue(encoder.encode(chunk));
              if (obj.usage) {
                usage = {
                  prompt: obj.usage.prompt_tokens ?? 0,
                  completion: obj.usage.completion_tokens ?? 0,
                  total: obj.usage.total_tokens ?? 0,
                };
              }
            } catch { /* ignore malformed SSE lines */ }
          }
        }
      } finally {
        if (usage) {
          controller.enqueue(encoder.encode(`${USAGE_SENTINEL}${JSON.stringify(usage)}`));
        }
        controller.close();
      }
    },
  });
}

async function streamAnthropic(opts: {
  modelId: string;
  messages: AiChatMessage[];
  temperature: number;
}): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");

  const { systemText, conversationMessages } = splitSystemMessages(opts.messages);
  const body: Record<string, unknown> = {
    model: opts.modelId,
    max_tokens: 1024,
    temperature: opts.temperature,
    stream: true,
    messages: conversationMessages,
  };
  if (systemText) body.system = systemText;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const txt = await res.text();
    throw new Error(`Anthropic stream failed (${res.status}): ${txt.slice(0, 400)}`);
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const source = res.body;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = source.getReader();
      let buffer = "";
      let inputTokens = 0;
      let outputTokens = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            try {
              const obj = JSON.parse(payload) as {
                type?: string;
                message?: { usage?: { input_tokens?: number } };
                delta?: { type?: string; text?: string };
                usage?: { output_tokens?: number };
              };
              if (obj.type === "message_start") {
                inputTokens = obj.message?.usage?.input_tokens ?? 0;
              } else if (obj.type === "message_delta") {
                outputTokens = obj.usage?.output_tokens ?? 0;
              } else if (obj.type === "content_block_delta" && obj.delta?.type === "text_delta") {
                const chunk = obj.delta.text ?? "";
                if (chunk) controller.enqueue(encoder.encode(chunk));
              }
            } catch { /* ignore malformed SSE lines */ }
          }
        }
      } finally {
        if (inputTokens > 0 || outputTokens > 0) {
          const usage: TokenUsage = {
            prompt: inputTokens,
            completion: outputTokens,
            total: inputTokens + outputTokens,
          };
          controller.enqueue(encoder.encode(`${USAGE_SENTINEL}${JSON.stringify(usage)}`));
        }
        controller.close();
      }
    },
  });
}

/** Streaming AI call. Returns a ReadableStream that emits raw text chunks,
 *  followed by a USAGE_SENTINEL + JSON usage object as the very last chunk. */
export async function streamAi(opts: {
  modelId?: string;
  messages: AiChatMessage[];
  temperature?: number;
}): Promise<ReadableStream<Uint8Array>> {
  const modelId = opts.modelId ?? DEFAULT_AI_MODEL_ID;
  const config = getModelConfig(modelId);
  const provider = config?.provider ?? "openai";
  const temperature = opts.temperature ?? 0.2;

  if (provider === "anthropic") {
    return streamAnthropic({ modelId, messages: opts.messages, temperature });
  }
  return streamOpenAi({ modelId, messages: opts.messages, temperature });
}
