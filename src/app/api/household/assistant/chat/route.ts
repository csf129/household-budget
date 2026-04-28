import { NextResponse } from "next/server";
import { getHouseholdForUser } from "@/lib/household";
import {
  ledgerArchiveColumnExists,
  withActiveLedgerOnly,
} from "@/lib/ledger-archive-schema";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

type ChatMsg = { role?: unknown; content?: unknown };

function asMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

async function buildPromptMessages(messages: Array<{ role: "user" | "assistant"; content: string }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized.", status: 401 as const };
  const household = await getHouseholdForUser(supabase, user.id);
  if (!household) return { error: "No household.", status: 403 as const };

  const today = new Date();
  const day90 = new Date(today);
  day90.setDate(day90.getDate() - 90);
  const day365 = new Date(today);
  day365.setDate(day365.getDate() - 365);
  const from90 = day90.toISOString().slice(0, 10);
  const from365 = day365.toISOString().slice(0, 10);

  const hasLedgerArchive = await ledgerArchiveColumnExists(supabase);

  const [tx90Res, tx365Res, catRes, acctRes, plansRes, contribRes] =
    await Promise.all([
      withActiveLedgerOnly(
        supabase
          .from("transactions")
          .select(
            "id, amount, occurred_on, raw_description, normalized_description, category_id, account_id, categories(name)",
          )
          .eq("household_id", household.householdId)
          .gte("occurred_on", from90),
        hasLedgerArchive,
      ),
      withActiveLedgerOnly(
        supabase
          .from("transactions")
          .select("id, amount, occurred_on, category_id, categories(name)")
          .eq("household_id", household.householdId)
          .gte("occurred_on", from365),
        hasLedgerArchive,
      ),
      supabase
        .from("categories")
        .select("id, name, monthly_budget")
        .eq("household_id", household.householdId),
      supabase
        .from("bank_accounts")
        .select("id, name, display_name, mask, current_balance, subtype, type")
        .eq("household_id", household.householdId),
      supabase
        .from("savings_plans")
        .select("id, title, plan_kind, target_amount, target_date, is_archived")
        .eq("household_id", household.householdId)
        .eq("is_archived", false),
      supabase
        .from("savings_plan_contributions")
        .select("savings_plan_id, amount")
        .eq("household_id", household.householdId),
    ]);
  const err =
    tx90Res.error ||
    tx365Res.error ||
    catRes.error ||
    acctRes.error ||
    plansRes.error ||
    contribRes.error;
  if (err) return { error: err.message, status: 500 as const };

  const tx90 = tx90Res.data ?? [];
  const tx365 = tx365Res.data ?? [];
  const categories = catRes.data ?? [];
  const accounts = acctRes.data ?? [];
  const plans = plansRes.data ?? [];
  const contributions = contribRes.data ?? [];

  let spend90 = 0;
  let income90 = 0;
  const byCategory = new Map<string, number>();
  const byMonth = new Map<string, { spend: number; income: number }>();
  for (const t of tx90) {
    const amt = typeof t.amount === "string" ? Number.parseFloat(t.amount) : Number(t.amount);
    if (!Number.isFinite(amt)) continue;
    const month = monthKey(String(t.occurred_on ?? "").slice(0, 10));
    const entry = byMonth.get(month) ?? { spend: 0, income: 0 };
    if (amt < 0) {
      const out = Math.abs(amt);
      spend90 += out;
      entry.spend += out;
      const catName =
        t.categories && typeof t.categories === "object" && !Array.isArray(t.categories)
          ? String((t.categories as { name?: unknown }).name ?? "Uncategorized")
          : "Uncategorized";
      byCategory.set(catName, (byCategory.get(catName) ?? 0) + out);
    } else if (amt > 0) {
      income90 += amt;
      entry.income += amt;
    }
    byMonth.set(month, entry);
  }
  const topCats = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, value]) => `${name}: ${asMoney(value)}`);
  const monthLines = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([m, v]) => `${m}: spend ${asMoney(v.spend)}, income ${asMoney(v.income)}`);
  const budgetLines = categories.map((c) => {
    const b =
      c.monthly_budget == null || c.monthly_budget === ""
        ? null
        : Number(c.monthly_budget);
    return `${c.name}: ${b == null || !Number.isFinite(b) ? "no budget" : `${asMoney(b)}/mo`}`;
  });
  const planContrib = new Map<string, number>();
  for (const c of contributions) {
    const key = String(c.savings_plan_id ?? "");
    const amt = typeof c.amount === "string" ? Number.parseFloat(c.amount) : Number(c.amount);
    if (!key || !Number.isFinite(amt)) continue;
    planContrib.set(key, (planContrib.get(key) ?? 0) + amt);
  }
  const planLines = plans.map((p) => {
    const target =
      typeof p.target_amount === "string" ? Number.parseFloat(p.target_amount) : Number(p.target_amount);
    const saved = planContrib.get(String(p.id)) ?? 0;
    const remain = Math.max(0, target - saved);
    return `${p.title}: target ${asMoney(target)}, remaining ${asMoney(remain)}, by ${p.target_date}`;
  });
  const accountLines = accounts.map((a) => {
    const bal =
      a.current_balance == null || a.current_balance === ""
        ? null
        : Number(a.current_balance);
    const label =
      a.display_name && String(a.display_name).trim() !== ""
        ? String(a.display_name)
        : String(a.name ?? "");
    return `${label}${a.mask ? ` ·•••${a.mask}` : ""}: ${
      bal == null || !Number.isFinite(bal) ? "n/a" : asMoney(bal)
    }`;
  });
  const context = [
    `Household: ${household.name}`,
    `Spend last 90d: ${asMoney(spend90)}; income last 90d: ${asMoney(income90)}.`,
    "Top categories:",
    ...(topCats.length ? topCats.map((x) => `- ${x}`) : ["- none"]),
    "Monthly trend:",
    ...(monthLines.length ? monthLines.map((x) => `- ${x}`) : ["- none"]),
    "Category budgets:",
    ...(budgetLines.length ? budgetLines.map((x) => `- ${x}`) : ["- none"]),
    "Bank balances:",
    ...(accountLines.length ? accountLines.map((x) => `- ${x}`) : ["- none"]),
    "Active plans:",
    ...(planLines.length ? planLines.map((x) => `- ${x}`) : ["- none"]),
    `Sample sizes: tx90=${tx90.length}, tx365=${tx365.length}`,
  ].join("\n");

  const promptMessages = [
    {
      role: "system",
      content:
        "You are an in-app household budget copilot. Be concise, practical, and numeric. Give step-by-step recommendations. Mention navigation targets when helpful.",
    },
    {
      role: "system",
      content:
        "Navigation: Overview for trends, Transactions for details/filters, Plans for goals, Settings > Budget for category budgets, Settings > Bank for sync.",
    },
    { role: "system", content: `Household context:\n${context}` },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  return { promptMessages };
}

