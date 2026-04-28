"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ExtractedBudgetLineJson } from "@/lib/parse-budget-spreadsheet";
import type { BudgetRecurringInterval, CategoryRow } from "@/types/finance";
import { formatUsd } from "@/lib/money";

type ReferenceMeta = {
  sourceFilename: string | null;
  lineCount: number;
  lastAiSummary: string | null;
};

type Props = {
  initialCategories: CategoryRow[];
  initialReference: ReferenceMeta | null;
};

function parseUsdInput(raw: string): number | null {
  const s = raw.trim().replace(/[$,]/g, "");
  if (s === "") return null;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function formatInput(n: number | null): string {
  if (n === null || n === undefined) return "";
  return n === 0 ? "0" : String(n);
}

type SeasonDraft = {
  limit: boolean;
  repeatsAnnually: boolean;
  fm: number | null;
  fd: number | null;
  tm: number | null;
  td: number | null;
  periodStart: string;
  periodEnd: string;
};

const MONTH_OPTIONS = [
  { v: 1, label: "Jan" },
  { v: 2, label: "Feb" },
  { v: 3, label: "Mar" },
  { v: 4, label: "Apr" },
  { v: 5, label: "May" },
  { v: 6, label: "Jun" },
  { v: 7, label: "Jul" },
  { v: 8, label: "Aug" },
  { v: 9, label: "Sep" },
  { v: 10, label: "Oct" },
  { v: 11, label: "Nov" },
  { v: 12, label: "Dec" },
];

function seasonDraftFromCategory(c: CategoryRow): SeasonDraft {
  const hasMd =
    c.budget_active_from_month != null &&
    c.budget_active_from_day != null &&
    c.budget_active_to_month != null &&
    c.budget_active_to_day != null;
  const hasPeriod =
    c.budget_repeats_annually === false &&
    Boolean(c.budget_period_start?.trim()) &&
    Boolean(c.budget_period_end?.trim());
  const limit = hasMd || hasPeriod;
  return {
    limit,
    repeatsAnnually: c.budget_repeats_annually !== false,
    fm: c.budget_active_from_month ?? null,
    fd: c.budget_active_from_day ?? null,
    tm: c.budget_active_to_month ?? null,
    td: c.budget_active_to_day ?? null,
    periodStart: c.budget_period_start?.slice(0, 10) ?? "",
    periodEnd: c.budget_period_end?.slice(0, 10) ?? "",
  };
}

function buildSeasonMap(cats: CategoryRow[]): Record<string, SeasonDraft> {
  const m: Record<string, SeasonDraft> = {};
  for (const c of cats) {
    m[c.id] = seasonDraftFromCategory(c);
  }
  return m;
}

function seasonKeyFromCategory(c: CategoryRow): string {
  return [
    c.budget_repeats_annually !== false ? 1 : 0,
    c.budget_active_from_month ?? "",
    c.budget_active_from_day ?? "",
    c.budget_active_to_month ?? "",
    c.budget_active_to_day ?? "",
    c.budget_period_start ?? "",
    c.budget_period_end ?? "",
  ].join(":");
}

function recurringKeyFromCategory(c: CategoryRow): string {
  return `${c.budget_recurring_payment ? 1 : 0}:${c.budget_recurring_interval ?? ""}`;
}

function budgetsFromStrings(
  cats: CategoryRow[],
  inputs: Record<string, string>,
): Record<string, number | null> {
  const m: Record<string, number | null> = {};
  for (const c of cats) {
    const raw = inputs[c.id];
    if (raw === undefined || raw.trim() === "") {
      m[c.id] = null;
      continue;
    }
    const n = parseUsdInput(raw);
    m[c.id] = n;
  }
  return m;
}

export function BudgetSettingsPanel({
  initialCategories,
  initialReference,
}: Props) {
  const router = useRouter();
  const sorted = useMemo(
    () =>
      [...initialCategories].sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.name.localeCompare(b.name);
      }),
    [initialCategories],
  );

  const [inputs, setInputs] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const c of initialCategories) {
      m[c.id] = formatInput(c.monthly_budget);
    }
    return m;
  });

  const [season, setSeason] = useState<Record<string, SeasonDraft>>(() =>
    buildSeasonMap(initialCategories),
  );

  const [amountPeriod, setAmountPeriod] = useState<
    Record<string, "month" | "week" | "year">
  >(() => {
    const m: Record<string, "month" | "week" | "year"> = {};
    for (const c of initialCategories) {
      if (c.budget_amount_period === "week") m[c.id] = "week";
      else if (c.budget_amount_period === "year") m[c.id] = "year";
      else m[c.id] = "month";
    }
    return m;
  });

  const [annualPaymentMonth, setAnnualPaymentMonth] = useState<
    Record<string, number | null>
  >(() => {
    const r: Record<string, number | null> = {};
    for (const c of initialCategories) {
      const pm = c.budget_annual_payment_month;
      r[c.id] =
        pm != null && pm >= 1 && pm <= 12 ? pm : null;
    }
    return r;
  });

  const [recurringEnabled, setRecurringEnabled] = useState<
    Record<string, boolean>
  >(() => {
    const m: Record<string, boolean> = {};
    for (const c of initialCategories) {
      m[c.id] = Boolean(c.budget_recurring_payment);
    }
    return m;
  });

  const [recurringInterval, setRecurringInterval] = useState<
    Record<string, BudgetRecurringInterval | "">
  >(() => {
    const m: Record<string, BudgetRecurringInterval | ""> = {};
    for (const c of initialCategories) {
      m[c.id] = c.budget_recurring_interval ?? "";
    }
    return m;
  });

  const [refMeta, setRefMeta] = useState<ReferenceMeta | null>(
    initialReference,
  );
  const [lastImportedLines, setLastImportedLines] = useState<
    ExtractedBudgetLineJson[] | null
  >(null);

  const [fileBusy, setFileBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const budgetSyncKey = useMemo(
    () =>
      [...initialCategories]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(
          (c) =>
            `${c.id}:${c.monthly_budget ?? ""}:${c.budget_amount_period ?? "month"}:${c.budget_annual_payment_month ?? ""}:${seasonKeyFromCategory(c)}:${recurringKeyFromCategory(c)}`,
        )
        .join("|"),
    [initialCategories],
  );

  useEffect(() => {
    const m: Record<string, string> = {};
    const ap: Record<string, "month" | "week" | "year"> = {};
    const apm: Record<string, number | null> = {};
    for (const c of initialCategories) {
      m[c.id] = formatInput(c.monthly_budget);
      if (c.budget_amount_period === "week") ap[c.id] = "week";
      else if (c.budget_amount_period === "year") ap[c.id] = "year";
      else ap[c.id] = "month";
      const pm = c.budget_annual_payment_month;
      apm[c.id] =
        pm != null && pm >= 1 && pm <= 12 ? pm : null;
    }
    setInputs(m);
    setSeason(buildSeasonMap(initialCategories));
    setAmountPeriod(ap);
    setAnnualPaymentMonth(apm);
    const re: Record<string, boolean> = {};
    const ri: Record<string, BudgetRecurringInterval | ""> = {};
    for (const c of initialCategories) {
      re[c.id] = Boolean(c.budget_recurring_payment);
      ri[c.id] = c.budget_recurring_interval ?? "";
    }
    setRecurringEnabled(re);
    setRecurringInterval(ri);
  }, [budgetSyncKey, initialCategories]);

  useEffect(() => {
    setRefMeta(initialReference);
  }, [initialReference]);

  const budgets = useMemo(
    () => budgetsFromStrings(sorted, inputs),
    [sorted, inputs],
  );

  const totalPlanned = useMemo(() => {
    let s = 0;
    for (const c of sorted) {
      const v = budgets[c.id];
      if (typeof v !== "number") continue;
      const unit = amountPeriod[c.id] ?? "month";
      if (unit === "week") s += (v * 52) / 12;
      else if (unit === "year") s += v / 12;
      else s += v;
    }
    return s;
  }, [sorted, budgets, amountPeriod]);

  const totalImportedMonthly = useMemo(() => {
    if (!lastImportedLines?.length) return null;
    return lastImportedLines.reduce((a, l) => a + l.monthlyEquivalent, 0);
  }, [lastImportedLines]);

  async function onPickFile(f: File | null) {
    if (!f) return;
    setError(null);
    setSuccess(null);
    setFileBusy(true);
    const fd = new FormData();
    fd.set("file", f);
    try {
      const res = await fetch("/api/household/budget-import", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as {
        error?: string;
        lineCount?: number;
        lineItems?: ExtractedBudgetLineJson[];
        sourceFilename?: string;
      };
      if (!res.ok) {
        setError(data.error || "Import failed.");
        return;
      }
      setLastImportedLines(data.lineItems ?? null);
      setRefMeta((prev) => ({
        sourceFilename: data.sourceFilename ?? f.name,
        lineCount: data.lineCount ?? 0,
        lastAiSummary: prev?.lastAiSummary ?? null,
      }));
      setSuccess(
        `Imported ${data.lineCount ?? 0} budget line${(data.lineCount ?? 0) === 1 ? "" : "s"} from “${data.sourceFilename ?? f.name}”.`,
      );
    } catch {
      setError("Network error while uploading.");
    } finally {
      setFileBusy(false);
    }
  }

  async function runAiProposal() {
    setError(null);
    setSuccess(null);
    setAiBusy(true);
    try {
      const res = await fetch("/api/household/budget-propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          lastImportedLines && lastImportedLines.length > 0
            ? { lineItems: lastImportedLines }
            : {},
        ),
      });
      const data = (await res.json()) as {
        error?: string;
        code?: string;
        proposals?: { categoryId: string; monthlyBudget: number }[];
        summary?: string;
        lineCount?: number;
        spreadsheetMonthlyTotal?: number;
        source?: "ai" | "spreadsheet";
      };
      if (!res.ok) {
        setError(data.error || "AI proposal failed.");
        return;
      }
      if (data.summary) {
        setRefMeta((prev) => ({
          sourceFilename: prev?.sourceFilename ?? null,
          lineCount: data.lineCount ?? prev?.lineCount ?? 0,
          lastAiSummary: data.summary ?? null,
        }));
      }
      setInputs((prev) => {
        const next = { ...prev };
        for (const p of data.proposals ?? []) {
          next[p.categoryId] = formatInput(p.monthlyBudget);
        }
        return next;
      });
      const total =
        typeof data.spreadsheetMonthlyTotal === "number"
          ? formatUsd(data.spreadsheetMonthlyTotal)
          : null;
      if (data.source === "spreadsheet") {
        setSuccess(
          total
            ? `Totals locked to your file (${total}/mo from ${data.lineCount ?? 0} lines). Category splits used labels + descriptions; edit anything below, then save.`
            : "Totals matched your spreadsheet; category splits used labels + descriptions. Edit any amount, then save.",
        );
      } else {
        setSuccess(
          total
            ? `Suggested amounts from the model (${total}/mo across lines). Adjust any row, then save.`
            : "Suggested amounts are filled in below. Adjust any row, then save.",
        );
      }
    } catch {
      setError("Network error while calling AI.");
    } finally {
      setAiBusy(false);
    }
  }

  async function saveBudgets() {
    setError(null);
    setSuccess(null);
    const clean: {
      categoryId: string;
      monthlyBudget: number | null;
      budgetAmountPeriod: "month" | "week" | "year";
      budgetAnnualPaymentMonth: number | null;
      budgetRepeatsAnnually: boolean;
      budgetActiveFromMonth: number | null;
      budgetActiveFromDay: number | null;
      budgetActiveToMonth: number | null;
      budgetActiveToDay: number | null;
      budgetPeriodStart: string | null;
      budgetPeriodEnd: string | null;
      budgetRecurringPayment: boolean;
      budgetRecurringInterval: BudgetRecurringInterval | null;
    }[] = [];

    function recurringPayload(id: string): {
      budgetRecurringPayment: boolean;
      budgetRecurringInterval: BudgetRecurringInterval | null;
    } {
      const en = recurringEnabled[id] ?? false;
      if (!en) {
        return { budgetRecurringPayment: false, budgetRecurringInterval: null };
      }
      const iv = recurringInterval[id];
      return {
        budgetRecurringPayment: true,
        budgetRecurringInterval: iv === "" ? null : iv,
      };
    }

    for (const c of sorted) {
      const unit = amountPeriod[c.id] ?? "month";
      const payM = annualPaymentMonth[c.id] ?? null;
      const raw = inputs[c.id]?.trim() ?? "";
      if (raw === "") {
        clean.push({
          categoryId: c.id,
          monthlyBudget: null,
          budgetAmountPeriod: "month",
          budgetAnnualPaymentMonth: null,
          budgetRepeatsAnnually: true,
          budgetActiveFromMonth: null,
          budgetActiveFromDay: null,
          budgetActiveToMonth: null,
          budgetActiveToDay: null,
          budgetPeriodStart: null,
          budgetPeriodEnd: null,
          budgetRecurringPayment: false,
          budgetRecurringInterval: null,
        });
        continue;
      }
      const n = parseUsdInput(raw);
      if (n === null) {
        setError(`Invalid amount for “${c.name}”.`);
        return;
      }
      if (
        recurringEnabled[c.id] &&
        (!recurringInterval[c.id] || recurringInterval[c.id] === "")
      ) {
        setError(
          `Pick how often “${c.name}” recurs, or turn off recurring payment.`,
        );
        return;
      }
      if (
        unit === "year" &&
        (payM == null || payM < 1 || payM > 12)
      ) {
        setError(
          `Choose which month the annual payment occurs for “${c.name}”.`,
        );
        return;
      }
      const annualMonthField = unit === "year" ? payM : null;
      const sd = season[c.id] ?? seasonDraftFromCategory(c);
      if (!sd.limit) {
        clean.push({
          categoryId: c.id,
          monthlyBudget: n,
          budgetAmountPeriod: unit,
          budgetAnnualPaymentMonth: annualMonthField,
          budgetRepeatsAnnually: true,
          budgetActiveFromMonth: null,
          budgetActiveFromDay: null,
          budgetActiveToMonth: null,
          budgetActiveToDay: null,
          budgetPeriodStart: null,
          budgetPeriodEnd: null,
          ...recurringPayload(c.id),
        });
        continue;
      }
      if (sd.repeatsAnnually) {
        if (
          sd.fm == null ||
          sd.fd == null ||
          sd.tm == null ||
          sd.td == null
        ) {
          setError(
            `Set start and end month/day for “${c.name}”, or turn off “Limit to part of the year”.`,
          );
          return;
        }
        clean.push({
          categoryId: c.id,
          monthlyBudget: n,
          budgetAmountPeriod: unit,
          budgetAnnualPaymentMonth: annualMonthField,
          budgetRepeatsAnnually: true,
          budgetActiveFromMonth: sd.fm,
          budgetActiveFromDay: sd.fd,
          budgetActiveToMonth: sd.tm,
          budgetActiveToDay: sd.td,
          budgetPeriodStart: null,
          budgetPeriodEnd: null,
          ...recurringPayload(c.id),
        });
      } else {
        const ps = sd.periodStart.trim();
        const pe = sd.periodEnd.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ps) || !/^\d{4}-\d{2}-\d{2}$/.test(pe)) {
          setError(
            `Choose valid start and end dates for “${c.name}” (one-time budget).`,
          );
          return;
        }
        if (ps.localeCompare(pe) > 0) {
          setError(`End date must be on or after start date for “${c.name}”.`);
          return;
        }
        clean.push({
          categoryId: c.id,
          monthlyBudget: n,
          budgetAmountPeriod: unit,
          budgetAnnualPaymentMonth: annualMonthField,
          budgetRepeatsAnnually: false,
          budgetActiveFromMonth: null,
          budgetActiveFromDay: null,
          budgetActiveToMonth: null,
          budgetActiveToDay: null,
          budgetPeriodStart: ps,
          budgetPeriodEnd: pe,
          ...recurringPayload(c.id),
        });
      }
    }
    setSaveBusy(true);
    try {
      const res = await fetch("/api/household/category-budgets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: clean }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Save failed.");
        return;
      }
      setSuccess("Budgets saved.");
      router.refresh();
    } catch {
      setError("Network error while saving.");
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Import &amp; AI assist
        </h2>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          Upload your Excel budget (for example your annual household workbook).
          The app extracts line items, stores them for context on future runs, and
          can suggest a monthly amount per category. You can always edit amounts
          before saving.
        </p>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-800">
            <input
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="sr-only"
              disabled={fileBusy}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                e.target.value = "";
                void onPickFile(f);
              }}
            />
            {fileBusy ? "Reading…" : "Choose Excel file"}
          </label>
          <button
            type="button"
            disabled={aiBusy || (refMeta?.lineCount === 0 && !lastImportedLines?.length)}
            onClick={() => void runAiProposal()}
            className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-700 dark:hover:bg-violet-600"
          >
            {aiBusy ? "Proposing…" : "Propose budgets with AI"}
          </button>
        </div>

        {refMeta && refMeta.lineCount > 0 ? (
          <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
            Last import:{" "}
            <span className="font-medium text-zinc-800 dark:text-zinc-200">
              {refMeta.lineCount} lines
            </span>
            {refMeta.sourceFilename ? (
              <>
                {" "}
                from <span className="font-mono">{refMeta.sourceFilename}</span>
              </>
            ) : null}
            {totalImportedMonthly != null ? (
              <>
                {" "}
                (~{formatUsd(totalImportedMonthly)} / mo in extracted lines)
              </>
            ) : null}
          </p>
        ) : (
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-500">
            No spreadsheet loaded yet. Upload a .xlsx file to enable AI
            proposals.
          </p>
        )}

        {refMeta?.lastAiSummary ? (
          <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50/80 px-3 py-2 text-xs text-violet-950 dark:border-violet-900/40 dark:bg-violet-950/40 dark:text-violet-100">
            <span className="font-medium">Last AI summary: </span>
            {refMeta.lastAiSummary}
          </div>
        ) : null}
      </div>

      {error ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
          {success}
        </p>
      ) : null}

      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Budget by category
            </h2>
            <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
              Total planned:{" "}
              <span className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                {formatUsd(totalPlanned)}
              </span>{" "}
              / month (approx.: weekly ×52÷12, yearly ÷12). Leave amount blank to
              clear. Set each line to{" "}
              <span className="font-medium">per month</span>,{" "}
              <span className="font-medium">per week</span>, or{" "}
              <span className="font-medium">per year</span> and pick the payment
              month for annual items. Use “Limit to part of the year” for
              seasonal windows. Optionally mark recurring bills and how often they
              repeat.
            </p>
          </div>
          <button
            type="button"
            disabled={saveBusy}
            onClick={() => void saveBudgets()}
            className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            {saveBusy ? "Saving…" : "Save budgets"}
          </button>
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
          <table className="w-full min-w-[320px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 text-right font-medium">Amount (USD)</th>
                <th className="px-3 py-2 font-medium">Applies per</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const sd = season[c.id] ?? seasonDraftFromCategory(c);
                return (
                  <tr
                    key={c.id}
                    className="border-b border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="max-w-[min(100vw-8rem,28rem)] px-3 py-3 align-top">
                      <div className="inline-flex items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor: c.color?.trim() || "#71717a",
                          }}
                          aria-hidden
                        />
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {c.name}
                        </span>
                      </div>
                      <div className="mt-3 space-y-2 border-t border-zinc-100 pt-3 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                        <label className="flex cursor-pointer items-start gap-2">
                          <input
                            type="checkbox"
                            className="mt-0.5 rounded border-zinc-300 dark:border-zinc-600 dark:bg-zinc-900"
                            checked={sd.limit}
                            onChange={(e) => {
                              const limit = e.target.checked;
                              setSeason((prev) => ({
                                ...prev,
                                [c.id]: {
                                  ...(prev[c.id] ?? seasonDraftFromCategory(c)),
                                  limit,
                                },
                              }));
                            }}
                          />
                          <span>
                            Limit to part of the year (seasonal / school year)
                          </span>
                        </label>
                        {sd.limit ? (
                          <div className="ml-6 space-y-2">
                            <label className="flex cursor-pointer items-center gap-2">
                              <input
                                type="checkbox"
                                className="rounded border-zinc-300 dark:border-zinc-600 dark:bg-zinc-900"
                                checked={sd.repeatsAnnually}
                                onChange={(e) => {
                                  const repeatsAnnually = e.target.checked;
                                  setSeason((prev) => ({
                                    ...prev,
                                    [c.id]: {
                                      ...(prev[c.id] ?? seasonDraftFromCategory(c)),
                                      repeatsAnnually,
                                    },
                                  }));
                                }}
                              />
                              <span>Repeats every year</span>
                            </label>
                            {sd.repeatsAnnually ? (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-zinc-500">From</span>
                                <select
                                  className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                                  value={sd.fm ?? ""}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setSeason((prev) => ({
                                      ...prev,
                                      [c.id]: {
                                        ...(prev[c.id] ??
                                          seasonDraftFromCategory(c)),
                                        fm:
                                          v === ""
                                            ? null
                                            : Number.parseInt(v, 10),
                                      },
                                    }));
                                  }}
                                >
                                  <option value="">Mo</option>
                                  {MONTH_OPTIONS.map((o) => (
                                    <option key={o.v} value={o.v}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="number"
                                  min={1}
                                  max={31}
                                  placeholder="Day"
                                  className="w-14 rounded border border-zinc-300 bg-white px-1 py-0.5 text-right tabular-nums text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                                  value={sd.fd ?? ""}
                                  onChange={(e) => {
                                    const t = e.target.value;
                                    setSeason((prev) => ({
                                      ...prev,
                                      [c.id]: {
                                        ...(prev[c.id] ??
                                          seasonDraftFromCategory(c)),
                                        fd:
                                          t === ""
                                            ? null
                                            : Number.parseInt(t, 10),
                                      },
                                    }));
                                  }}
                                />
                                <span className="text-zinc-500">to</span>
                                <select
                                  className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                                  value={sd.tm ?? ""}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setSeason((prev) => ({
                                      ...prev,
                                      [c.id]: {
                                        ...(prev[c.id] ??
                                          seasonDraftFromCategory(c)),
                                        tm:
                                          v === ""
                                            ? null
                                            : Number.parseInt(v, 10),
                                      },
                                    }));
                                  }}
                                >
                                  <option value="">Mo</option>
                                  {MONTH_OPTIONS.map((o) => (
                                    <option key={o.v} value={o.v}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="number"
                                  min={1}
                                  max={31}
                                  placeholder="Day"
                                  className="w-14 rounded border border-zinc-300 bg-white px-1 py-0.5 text-right tabular-nums text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                                  value={sd.td ?? ""}
                                  onChange={(e) => {
                                    const t = e.target.value;
                                    setSeason((prev) => ({
                                      ...prev,
                                      [c.id]: {
                                        ...(prev[c.id] ??
                                          seasonDraftFromCategory(c)),
                                        td:
                                          t === ""
                                            ? null
                                            : Number.parseInt(t, 10),
                                      },
                                    }));
                                  }}
                                />
                              </div>
                            ) : (
                              <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
                                <span className="text-zinc-500">
                                  One-time window
                                </span>
                                <input
                                  type="date"
                                  className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                                  value={sd.periodStart}
                                  onChange={(e) => {
                                    setSeason((prev) => ({
                                      ...prev,
                                      [c.id]: {
                                        ...(prev[c.id] ??
                                          seasonDraftFromCategory(c)),
                                        periodStart: e.target.value,
                                      },
                                    }));
                                  }}
                                />
                                <span className="text-zinc-500">–</span>
                                <input
                                  type="date"
                                  className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                                  value={sd.periodEnd}
                                  onChange={(e) => {
                                    setSeason((prev) => ({
                                      ...prev,
                                      [c.id]: {
                                        ...(prev[c.id] ??
                                          seasonDraftFromCategory(c)),
                                        periodEnd: e.target.value,
                                      },
                                    }));
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-3 space-y-2 border-t border-zinc-100 pt-3 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                        <label className="flex cursor-pointer items-start gap-2">
                          <input
                            type="checkbox"
                            className="mt-0.5 rounded border-zinc-300 dark:border-zinc-600 dark:bg-zinc-900"
                            checked={recurringEnabled[c.id] ?? false}
                            onChange={(e) => {
                              const on = e.target.checked;
                              setRecurringEnabled((prev) => ({
                                ...prev,
                                [c.id]: on,
                              }));
                              if (!on) {
                                setRecurringInterval((prev) => ({
                                  ...prev,
                                  [c.id]: "",
                                }));
                              }
                            }}
                          />
                          <span>Recurring payment</span>
                        </label>
                        {recurringEnabled[c.id] ? (
                          <div className="ml-6 space-y-1">
                            <label
                              className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400"
                              htmlFor={`budget-recurring-${c.id}`}
                            >
                              How often
                            </label>
                            <select
                              id={`budget-recurring-${c.id}`}
                              className="w-full min-w-[10rem] rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                              value={recurringInterval[c.id] ?? ""}
                              onChange={(e) => {
                                const v = e.target
                                  .value as BudgetRecurringInterval | "";
                                setRecurringInterval((prev) => ({
                                  ...prev,
                                  [c.id]: v,
                                }));
                              }}
                            >
                              <option value="">Choose…</option>
                              <option value="weekly">Weekly</option>
                              <option value="monthly">Monthly</option>
                              <option value="quarterly">Quarterly</option>
                              <option value="semiannual">Every 6 months</option>
                              <option value="annual">Annually</option>
                            </select>
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right align-top">
                      <input
                        type="text"
                        inputMode="decimal"
                        className="w-full min-w-[6rem] rounded-md border border-zinc-300 bg-white px-2 py-1 text-right tabular-nums text-zinc-900 shadow-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-violet-500 dark:focus:ring-violet-500/25"
                        placeholder="—"
                        value={inputs[c.id] ?? ""}
                        onChange={(e) => {
                          setInputs((prev) => ({
                            ...prev,
                            [c.id]: e.target.value,
                          }));
                        }}
                        aria-label={`Budget amount for ${c.name}`}
                      />
                      <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-500">
                        {(amountPeriod[c.id] ?? "month") === "week"
                          ? "Expected / week when in season"
                          : (amountPeriod[c.id] ?? "month") === "year"
                            ? "Total per year (spread across payment month)"
                            : "Expected / month when in season"}
                      </p>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <label className="sr-only" htmlFor={`budget-per-${c.id}`}>
                        Budget amount applies per month, week, or year for {c.name}
                      </label>
                      <select
                        id={`budget-per-${c.id}`}
                        value={amountPeriod[c.id] ?? "month"}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const v =
                            raw === "week"
                              ? "week"
                              : raw === "year"
                                ? "year"
                                : "month";
                          setAmountPeriod((prev) => ({
                            ...prev,
                            [c.id]: v,
                          }));
                          if (v !== "year") {
                            setAnnualPaymentMonth((prev) => ({
                              ...prev,
                              [c.id]: null,
                            }));
                          }
                        }}
                        className="w-full min-w-[10rem] rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 shadow-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-violet-500 dark:focus:ring-violet-500/25"
                      >
                        <option value="month">Calendar month</option>
                        <option value="week">Week (7 days)</option>
                        <option value="year">Year (annual payment)</option>
                      </select>
                      {(amountPeriod[c.id] ?? "month") === "year" ? (
                        <div className="mt-2 space-y-1">
                          <label
                            className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400"
                            htmlFor={`budget-annual-mo-${c.id}`}
                          >
                            Paid in
                          </label>
                          <select
                            id={`budget-annual-mo-${c.id}`}
                            value={
                              annualPaymentMonth[c.id] != null
                                ? String(annualPaymentMonth[c.id])
                                : ""
                            }
                            onChange={(e) => {
                              const t = e.target.value;
                              setAnnualPaymentMonth((prev) => ({
                                ...prev,
                                [c.id]:
                                  t === ""
                                    ? null
                                    : Number.parseInt(t, 10),
                              }));
                            }}
                            className="w-full min-w-[10rem] rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 shadow-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-violet-500 dark:focus:ring-violet-500/25"
                          >
                            <option value="">Month…</option>
                            {MONTH_OPTIONS.map((o) => (
                              <option key={o.v} value={o.v}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-500">
          Manage category names and colors on{" "}
          <Link
            href="/settings/categories"
            className="font-medium text-violet-700 underline-offset-2 hover:underline dark:text-violet-300"
          >
            Categories
          </Link>
          . Spending vs budget appears on the dashboard when budgets are set.
        </p>
      </div>
    </div>
  );
}
