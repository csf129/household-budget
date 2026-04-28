"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  resolveIncomeTreatmentFromRules,
  type IncomeRuleRow as EngineIncomeRuleRow,
} from "@/lib/apply-income-rules";
import { requestClassifyIncome } from "@/lib/auto-classify-income-client";
import { TransactionEditModal } from "@/components/transaction-edit-modal";
import { createClient } from "@/lib/supabase/client";
import {
  ledgerArchiveColumnExists,
  withActiveLedgerOnly,
} from "@/lib/ledger-archive-schema";
import { listOverviewIncomeTransactions } from "@/lib/dashboard-overview-bucket-transactions";
import { mapIncomeRuleRow } from "@/lib/map-income-rule";
import { normalizeDescription } from "@/lib/normalize-description";
import { formatUsd } from "@/lib/money";
import type {
  AmountSignFilter,
  CategoryRow,
  IncomeRuleView,
  TransactionRow,
} from "@/types/finance";

const MATCH_TYPES: {
  value: IncomeRuleView["match_type"];
  label: string;
  hint: string;
}[] = [
  {
    value: "exact_normalized",
    label: "Exact match",
    hint: "Entire normalized description must equal this text.",
  },
  {
    value: "contains",
    label: "Contains",
    hint: "Normalized description includes this substring.",
  },
  {
    value: "prefix",
    label: "Starts with",
    hint: "Normalized description begins with this text.",
  },
];

const AMOUNT_SIGN_OPTIONS: { value: AmountSignFilter; label: string }[] = [
  { value: "any", label: "Any (credits or debits)" },
  { value: "positive", label: "Positive amounts only" },
  { value: "negative", label: "Negative amounts only" },
];

function amountSignShortLabel(v: AmountSignFilter): string {
  if (v === "positive") return "Positive";
  if (v === "negative") return "Negative";
  return "Any";
}

type Props = {
  householdId: string;
  initialRules: IncomeRuleView[];
  categories: CategoryRow[];
  initialTransactions: TransactionRow[];
  embedded?: boolean;
  ledgerArchiveColumnAvailable?: boolean;
};

function rulesForEngine(list: IncomeRuleView[]): EngineIncomeRuleRow[] {
  return list.map((r) => ({
    match_type: r.match_type,
    pattern: r.pattern,
    priority: r.priority,
    treatment: r.treatment,
    amount_sign: r.amount_sign,
  }));
}