async function fetchOpenAIStream(apiKey: string, promptMessages: unknown[]) {
  return fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      stream: true,
      messages: promptMessages,
    }),
  });
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI assistant requires OPENAI_API_KEY in .env.local.", code: "NO_AI_KEY" },
      { status: 503 },
    );
  }

  let body: { messages?: ChatMsg[] } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const streamMode = new URL(request.url).searchParams.get("stream") === "1";
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const messages: Array<{ role: "user" | "assistant"; content: string }> = rawMessages
    .map((m) => ({
      role: (m.role === "assistant" ? "assistant" : "user") as
        | "user"
        | "assistant",
      content: typeof m.content === "string" ? m.content.trim() : "",
    }))
    .filter((m) => m.content.length > 0)
    .slice(-12);
  if (messages.length === 0) {
    return NextResponse.json({ error: "Please include at least one user message." }, { status: 400 });
  }

  const promptResult = await buildPromptMessages(messages);
  if ("error" in promptResult) {
    return NextResponse.json({ error: promptResult.error }, { status: promptResult.status });
  }

  if (!streamMode) {
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: promptResult.promptMessages,
      }),
    });
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      return NextResponse.json({ error: `OpenAI failed (${aiRes.status}): ${txt.slice(0, 200)}` }, { status: 502 });
    }
    const data = (await aiRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const reply = data.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      return NextResponse.json({ error: "AI returned an empty response." }, { status: 502 });
    }
    return NextResponse.json({ reply });
  }

  const aiRes = await fetchOpenAIStream(apiKey, promptResult.promptMessages);
  if (!aiRes.ok || !aiRes.body) {
    const txt = await aiRes.text();
    return NextResponse.json({ error: `OpenAI stream failed (${aiRes.status}): ${txt.slice(0, 200)}` }, { status: 502 });
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = aiRes.body!.getReader();
      let buffer = "";
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
              };
              const chunk = obj.choices?.[0]?.delta?.content ?? "";
              if (chunk) controller.enqueue(encoder.encode(chunk));
            } catch {
              // ignore malformed chunk lines
            }
          }
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(out, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

