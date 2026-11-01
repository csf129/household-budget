import { resolveProvider, DEFAULT_AI_MODEL_ID } from "@/lib/ai-models";

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

/** JSON-schema-ish description of a tool's input, passed to both providers. */
export type AiToolSpec = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

/** A callable tool: its spec plus a server-side executor. The executor's
 *  return value is JSON-serialized and handed back to the model as a result. */
export type AiTool = {
  spec: AiToolSpec;
  run: (input: Record<string, unknown>) => Promise<unknown>;
};

/** o-series reasoning models (o1/o3/o4…) have their own JSON/response-format rules. */
function isOSeriesModel(modelId: string): boolean {
  return /^o\d/.test(modelId);
}

/**
 * "Modern" OpenAI models — o-series plus the GPT-5 and GPT-6 families — require
 * `max_completion_tokens` (not `max_tokens`) and accept only the default
 * temperature, so we omit it. Older gpt-4o / gpt-4.1 models keep the legacy shape.
 */
function isModernOpenAiModel(modelId: string): boolean {
  return /^o\d/.test(modelId) || /^gpt-[56]/.test(modelId);
}

function tokenLimitKey(modelId: string): "max_tokens" | "max_completion_tokens" {
  return isModernOpenAiModel(modelId) ? "max_completion_tokens" : "max_tokens";
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
  // Modern models (GPT-5/6 + o-series) use max_completion_tokens; legacy models
  // only set max_tokens when the caller specifies one.
  if (isModernOpenAiModel(opts.modelId)) {
    body.max_completion_tokens = opts.maxTokens ?? 16000;
  } else if (opts.maxTokens !== null) {
    body.max_tokens = opts.maxTokens;
  }
  // Modern models accept only the default temperature — omit it to avoid a 400.
  if (!isModernOpenAiModel(opts.modelId)) {
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

  // Note: `temperature` is intentionally omitted. Current Claude models (and the
  // 2026-10-21 API version) reject sampling params; default sampling is used.
  const body: Record<string, unknown> = {
    model: opts.modelId,
    max_tokens: opts.maxTokens,
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
  const provider = resolveProvider(modelId);
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
  if (!isModernOpenAiModel(opts.modelId)) {
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
  const provider = resolveProvider(modelId);
  const temperature = opts.temperature ?? 0.2;

  if (provider === "anthropic") {
    return streamAnthropic({ modelId, messages: opts.messages, temperature });
  }
  return streamOpenAi({ modelId, messages: opts.messages, temperature });
}

// ───────────────────────────── Tool-calling loop ─────────────────────────────

const DEFAULT_TOOL_ROUNDS = 4;

type ToolRunResult = { text: string; usage: TokenUsage };

async function runToolImpl(
  tools: AiTool[],
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const tool = tools.find((t) => t.spec.name === name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  try {
    return await tool.run(input);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

type AnthropicBlock =
  | { type: "text"; text?: string }
  | { type: "tool_use"; id: string; name: string; input?: Record<string, unknown> }
  | { type: string; [k: string]: unknown };

async function anthropicToolRounds(opts: {
  modelId: string;
  messages: AiChatMessage[];
  tools: AiTool[];
  temperature: number;
  maxTokens: number;
  maxRounds: number;
}): Promise<ToolRunResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");

  const { systemText, conversationMessages } = splitSystemMessages(opts.messages);
  const toolDefs = opts.tools.map((t) => ({
    name: t.spec.name,
    description: t.spec.description,
    input_schema: t.spec.inputSchema,
  }));

  // Content starts as plain strings; tool rounds append block arrays.
  const msgs: Array<{ role: string; content: unknown }> = conversationMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let prompt = 0;
  let completion = 0;

  for (let round = 0; round < opts.maxRounds; round++) {
    const lastRound = round === opts.maxRounds - 1;
    const body: Record<string, unknown> = {
      model: opts.modelId,
      max_tokens: opts.maxTokens,
      messages: msgs,
    };
    if (systemText) body.system = systemText;
    // On the final round, drop tools so the model must answer with text.
    if (!lastRound) body.tools = toolDefs;

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
    const data = (await res.json()) as {
      content?: AnthropicBlock[];
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    prompt += data.usage?.input_tokens ?? 0;
    completion += data.usage?.output_tokens ?? 0;

    const content = data.content ?? [];
    const toolUses = content.filter(
      (b): b is { type: "tool_use"; id: string; name: string; input?: Record<string, unknown> } =>
        b.type === "tool_use",
    );

    if (data.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = content
        .filter((b): b is { type: "text"; text?: string } => b.type === "text")
        .map((b) => b.text ?? "")
        .join("")
        .trim();
      return { text, usage: { prompt, completion, total: prompt + completion } };
    }

    msgs.push({ role: "assistant", content });
    const results = [];
    for (const tu of toolUses) {
      const result = await runToolImpl(opts.tools, tu.name, tu.input ?? {});
      results.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(result),
      });
    }
    msgs.push({ role: "user", content: results });
  }

  return { text: "", usage: { prompt, completion, total: prompt + completion } };
}

type OpenAiToolCall = { id: string; function: { name: string; arguments: string } };

async function openaiToolRounds(opts: {
  modelId: string;
  messages: AiChatMessage[];
  tools: AiTool[];
  temperature: number;
  maxTokens: number;
  maxRounds: number;
}): Promise<ToolRunResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const toolDefs = opts.tools.map((t) => ({
    type: "function",
    function: {
      name: t.spec.name,
      description: t.spec.description,
      parameters: t.spec.inputSchema,
    },
  }));

  const msgs: Array<Record<string, unknown>> = opts.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let prompt = 0;
  let completion = 0;

  for (let round = 0; round < opts.maxRounds; round++) {
    const lastRound = round === opts.maxRounds - 1;
    const body: Record<string, unknown> = {
      model: opts.modelId,
      messages: msgs,
      [tokenLimitKey(opts.modelId)]: opts.maxTokens,
    };
    if (!isModernOpenAiModel(opts.modelId)) body.temperature = opts.temperature;
    if (!lastRound) body.tools = toolDefs;

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
      choices?: Array<{
        message?: { content?: string | null; tool_calls?: OpenAiToolCall[] };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    prompt += data.usage?.prompt_tokens ?? 0;
    completion += data.usage?.completion_tokens ?? 0;

    const message = data.choices?.[0]?.message;
    const toolCalls = message?.tool_calls ?? [];

    if (toolCalls.length === 0) {
      return {
        text: (message?.content ?? "").trim(),
        usage: { prompt, completion, total: prompt + completion },
      };
    }

    // Echo the assistant tool-call message back, then one tool message per call.
    msgs.push({
      role: "assistant",
      content: message?.content ?? "",
      tool_calls: toolCalls,
    });
    for (const tc of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        /* leave args empty on malformed JSON */
      }
      const result = await runToolImpl(opts.tools, tc.function.name, args);
      msgs.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }
  }

  return { text: "", usage: { prompt, completion, total: prompt + completion } };
}

/**
 * Run an agentic tool-calling loop and return the model's final text plus
 * accumulated token usage across every round. Works for both providers; on the
 * last allowed round tools are withheld so the model is forced to answer.
 */
export async function runAiWithTools(opts: {
  modelId?: string;
  messages: AiChatMessage[];
  tools: AiTool[];
  temperature?: number;
  maxTokens?: number;
  maxRounds?: number;
}): Promise<ToolRunResult> {
  const modelId = opts.modelId ?? DEFAULT_AI_MODEL_ID;
  const provider = resolveProvider(modelId);
  const shared = {
    modelId,
    messages: opts.messages,
    tools: opts.tools,
    temperature: opts.temperature ?? 0.2,
    maxTokens: opts.maxTokens ?? 1500,
    maxRounds: opts.maxRounds ?? DEFAULT_TOOL_ROUNDS,
  };
  return provider === "anthropic" ? anthropicToolRounds(shared) : openaiToolRounds(shared);
}

/** Wrap already-computed text (and optional usage) as the chunk+sentinel stream
 *  the chat client expects, so the tool path reuses the streaming contract. */
export function createTextStream(text: string, usage?: TokenUsage): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (text) controller.enqueue(encoder.encode(text));
      if (usage) {
        controller.enqueue(encoder.encode(`${USAGE_SENTINEL}${JSON.stringify(usage)}`));
      }
      controller.close();
    },
  });
}
