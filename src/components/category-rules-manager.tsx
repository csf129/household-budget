"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  categoryRuleMatchesNormalized,
  resolveCategoryFromRules,
  type CategoryRuleRow as EngineRuleRow,
} from "@/lib/apply-category-rules";
import { amountMatchesSignFilter } from "@/lib/amount-sign-filter";
import { createClient } from "@/lib/supabase/client";
import {
  ledgerArchiveColumnExists,
  withActiveLedgerOnly,
} from "@/lib/ledger-archive-schema";
import {
  CATEGORY_RULE_CATEGORIES_EMBED,
  mapCategoryRuleRow,
} from "@/lib/map-category-rule";
import {
  formatCategoryLabel,
  sortCategoriesForPicker,
} from "@/lib/category-display";
import { normalizeDescription } from "@/lib/normalize-description";
import type { AmountSignFilter, CategoryRow, CategoryRuleView } from "@/types/finance";

const MATCH_TYPES: {
  value: CategoryRuleView["match_type"];
  label: string;
  hint: string;
}[] = [
  {
    value: "exact_normalized",
    label: "Exact match",
    hint: "Entire normalized description must equal this text (after trim, lowercase, single spaces).",
  },
  {
    value: "contains",
    label: "Contains",
    hint: "Normalized description includes this substring anywhere.",
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
  categories: CategoryRow[];
  initialRules: CategoryRuleView[];
  /** When true, use a section heading and tighter spacing (e.g. Settings → Rules). */
  embedded?: boolean;
};

function rulesForEngine(list: CategoryRuleView[]): EngineRuleRow[] {
  return list.map((r) => ({
    category_id: r.category_id,
    match_type: r.match_type,
    pattern: r.pattern,
    priority: r.priority,
    amount_sign: r.amount_sign,
  }));
}

export function CategoryRulesManager({
  householdId,
  categories,
  initialRules,
  embedded = false,
}: Props) {
  const router = useRouter();
  const [rules, setRules] = useState<CategoryRuleView[]>(initialRules);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [matchType, setMatchType] =
    useState<CategoryRuleView["match_type"]>("contains");
  const [pattern, setPattern] = useState("");
  const [priority, setPriority] = useState("100");
  const [amountSign, setAmountSign] = useState<AmountSignFilter>("any");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyingRuleId, setApplyingRuleId] = useState<string | null>(null);
  const [applyRulesMessage, setApplyRulesMessage] = useState<string | null>(
    null,
  );
  const [bulkOverrideExisting, setBulkOverrideExisting] = useState(false);

  useEffect(() => {
    setRules(initialRules);
  }, [initialRules]);

  const sortedCats = useMemo(
    () => sortCategoriesForPicker(categories),
    [categories],
  );

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
    setCategoryId("");
    setMatchType("contains");
    setPattern("");
    setPriority("100");
    setAmountSign("any");
    setError(null);
  }

  async function applyTransactionUpdates(
    updates: { id: string; category_id: string }[],
    onlyIfUncategorized: boolean,
  ): Promise<boolean> {
    const supabase = createClient();
    const PARALLEL = 25;
    for (let i = 0; i < updates.length; i += PARALLEL) {
      const chunk = updates.slice(i, i + PARALLEL);
      const results = await Promise.all(
        chunk.map((u) => {
          let q = supabase
            .from("transactions")
            .update({ category_id: u.category_id })
            .eq("id", u.id)
            .eq("household_id", householdId);
          if (onlyIfUncategorized) {
            q = q.is("category_id", null);
          }
          return q;
        }),
      );
      for (const r of results) {
        if (r.error) {
          setError(r.error.message);
          return false;
        }
      }
    }
    return true;
  }

  async function runRulesNow() {
    if (rules.length === 0) {
      setApplyRulesMessage("Add at least one rule first.");
      return;
    }
    if (
      bulkOverrideExisting &&
      !window.confirm(
        "Replace categories on rows that already have one whenever a rule matches? The highest-priority matching rule wins.",
      )
    ) {
      return;
    }
    setApplyBusy(true);
    setApplyRulesMessage(null);
    setError(null);
    const supabase = createClient();
    const hasLedgerArchive = await ledgerArchiveColumnExists(supabase);
    const engineRules = rulesForEngine(rules);
    let updatedTotal = 0;
    const PAGE = 500;
    let from = 0;

    try {
      while (true) {
        const to = from + PAGE - 1;
        let query = withActiveLedgerOnly(
          supabase
            .from("transactions")
            .select("id, normalized_description, category_id, amount")
            .eq("household_id", householdId)
            .order("id", { ascending: true })
            .range(from, to),
          hasLedgerArchive,
        );
        if (!bulkOverrideExisting) {
          query = query.is("category_id", null);
        }
        const { data: txs, error: txErr } = await query;

        if (txErr) {
          setError(txErr.message);
          return;
        }
        if (!txs?.length) break;

        const updates: { id: string; category_id: string }[] = [];
        for (const tx of txs) {
          const amt =
            typeof tx.amount === "string"
              ? Number.parseFloat(tx.amount)
              : Number(tx.amount);
          const cid = resolveCategoryFromRules(
            String(tx.normalized_description ?? ""),
            amt,
            engineRules,
          );
          if (!cid) continue;
          if (bulkOverrideExisting && String(tx.category_id ?? "") === cid) {
            continue;
          }
          updates.push({ id: String(tx.id), category_id: cid });
        }

        const ok = await applyTransactionUpdates(
          updates,
          !bulkOverrideExisting,
        );
        if (!ok) return;

        updatedTotal += updates.length;
        if (txs.length < PAGE) break;
        from += PAGE;
      }

      setApplyRulesMessage(
        updatedTotal === 0
          ? bulkOverrideExisting
            ? "No transactions needed a category change from your rules."
            : "No uncategorized transactions matched your rules."
          : `Updated ${updatedTotal} transaction${updatedTotal === 1 ? "" : "s"}.`,
      );
      router.refresh();
    } finally {
      setApplyBusy(false);
    }
  }

  async function runSingleRule(
    rule: CategoryRuleView,
    overrideExisting: boolean,
  ) {
    if (
      overrideExisting &&
      !window.confirm(
        `Replace the category on every transaction that matches “${rule.pattern.slice(0, 80)}${rule.pattern.length > 80 ? "…" : ""}” with ${rule.category_name}?`,
      )
    ) {
      return;
    }
    setApplyingRuleId(rule.id);
    setApplyRulesMessage(null);
    setError(null);
    const supabase = createClient();
    const hasLedgerArchive = await ledgerArchiveColumnExists(supabase);
    const engineSlice: Pick<EngineRuleRow, "match_type" | "pattern"> = {
      match_type: rule.match_type,
      pattern: rule.pattern,
    };
    let updatedTotal = 0;
    const PAGE = 500;
    let from = 0;

    try {
      while (true) {
        const to = from + PAGE - 1;
        let query = withActiveLedgerOnly(
          supabase
            .from("transactions")
            .select("id, normalized_description, category_id, amount")
            .eq("household_id", householdId)
            .order("id", { ascending: true })
            .range(from, to),
          hasLedgerArchive,
        );
        if (!overrideExisting) {
          query = query.is("category_id", null);
        }
        const { data: txs, error: txErr } = await query;

        if (txErr) {
          setError(txErr.message);
          return;
        }
        if (!txs?.length) break;

        const updates: { id: string; category_id: string }[] = [];
        for (const tx of txs) {
          const amt =
            typeof tx.amount === "string"
              ? Number.parseFloat(tx.amount)
              : Number(tx.amount);
          if (!amountMatchesSignFilter(amt, rule.amount_sign)) continue;
          if (
            !categoryRuleMatchesNormalized(
              String(tx.normalized_description ?? ""),
              engineSlice,
            )
          ) {
            continue;
          }
          if (String(tx.category_id ?? "") === rule.category_id) continue;
          updates.push({
            id: String(tx.id),
            category_id: rule.category_id,
          });
        }

        const ok = await applyTransactionUpdates(updates, !overrideExisting);
        if (!ok) return;

        updatedTotal += updates.length;
        if (txs.length < PAGE) break;
        from += PAGE;
      }

      setApplyRulesMessage(
        updatedTotal === 0
          ? overrideExisting
            ? "No matching transactions needed a category change."
            : "No uncategorized transactions matched this rule."
          : `Applied this rule to ${updatedTotal} transaction${updatedTotal === 1 ? "" : "s"}.`,
      );
      router.refresh();
    } finally {
      setApplyingRuleId(null);
    }
  }

  function startEdit(rule: CategoryRuleView) {
    setEditingId(rule.id);
    setCategoryId(rule.category_id);
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
    const cat = categoryId.trim();
    if (!cat) {
      setError("Choose a category.");
      return;
    }
    const normPattern = normalizeDescription(pattern);
    if (!normPattern) {
      setError("Enter a non-empty pattern (text to match).");
      return;
    }
    const pr = Number.parseInt(priority, 10);
    if (!Number.isFinite(pr) || pr < 0 || pr > 99999) {
      setError("Priority must be a number from 0 to 99999.");
      return;
    }

    setBusy(true);
    const supabase = createClient();

    try {
      if (editingId) {
        const { data, error: upErr } = await supabase
          .from("category_rules")
          .update({
            category_id: cat,
            match_type: matchType,
            pattern: normPattern,
            priority: pr,
            amount_sign: amountSign,
          })
          .eq("id", editingId)
          .eq("household_id", householdId)
          .select(
            `
            id,
            category_id,
            match_type,
            pattern,
            priority,
            ${CATEGORY_RULE_CATEGORIES_EMBED}
          `,
          )
          .single();

        if (upErr) {
          setError(upErr.message);
          return;
        }
        if (data) {
          const mapped = mapCategoryRuleRow(data);
          setRules((prev) =>
            prev.map((r) => (r.id === editingId ? mapped : r)),
          );
        }
        resetForm();
      } else {
        const { data, error: insErr } = await supabase
          .from("category_rules")
          .insert({
            household_id: householdId,
            category_id: cat,
            match_type: matchType,
            pattern: normPattern,
            priority: pr,
            amount_sign: amountSign,
          })
          .select(
            `
            id,
            category_id,
            match_type,
            pattern,
            priority,
            amount_sign,
            ${CATEGORY_RULE_CATEGORIES_EMBED}
          `,
          )
          .single();

        if (insErr) {
          setError(insErr.message);
          return;
        }
        if (data) {
          setRules((prev) => [mapCategoryRuleRow(data), ...prev]);
        }
        resetForm();
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this rule? Future imports and new transactions will no longer use it.")) {
      return;
    }
    setError(null);
    setBusy(true);
    const supabase = createClient();
    const { error: delErr } = await supabase
      .from("category_rules")
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
          <h2 id="category-rules" className={titleClass}>
            Category rules
          </h2>
        ) : (
          <h1 className={titleClass}>Category rules</h1>
        )}
        <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          When you add a transaction or import a CSV, the app normalizes the
          description (trim, lowercase, collapse spaces) and picks the{" "}
          <span className="font-medium">highest priority</span> rule that
          matches the text and (optionally) the amount sign. Use{" "}
          <span className="font-medium">Uncategorized</span> or{" "}
          <span className="font-medium">Override all</span> on a row to run just
          that rule; override replaces categories on every matching transaction.
        </p>
        <p className="mt-2 text-sm">
          <Link
            href="/settings/categories"
            className="font-medium text-violet-700 hover:text-violet-900 dark:text-violet-400 dark:hover:text-violet-300"
          >
            Categories
          </Link>{" "}
          — add or rename the labels rules can assign.
        </p>
      </div>

      <section className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-3">
            <p className="text-sm text-emerald-950">
              <span className="font-medium">Run all rules now</span> — walk
              transactions and assign the{" "}
              <span className="font-medium">highest-priority</span> rule that
              matches each description (same logic as imports).
            </p>
            <label className="flex cursor-pointer items-start gap-2 text-sm text-emerald-950">
              <input
                type="checkbox"
                checked={bulkOverrideExisting}
                onChange={(e) => setBulkOverrideExisting(e.target.checked)}
                disabled={applyBusy || applyingRuleId !== null || busy}
                className="mt-1 rounded border-emerald-400"
              />
              <span>
                <span className="font-medium">Override existing categories</span>{" "}
                when a rule matches (still skips rows where the winning rule
                already matches the current category).
              </span>
            </label>
          </div>
          <button
            type="button"
            onClick={() => void runRulesNow()}
            disabled={
              applyBusy ||
              applyingRuleId !== null ||
              busy ||
              rules.length === 0
            }
            className="shrink-0 rounded-lg border border-emerald-600 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {applyBusy ? "Running…" : "Run all rules now"}
          </button>
        </div>
        {rules.length === 0 ? (
          <p className="mt-2 text-xs text-emerald-900/80">
            Add at least one rule below to enable this button.
          </p>
        ) : null}
        {applyRulesMessage ? (
          <p className="mt-3 text-sm text-emerald-900" role="status">
            {applyRulesMessage}
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
            className="mt-2 text-xs font-medium text-violet-700 hover:text-violet-900"
          >
            Cancel edit — add new instead
          </button>
        ) : null}

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-4">
          {error ? (
            <p className="text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label
                htmlFor="rule-cat"
                className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
              >
                Category
              </label>
              <select
                id="rule-cat"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
              >
                <option value="">Select category…</option>
                {sortedCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {formatCategoryLabel(c, categories)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="rule-match"
                className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
              >
                Match type
              </label>
              <select
                id="rule-match"
                value={matchType}
                onChange={(e) =>
                  setMatchType(e.target.value as CategoryRuleView["match_type"])
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
                htmlFor="rule-priority"
                className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
              >
                Priority
              </label>
              <input
                id="rule-priority"
                type="number"
                min={0}
                max={99999}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
              />
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Higher numbers win when several rules match (e.g. 200 beats
                100).
              </p>
            </div>

            <div>
              <label
                htmlFor="rule-amount-sign"
                className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
              >
                Amount sign
              </label>
              <select
                id="rule-amount-sign"
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
                Limit this rule to credits, debits, or both.
              </p>
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="rule-pattern"
                className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
              >
                Pattern
              </label>
              <input
                id="rule-pattern"
                type="text"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="e.g. whole foods, amazon, payment thank"
                maxLength={500}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
              />
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Stored normalized automatically. Matching uses the same
                normalization as transaction descriptions.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              {busy ? "Saving…" : editingId ? "Update rule" : "Add rule"}
            </button>
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <div className="border-b border-zinc-100 px-6 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Your rules ({rules.length})
          </h2>
        </div>
        {sortedRules.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No rules yet. Add one above, or save a transaction with “Remember
            category for future.”
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead className="border-b border-zinc-100 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/70 dark:text-zinc-400">
                <tr>
                  <th className="px-6 py-3">Priority</th>
                  <th className="px-6 py-3">Match</th>
                  <th className="px-6 py-3">Amount</th>
                  <th className="px-6 py-3">Pattern</th>
                  <th className="px-6 py-3">Category</th>
                  <th className="px-6 py-3">Apply</th>
                  <th className="px-6 py-3 text-right"> </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {sortedRules.map((r) => (
                  <tr key={r.id} className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/50">
                    <td className="whitespace-nowrap px-6 py-3 tabular-nums text-zinc-700 dark:text-zinc-300">
                      {r.priority}
                    </td>
                    <td className="px-6 py-3 text-zinc-700 dark:text-zinc-300">
                      {
                        MATCH_TYPES.find((m) => m.value === r.match_type)
                          ?.label
                      }
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 text-zinc-600 dark:text-zinc-400">
                      {amountSignShortLabel(r.amount_sign)}
                    </td>
                    <td className="max-w-xs px-6 py-3 font-mono text-xs text-zinc-900 dark:text-zinc-100">
                      {r.pattern}
                    </td>
                    <td className="px-6 py-3">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10"
                          style={{
                            backgroundColor: r.category_color || "#94a3b8",
                          }}
                          aria-hidden
                        />
                        <span className="text-zinc-800 dark:text-zinc-200">{r.category_name}</span>
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      {applyingRuleId === r.id ? (
                        <span className="text-xs font-medium text-zinc-600">
                          Running…
                        </span>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          <button
                            type="button"
                            title="Only rows with no category yet"
                            onClick={() => void runSingleRule(r, false)}
                            disabled={
                              busy ||
                              applyBusy ||
                              applyingRuleId !== null
                            }
                            className="whitespace-nowrap rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-left text-xs font-semibold text-emerald-900 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100 dark:hover:bg-emerald-950/60"
                          >
                            Uncategorized
                          </button>
                          <button
                            type="button"
                            title="Set this rule’s category on every matching row"
                            onClick={() => void runSingleRule(r, true)}
                            disabled={
                              busy ||
                              applyBusy ||
                              applyingRuleId !== null
                            }
                            className="whitespace-nowrap rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-left text-xs font-semibold text-amber-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/60"
                          >
                            Override all
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 text-right text-xs">
                      <button
                        type="button"
                        onClick={() => startEdit(r)}
                        disabled={busy || applyingRuleId !== null}
                        className="font-medium text-violet-700 hover:text-violet-900 disabled:opacity-40 dark:text-violet-400 dark:hover:text-violet-200"
                      >
                        Edit
                      </button>
                      <span className="mx-2 text-zinc-300 dark:text-zinc-600">|</span>
                      <button
                        type="button"
                        onClick={() => void handleDelete(r.id)}
                        disabled={busy || applyingRuleId !== null}
                        className="font-medium text-red-600 hover:text-red-800 disabled:opacity-40 dark:text-red-400 dark:hover:text-red-300"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
