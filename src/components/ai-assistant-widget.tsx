"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AI_MODELS, INTENSITY_LABELS, DEFAULT_AI_MODEL_ID } from "@/lib/ai-models";
import { USAGE_SENTINEL, type TokenUsage } from "@/lib/call-ai";

type AssistantAction = {
  type: "set_category_budget";
  categoryId: string;
  categoryName: string;
  monthlyBudget: number;
  reason?: string;
};

type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: AssistantAction[];
  usage?: TokenUsage;
};

const SUGGESTED_PROMPTS = [
  "What are my biggest spending trends this month?",
  "Suggest monthly budgets based on my recent spending.",
  "How can I fund a $2,000 project in 4 months?",
  "Where can I cut spending without hurting essentials?",
];

const MODEL_GROUPS = [1, 2, 3, 4, 5].flatMap((level) => {
  const models = AI_MODELS.filter((m) => m.intensityLevel === level);
  return models.length ? [{ level, label: INTENSITY_LABELS[level] ?? String(level), models }] : [];
});

function parseUsageSentinel(full: string): { text: string; usage: TokenUsage | undefined } {
  const idx = full.indexOf(USAGE_SENTINEL);
  if (idx < 0) return { text: full, usage: undefined };
  try {
    const usage = JSON.parse(full.slice(idx + USAGE_SENTINEL.length)) as TokenUsage;
    return { text: full.slice(0, idx), usage };
  } catch {
    return { text: full.slice(0, idx), usage: undefined };
  }
}

const PRICING_ROWS = [
  { model: "GPT-4o mini",      provider: "ChatGPT",  input: "$0.15",  output: "$0.60"  },
  { model: "Claude Haiku 4.5", provider: "Claude",   input: "$0.80",  output: "$4.00"  },
  { model: "GPT-4o",           provider: "ChatGPT",  input: "$2.50",  output: "$10.00" },
  { model: "GPT-4.1",          provider: "ChatGPT",  input: "$2.00",  output: "$8.00"  },
  { model: "Claude Sonnet 4.6",provider: "Claude",   input: "$3.00",  output: "$15.00" },
  { model: "o4-mini",          provider: "ChatGPT",  input: "$1.10",  output: "$4.40"  },
  { model: "Claude Opus 4.7",  provider: "Claude",   input: "$15.00", output: "$75.00" },
  { model: "o3",               provider: "ChatGPT",  input: "$10.00", output: "$40.00" },
];

