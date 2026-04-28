"use client";

import { useMemo, useState } from "react";

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
};

const SUGGESTED_PROMPTS = [
  "What are my biggest spending trends this month?",
  "Suggest monthly budgets based on my recent spending.",
  "How can I fund a $2,000 project in 4 months?",
  "Where can I cut spending without hurting essentials?",
];

export function AiAssistantWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedAction, setAppliedAction] = useState<string | null>(null);

  const canSend = input.trim().length > 0 && !busy;
  const visibleMessages = useMemo(
    () => messages.slice(Math.max(0, messages.length - 14)),
    [messages],
  );

  async function sendMessage() {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    setAppliedAction(null);
    const userMsg: ChatMsg = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    const assistantId = crypto.randomUUID();
    const nextMsgs: ChatMsg[] = [
      ...messages,
      userMsg,
      { id: assistantId, role: "assistant", content: "" },
    ];
    setMessages(nextMsgs);
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
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: full } : m,
          ),
        );
      }
      if (!full.trim()) {
        setError("AI response was empty.");
        return;
      }
      const actionRes = await fetch("/api/household/assistant/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, reply: full }),
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
        updates: [
          {
            categoryId: action.categoryId,
            monthlyBudget: action.monthlyBudget,
          },
        ],
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(data.error || "Could not apply budget change.");
      return;
    }
    setAppliedAction(
      `Updated ${action.categoryName} budget to $${action.monthlyBudget.toFixed(2)}/mo.`,
    );
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[120]">
      {open ? (
        <div className="pointer-events-auto flex h-[70vh] w-[min(92vw,420px)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/60">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                AI Budget Assistant
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Ask about trends, budgets, and project funding.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              Close
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {visibleMessages.length === 0 ? (
              <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs text-violet-900 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-100">
                Try: "What are my top spending categories this month?",
                "How should I set budgets?", or "How can I fund a $2,000 project by August?"
              </div>
            ) : (
              visibleMessages.map((m, idx) => (
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