export function IncomeRulesManager({
  householdId,
  initialRules,
  categories,
  initialTransactions,
  embedded = false,
  ledgerArchiveColumnAvailable,
}: Props) {
  const router = useRouter();
  const [mainTab, setMainTab] = useState<"income" | "rules">("income");
  const [transactions, setTransactions] = useState<TransactionRow[]>(
    initialTransactions,
  );
  const [editingTx, setEditingTx] = useState<TransactionRow | null>(null);
  const [rules, setRules] = useState<IncomeRuleView[]>(initialRules);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [treatment, setTreatment] =
    useState<IncomeRuleView["treatment"]>("exclude");
  const [matchType, setMatchType] =
    useState<IncomeRuleView["match_type"]>("contains");
  const [pattern, setPattern] = useState("");
  const [priority, setPriority] = useState("100");
  const [amountSign, setAmountSign] = useState<AmountSignFilter>("any");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyingRules, setApplyingRules] = useState(false);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);

  useEffect(() => {
    setRules(initialRules);
  }, [initialRules]);

  useEffect(() => {
    setTransactions(initialTransactions);
  }, [initialTransactions]);

  const engineRules = useMemo(() => rulesForEngine(rules), [rules]);

  const incomeLedgerRows = useMemo(
    () => listOverviewIncomeTransactions(transactions, engineRules),
    [transactions, engineRules],
  );

  const incomeLedgerTotal = useMemo(
    () => incomeLedgerRows.reduce((s, t) => s + t.amount, 0),
    [incomeLedgerRows],
  );

  const editMatchCount = useMemo(() => {
    if (!editingTx) return 0;
    return transactions.filter(
      (t) => t.normalized_description === editingTx.normalized_description,
    ).length;
  }, [editingTx, transactions]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && editingTx) setEditingTx(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingTx]);

  const sortedRules = useMemo(
    () =>
      [...rules].sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.pattern.localeCompare(b.pattern);
      }),
    [rules],
  );

  function resetForm() {
    setEditingId(null);
    setTreatment("exclude");
    setMatchType("contains");
    setPattern("");
    setPriority("100");
    setAmountSign("any");
    setError(null);
  }

  async function runIncomeRulesNow() {
    if (rules.length === 0) {
      setApplyMessage("Add at least one rule first.");
      return;
    }
    setApplyingRules(true);
    setApplyMessage(null);
    setError(null);
    const supabase = createClient();
    const hasLedgerArchive = await ledgerArchiveColumnExists(supabase);
    const engineRules = rulesForEngine(rules);
    let updatedTotal = 0;
    const PAGE = 500;
    const PARALLEL = 25;
    let from = 0;

    try {
      while (true) {
        const to = from + PAGE - 1;
        const { data: txs, error: txErr } = await withActiveLedgerOnly(
          supabase
            .from("transactions")
            .select("id, normalized_description, income_treatment, amount")
            .eq("household_id", householdId)
            .is("income_treatment", null)
            .order("id", { ascending: true })
            .range(from, to),
          hasLedgerArchive,
        );

        if (txErr) {
          setError(txErr.message);
          return;
        }
        if (!txs?.length) break;

        const updates: { id: string; income_treatment: string }[] = [];
        for (const tx of txs) {
          const amt =
            typeof tx.amount === "string"
              ? Number.parseFloat(tx.amount)
              : Number(tx.amount);
          const tr = resolveIncomeTreatmentFromRules(
            String(tx.normalized_description ?? ""),
            amt,
            engineRules,
          );
          if (tr) {
            updates.push({ id: String(tx.id), income_treatment: tr });
          }
        }

        for (let i = 0; i < updates.length; i += PARALLEL) {
          const chunk = updates.slice(i, i + PARALLEL);
          const results = await Promise.all(
            chunk.map((u) =>
              supabase
                .from("transactions")
                .update({ income_treatment: u.income_treatment })
                .eq("id", u.id)
                .eq("household_id", householdId)
                .is("income_treatment", null),
            ),
          );
          for (const r of results) {
            if (r.error) {
              setError(r.error.message);
              return;
            }
          }
        }

        updatedTotal += updates.length;
        if (txs.length < PAGE) break;
        from += PAGE;
      }

      setApplyMessage(
        updatedTotal === 0
          ? "No transactions without an override matched your income rules."
          : `Tagged ${updatedTotal} transaction${updatedTotal === 1 ? "" : "s"} (overview income).`,
      );
      router.refresh();
    } finally {
      setApplyingRules(false);
    }
  }

  async function runAiClassify() {
    setAiMessage(null);
    setAiBusy(true);
    const r = await requestClassifyIncome();
    setAiBusy(false);
    if (!r.ok) {
      if (r.code === "NO_AI_KEY") {
        setAiMessage(
          "Add OPENAI_API_KEY to .env.local to enable AI income tagging.",
        );
      } else {
        setAiMessage(r.error);
      }
      return;
    }
    setAiMessage(r.message ?? `Updated ${r.updated} transaction(s).`);
    router.refresh();
  }

  function startEdit(rule: IncomeRuleView) {
    setEditingId(rule.id);
    setTreatment(rule.treatment);
    setMatchType(rule.match_type);
    setPattern(rule.pattern);
    setPriority(String(rule.priority));
    setAmountSign(rule.amount_sign);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const normPattern = normalizeDescription(pattern);
    if (!normPattern) {
      setError("Enter a non-empty pattern.");
      return;
    }
    const pr = Number.parseInt(priority, 10);
    if (!Number.isFinite(pr) || pr < 0 || pr > 99999) {
      setError("Priority must be 0–99999.");
      return;
    }

    setBusy(true);
    const supabase = createClient();

    try {
      if (editingId) {
        const { data, error: upErr } = await supabase
          .from("income_classification_rules")
          .update({
            treatment,
            match_type: matchType,
            pattern: normPattern,
            priority: pr,
            amount_sign: amountSign,
          })
          .eq("id", editingId)
          .eq("household_id", householdId)
          .select("id, match_type, pattern, priority, treatment, amount_sign")
          .single();

        if (upErr) {
          setError(upErr.message);
          return;
        }
        if (data) {
          const row = mapIncomeRuleRow(data);
          setRules((prev) =>
            prev.map((r) => (r.id === editingId ? row : r)),
          );
        }
        resetForm();
      } else {
        const { data, error: insErr } = await supabase
          .from("income_classification_rules")
          .insert({
            household_id: householdId,
            treatment,
            match_type: matchType,
            pattern: normPattern,
            priority: pr,
            amount_sign: amountSign,
          })
          .select("id, match_type, pattern, priority, treatment, amount_sign")
          .single();

        if (insErr) {
          setError(insErr.message);
          return;
        }
        if (data) {
          setRules((prev) => [mapIncomeRuleRow(data), ...prev]);
        }
        resetForm();
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (
      !window.confirm(
        "Delete this rule? Existing transaction tags are not removed automatically.",
      )
    ) {
      return;
    }
    setError(null);
    setBusy(true);
    const supabase = createClient();
    const { error: delErr } = await supabase
      .from("income_classification_rules")
      .delete()
      .eq("id", id)
      .eq("household_id", householdId);
    setBusy(false);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    setRules((prev) => prev.filter((r) => r.id !== id));
    if (editingId === id) resetForm();
    router.refresh();
  }

  const matchHint =
    MATCH_TYPES.find((m) => m.value === matchType)?.hint ?? "";

  const titleClass = embedded
    ? "text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
    : "text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100";

  return (
    <div className={embedded ? "space-y-6" : "space-y-8"}>
      <div>
        {embedded ? (
          <h2 id="income-rules" className={titleClass}>
            Income
          </h2>
        ) : (
          <h1 className={titleClass}>Income</h1>
        )}
        <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          See every credit that counts toward <span className="font-medium">Overview</span>{" "}
          income on the <span className="font-medium">Income</span> tab.           On{" "}
          <span className="font-medium">Rules</span>, control matches with
          normalized descriptions and optional amount sign (highest priority
          wins). Per-row overrides on a transaction beat rules.
        </p>
        <p className="mt-2 text-sm">
          <Link
            href="/transactions"
            className="font-medium text-violet-700 hover:text-violet-900 dark:text-violet-400 dark:hover:text-violet-300"
          >
            Transactions
          </Link>{" "}
          — edit a single credit to set &quot;Overview income&quot; or run AI
          there.
        </p>
      </div>

      <div
        className="flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-zinc-100/80 p-1 dark:border-zinc-700 dark:bg-zinc-900/90"
        role="tablist"
        aria-label="Income page sections"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === "income"}
          onClick={() => setMainTab("income")}
          className={
            mainTab === "income"
              ? "rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100 dark:shadow-black/20"
              : "rounded-md px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          }
        >
          Income
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === "rules"}
          onClick={() => setMainTab("rules")}
          className={
            mainTab === "rules"
              ? "rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100 dark:shadow-black/20"
              : "rounded-md px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          }
        >
          Rules
        </button>
      </div>

      {mainTab === "income" ? (
        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Credits in Overview income
          </h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Same rows as the green <span className="font-medium">Income</span>{" "}
            bars on the dashboard: primary category{" "}
            <span className="font-medium">Income</span>, or uncategorized
            credits that pass your rules and overrides. Transfers and similar
            are excluded.
          </p>
          <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
            <span className="font-medium tabular-nums">{formatUsd(incomeLedgerTotal)}</span>
            <span className="text-zinc-500 dark:text-zinc-400"> total across </span>
            <span className="font-medium tabular-nums">{incomeLedgerRows.length}</span>
            <span className="text-zinc-500 dark:text-zinc-400">
              {" "}
              transaction{incomeLedgerRows.length === 1 ? "" : "s"}
            </span>
          </p>
          <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700 dark:bg-zinc-950/30">
            <div className="max-h-[min(560px,70vh)] overflow-y-auto">
              {incomeLedgerRows.length === 0 ? (
                <p className="px-4 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  No credits currently count as Overview income. Assign the{" "}
                  <span className="font-medium">Income</span> primary on
                  Categories, adjust rules on the Rules tab, or tag credits on
                  Transactions.
                </p>
              ) : (
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-400">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Description</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="w-10 px-2 py-3" aria-hidden />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {incomeLedgerRows.map((t) => {
                      const cat = t.categories;
                      return (
                        <tr
                          key={t.id}
                          tabIndex={0}
                          role="button"
                          aria-label={`Edit transaction ${t.raw_description.slice(0, 40)}`}
                          className="cursor-pointer hover:bg-zinc-50/80 focus-visible:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-400 dark:hover:bg-zinc-800/60 dark:focus-visible:bg-zinc-800 dark:focus-visible:outline-zinc-500"
                          onClick={() => setEditingTx(t)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setEditingTx(t);
                            }
                          }}
                        >
                          <td className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-600 dark:text-zinc-400">
                            {t.occurred_on}
                          </td>
                          <td className="max-w-[240px] px-4 py-3">
                            <span className="font-medium text-zinc-900 dark:text-zinc-100">
                              {t.raw_description}
                            </span>
                            {t.notes ? (
                              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                                {t.notes}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-4 py-3">
                            {cat ? (
                              <span className="inline-flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full ring-1 ring-black/10"
                                  style={{
                                    backgroundColor: cat.color || "#94a3b8",
                                  }}
                                  aria-hidden
                                />
                                {cat.name}
                              </span>
                            ) : (
                              <span className="text-zinc-400 dark:text-zinc-500">—</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                            {formatUsd(t.amount)}
                          </td>
                          <td className="px-2 py-3 text-zinc-400 dark:text-zinc-500">›</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          {incomeLedgerRows.length > 0 ? (
            <p className="mt-3 text-center text-xs text-zinc-500 dark:text-zinc-400">
              Click a row to edit category or Overview income override.
            </p>
          ) : null}
        </section>
      ) : null}

      {mainTab === "rules" ? (
        <>
      <section className="rounded-xl border border-sky-200 bg-sky-50/80 p-5 shadow-sm dark:border-sky-900/50 dark:bg-sky-950/40">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-sky-950 dark:text-sky-100">
            <span className="font-medium">AI classify income</span> — for credits
            without an override, ask the model to tag real income vs refunds and
            similar (stores include/exclude on each row).
          </p>
          <button
            type="button"
            onClick={() => void runAiClassify()}
            disabled={aiBusy || busy}
            className="shrink-0 rounded-lg border border-sky-600 bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {aiBusy ? "Running…" : "Run AI on credits"}
          </button>
        </div>
        {aiMessage ? (
          <p className="mt-3 text-sm text-sky-900 dark:text-sky-200" role="status">
            {aiMessage}
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-5 shadow-sm dark:border-emerald-900/50 dark:bg-emerald-950/40">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-emerald-950 dark:text-emerald-100">
            <span className="font-medium">Apply rules to transactions</span> — set
            include/exclude on rows that don&apos;t already have a manual or AI
            override. Each rule can target positive amounts, negative amounts, or
            both.
          </p>
          <button
            type="button"
            onClick={() => void runIncomeRulesNow()}
            disabled={applyingRules || busy || rules.length === 0}
            className="shrink-0 rounded-lg border border-emerald-600 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {applyingRules ? "Running…" : "Apply rules now"}
          </button>
        </div>
        {rules.length === 0 ? (
          <p className="mt-2 text-xs text-emerald-900/80">
            Add at least one rule below to enable this button.
          </p>
        ) : null}
        {applyMessage ? (
          <p className="mt-3 text-sm text-emerald-900" role="status">
            {applyMessage}
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {editingId ? "Edit rule" : "Add rule"}
        </h2>
        {editingId ? (
          <button
            type="button"
            onClick={resetForm}
            className="mt-2 text-xs font-medium text-violet-700 hover:text-violet-900 dark:text-violet-400 dark:hover:text-violet-200"
          >
            Cancel edit — add new instead
          </button>
        ) : null}

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-4">
          {error ? (
            <p className="text-sm text-red-700 dark:text-red-400" role="alert">
              {error}
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="income-treatment"
                className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
              >
                Overview income
              </label>
              <select
                id="income-treatment"
                value={treatment}
                onChange={(e) =>
                  setTreatment(e.target.value as IncomeRuleView["treatment"])
                }
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
              >
                <option value="include">Count as income</option>
                <option value="exclude">Do not count as income</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="income-priority"
                className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
              >
                Priority (higher runs first)
              </label>
              <input
                id="income-priority"
                type="number"
                min={0}
                max={99999}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
              />
            </div>
            <div className="sm:col-span-2">
              <label
                htmlFor="income-match"
                className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
              >
                Match type
              </label>
              <select
                id="income-match"
                value={matchType}
                onChange={(e) =>
                  setMatchType(e.target.value as IncomeRuleView["match_type"])
                }
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
              >
                {MATCH_TYPES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{matchHint}</p>
            </div>
            <div>
              <label
                htmlFor="income-amount-sign"
                className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
              >
                Amount sign
              </label>
              <select
                id="income-amount-sign"
                value={amountSign}
                onChange={(e) =>
                  setAmountSign(e.target.value as AmountSignFilter)
                }
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
              >
                {AMOUNT_SIGN_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Usually credits only; use negative if you tag debits.
              </p>
            </div>
            <div className="sm:col-span-2">
              <label
                htmlFor="income-pattern"
                className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
              >
                Pattern (normalized)
              </label>
              <input
                id="income-pattern"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="e.g. payroll, cash back, zelle from"
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {busy ? "Saving…" : editingId ? "Save changes" : "Add rule"}
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Your rules</h2>
        {sortedRules.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">No rules yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
            {sortedRules.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-2 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    <span
                      className={
                        r.treatment === "include"
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-amber-800 dark:text-amber-200"
                      }
                    >
                      {r.treatment === "include" ? "Count" : "Exclude"}
                    </span>
                    <span className="text-zinc-400 dark:text-zinc-600"> · </span>
                    <span className="font-mono text-xs text-zinc-600 dark:text-zinc-400">
                      {r.match_type}
                    </span>
                    <span className="text-zinc-400 dark:text-zinc-600"> · </span>
                    priority {r.priority}
                    <span className="text-zinc-400 dark:text-zinc-600"> · </span>
                    {amountSignShortLabel(r.amount_sign)}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-xs text-zinc-700 dark:text-zinc-300">
                    {r.pattern}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => startEdit(r)}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(r.id)}
                    disabled={busy}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/40"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
        </>
      ) : null}

      {editingTx ? (
        <TransactionEditModal
          transaction={editingTx}
          householdId={householdId}
          categories={categories}
          matchCount={editMatchCount}
          ledgerArchiveColumnAvailable={ledgerArchiveColumnAvailable}
          onClose={() => setEditingTx(null)}
          onSaved={() => {
            setEditingTx(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