function PricingTooltip() {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, rightFromEdge: 0, arrowRight: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  function show() {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      // Anchor tooltip's right edge to the button's right edge, expanding leftward
      const rightFromEdge = window.innerWidth - r.right;
      // Arrow points at button centre; offset from right edge of tooltip (288px wide)
      const arrowRight = 288 - (r.left + r.width / 2 - (window.innerWidth - r.right - 288));
      setCoords({ top: r.top - 8, rightFromEdge, arrowRight: Math.max(8, Math.min(272, arrowRight)) });
    }
    setVisible(true);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={show}
        onMouseLeave={() => setVisible(false)}
        onFocus={show}
        onBlur={() => setVisible(false)}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-[9px] font-bold text-zinc-400 hover:border-violet-400 hover:text-violet-500 dark:border-zinc-600 dark:text-zinc-500 dark:hover:border-violet-500 dark:hover:text-violet-400"
        aria-label="Model pricing information"
      >
        i
      </button>
      {visible && (
        <div
          style={{
            position: "fixed",
            top: coords.top,
            right: coords.rightFromEdge,
            transform: "translateY(-100%)",
            zIndex: 9999,
          }}
          className="w-72 rounded-xl border border-zinc-200 bg-white p-3 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        >
          {/* Arrow pointing down toward the button */}
          <div
            style={{ position: "absolute", bottom: -6, right: coords.arrowRight, transform: "rotate(45deg)" }}
            className="h-3 w-3 border-b border-r border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
          />
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Pricing per 1 million tokens
          </p>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-zinc-400 dark:text-zinc-500">
                <th className="pb-1 font-medium">Model</th>
                <th className="pb-1 text-right font-medium">Input</th>
                <th className="pb-1 text-right font-medium">Output</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {PRICING_ROWS.map((row) => (
                <tr key={row.model}>
                  <td className="py-1 pr-2">
                    <span className="text-zinc-800 dark:text-zinc-200">{row.model}</span>
                    <span className={`ml-1 text-[9px] ${row.provider === "Claude" ? "text-orange-500" : "text-teal-500"}`}>
                      {row.provider}
                    </span>
                  </td>
                  <td className="py-1 text-right font-mono text-zinc-600 dark:text-zinc-400">{row.input}</td>
                  <td className="py-1 text-right font-mono text-zinc-600 dark:text-zinc-400">{row.output}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[9px] text-zinc-400 dark:text-zinc-500">
            Check platform.openai.com or console.anthropic.com for current rates.
          </p>
        </div>
      )}
    </>
  );
}

function TokenBadge({ usage }: { usage: TokenUsage }) {
  return (
    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-400 dark:text-zinc-500">
      <span title="Prompt tokens">↑ {usage.prompt.toLocaleString()}</span>
      <span className="text-zinc-300 dark:text-zinc-600">·</span>
      <span title="Completion tokens">↓ {usage.completion.toLocaleString()}</span>
      <span className="text-zinc-300 dark:text-zinc-600">·</span>
      <span className="font-medium text-zinc-500 dark:text-zinc-400" title="Total tokens">
        {usage.total.toLocaleString()} tokens
      </span>
    </div>
  );
}

export function AiAssistantWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedAction, setAppliedAction] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string>(DEFAULT_AI_MODEL_ID);
  const [modelSaving, setModelSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/household/ai-settings")
      .then((r) => r.json())
      .then((d: { modelId?: string }) => {
        if (d.modelId) setModelId(d.modelId);
      })
      .catch(() => {/* keep default */});
  }, [open]);

  async function handleModelChange(newModelId: string) {
    setModelId(newModelId);
    setModelSaving(true);
    try {
      await fetch("/api/household/ai-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: newModelId }),
      });
    } finally {
      setModelSaving(false);
    }
  }

  const currentModel = AI_MODELS.find((m) => m.id === modelId);

  const canSend = input.trim().length > 0 && !busy;
  const visibleMessages = useMemo(
    () => messages.slice(Math.max(0, messages.length - 14)),
    [messages],
  );

  // Session-total token counter
  const sessionTokens = useMemo(
    () => messages.reduce((sum, m) => sum + (m.usage?.total ?? 0), 0),
    [messages],
  );

  async function sendMessage() {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    setAppliedAction(null);
    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: "user", content: text };
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setInput("");
    setBusy(true);
    try {
      const priorForApi = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const res = await fetch("/api/household/assistant/chat?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: priorForApi }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "Could not get an AI response.");
        return;
      }
      if (!res.body) {
        setError("AI response was empty.");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        full += chunk;
        // Strip sentinel from live display (it starts with \x00)
        const liveText = full.includes("\x00") ? full.slice(0, full.indexOf("\x00")) : full;
        setMessages((prev) =>
          prev.map((m) => m.id === assistantId ? { ...m, content: liveText } : m),
        );
      }

      // Parse usage sentinel and do final clean update
      const { text: finalText, usage } = parseUsageSentinel(full);
      if (!finalText.trim()) {
        setError("AI response was empty.");
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: finalText, usage } : m,
        ),
      );

      const actionRes = await fetch("/api/household/assistant/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, reply: finalText }),
      });
      const actionData = (await actionRes.json().catch(() => ({}))) as {
        actions?: AssistantAction[];
      };
      const actions = Array.isArray(actionData.actions) ? actionData.actions : [];
      if (actions.length > 0) {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, actions } : m)),
        );
      }
    } catch {
      setError("Network error while contacting the AI assistant.");
    } finally {
      setBusy(false);
    }
  }

  async function applyAction(action: AssistantAction) {
    if (busy) return;
    setAppliedAction(null);
    if (action.type !== "set_category_budget") return;
    const res = await fetch("/api/household/category-budgets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        updates: [{ categoryId: action.categoryId, monthlyBudget: action.monthlyBudget }],
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(data.error || "Could not apply budget change.");
      return;
    }
    setAppliedAction(`Updated ${action.categoryName} budget to $${action.monthlyBudget.toFixed(2)}/mo.`);
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[120]">
      {open ? (
        <div className="pointer-events-auto flex h-[70vh] w-[min(92vw,420px)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/60">
          {/* Header */}
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                AI Budget Assistant
              </p>
              <div className="flex items-center gap-2">
                {sessionTokens > 0 && (
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500" title="Total tokens used this session">
                    {sessionTokens.toLocaleString()} tokens
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Model selector */}
            <div className="mt-2 flex items-center gap-2">
              <label
                htmlFor="ai-model-select"
                className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400"
              >
                Model:
              </label>
              <select
                id="ai-model-select"
                value={modelId}
                onChange={(e) => void handleModelChange(e.target.value)}
                disabled={modelSaving || busy}
                className="flex-1 rounded-md border border-zinc-300 bg-white py-1 pl-2 pr-6 text-xs text-zinc-800 shadow-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-400/30 disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              >
                {MODEL_GROUPS.map(({ level, label, models }) => (
                  <optgroup key={level} label={`${label} ${"●".repeat(level)}${"○".repeat(5 - level)}`}>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName} ({m.provider === "anthropic" ? "Claude" : "ChatGPT"})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {currentModel && (
                <span className="shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500">
                  {currentModel.provider === "anthropic" ? "🟠" : "🟢"}
                </span>
              )}
              <PricingTooltip />
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {visibleMessages.length === 0 ? (
              <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs text-violet-900 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-100">
                Try: "What are my top spending categories this month?",
                "How should I set budgets?", or "How can I fund a $2,000 project by August?"
              </div>
            ) : (
              visibleMessages.map((m) => (
                <div key={m.id}>
                  <div
                    className={
                      m.role === "user"
                        ? "ml-8 rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "mr-8 whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-100"
                    }
                  >
                    {m.content || (m.role === "assistant" && busy ? "…" : "")}
                  </div>
                  {m.role === "assistant" && m.usage && (
                    <div className="mr-8">
                      <TokenBadge usage={m.usage} />
                    </div>
                  )}
                  {m.role === "assistant" && m.actions?.length ? (
                    <div className="mr-8 mt-2 space-y-1">
                      {m.actions.map((a, i) => (
                        <button
                          key={`${m.id}-a-${i}`}
                          type="button"
                          onClick={() => void applyAction(a)}
                          className="w-full rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-left text-xs text-violet-900 hover:bg-violet-100 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-100 dark:hover:bg-violet-950/60"
                        >
                          Set {a.categoryName} budget to ${a.monthlyBudget.toFixed(2)}/mo
                          {a.reason ? ` — ${a.reason}` : ""}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            )}
            {busy ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Thinking…</p>
            ) : null}
            {error ? (
              <p className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
                {error}
              </p>
            ) : null}
            {appliedAction ? (
              <p className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-100">
                {appliedAction}
              </p>
            ) : null}
          </div>

          {/* Input */}
          <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
            <div className="mb-2 flex flex-wrap gap-1">
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setInput(p)}
                  className="rounded-full border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {p}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder="Ask about spending, budgets, goals..."
                className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
              />
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={!canSend}
                className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-700 dark:hover:bg-violet-600"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pointer-events-auto rounded-full bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-violet-700 dark:bg-violet-700 dark:hover:bg-violet-600"
        >
          Ask AI
        </button>
      )}
    </div>
  );
}
