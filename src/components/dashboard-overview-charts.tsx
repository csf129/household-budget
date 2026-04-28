"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { IncomeRuleRow } from "@/lib/apply-income-rules";
import {
  bankTransferSignedNetForAccountBucket,
  bankTransferVolumeForBucket,
  bucketsForGranularity,
  buildPurchasesBarStackChartData,
  buildSpendingCategoryTableGroups,
  categoryDisplayName,
  CATEGORY_BREAKDOWN_TOP_N,
  creditCardPaymentTotalForBucket,
  periodHeading,
  primarySignedNetForBucket,
  spendingByBucketsForCategory,
  spendingByBucketsForCategorySubtree,
  BREAKDOWN_UNCATEGORIZED_ID,
  defaultSpendingBreakdownSelection,
  spendingByCategoryBreakdownRows,
  sumOptionalBudgets,
  totalsForBucket,
  type CategoryBucketSpendRow,
  type CategorySpendRow,
  type PeriodBucket,
  type PeriodGranularity,
  type SpendingCategoryTableGroup,
} from "@/lib/dashboard-analytics";
import { isSingleCalendarMonthRange } from "@/lib/weekly-spending-budget";
import { getChartAxisTheme, getRechartsTooltipStyle } from "@/lib/chart-palette";
import { isBuiltinPrimarySlug } from "@/lib/primary-category-slugs";
import { DashboardCategoryDrilldownPanel } from "@/components/dashboard-category-drilldown-panel";
import {
  DashboardOverviewBarDrilldownPanel,
  type OverviewBarDrilldownSpec,
} from "@/components/dashboard-overview-bar-drilldown-panel";
import {
  DashboardWeeklyBudgetTable,
  type WeeklyBudgetCategoryDrilldownPayload,
} from "@/components/dashboard-weekly-budget-table";
import {
  formatCategoryLabel,
  sortCategoriesForPicker,
} from "@/lib/category-display";
import { effectiveMonthlyBudgetForDateRange } from "@/lib/category-budget-season";
import { formatUsd, formatUsdCompact } from "@/lib/money";
import type {
  CategoryRow,
  PrimaryCategoryGroupRow,
  TransactionRow,
} from "@/types/finance";

const GRANULARITIES: { id: PeriodGranularity; label: string }[] = [
  { id: "month", label: "Monthly" },
  { id: "quarter", label: "Quarterly" },
  { id: "year", label: "Yearly" },
  { id: "ytd", label: "Year to date" },
];

type OverviewRangeMode = "last12" | "all";

const OVERVIEW_RANGE_OPTIONS: { id: OverviewRangeMode; label: string }[] = [
  { id: "last12", label: "Last 12 months" },
  { id: "all", label: "All history" },
];

const CATEGORY_TREND_MAX_LINES = 12;

const CATEGORY_TREND_COLOR_FALLBACK = [
  "#6366f1",
  "#0ea5e9",
  "#14b8a6",
  "#f97316",
  "#ec4899",
  "#8b5cf6",
  "#22c55e",
  "#eab308",
  "#f43f5e",
  "#84cc16",
  "#06b6d4",
  "#a855f7",
] as const;

/** Encoded keys for category trend series (stable for React keys). */
function trendSeriesKeyName(displayName: string): string {
  return `n:${encodeURIComponent(displayName)}`;
}

function trendSeriesKeySubtree(parentId: string): string {
  return `s:${parentId}`;
}

function parseTrendSeriesKey(
  k: string,
): { type: "name"; name: string } | { type: "subtree"; parentId: string } {
  if (k.startsWith("s:") && k.length > 2) {
    return { type: "subtree", parentId: k.slice(2) };
  }
  if (k.startsWith("n:")) {
    try {
      return { type: "name", name: decodeURIComponent(k.slice(2)) };
    } catch {
      return { type: "name", name: k.slice(2) };
    }
  }
  return { type: "name", name: k };
}

function trendLegendLabel(key: string, categories: CategoryRow[]): string {
  const p = parseTrendSeriesKey(key);
  if (p.type === "subtree") {
    const cat = categories.find((c) => c.id === p.parentId);
    return cat ? `${cat.name.trim()} (total)` : "Category (total)";
  }
  return p.name;
}

function trendColorForSeriesKey(
  key: string,
  idx: number,
  categories: CategoryRow[],
): string {
  const p = parseTrendSeriesKey(key);
  if (p.type === "subtree") {
    const cat = categories.find((c) => c.id === p.parentId);
    if (cat?.color?.trim()) return cat.color.trim();
  } else {
    const hit = categories.find(
      (c) => formatCategoryLabel(c, categories) === p.name,
    );
    if (hit?.color?.trim()) return hit.color.trim();
    if (p.name.trim().toLowerCase() === "uncategorized") return "#9ca3af";
  }
  return CATEGORY_TREND_COLOR_FALLBACK[idx % CATEGORY_TREND_COLOR_FALLBACK.length]!;
}

type TrendPickerLeaf = {
  kind: "leaf";
  displayName: string;
  color: string | null;
};

type TrendPickerParent = {
  kind: "parent";
  parentId: string;
  /** Short name for the parent row (subtree total line). */
  parentName: string;
  color: string | null;
  subs: { id: string; displayName: string; color: string | null }[];
};

type TrendPickerGroup = TrendPickerLeaf | TrendPickerParent;

function parseIsoMonth(isoDate: string): { y: number; m: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const y = Number.parseInt(isoDate.slice(0, 4), 10);
  const m = Number.parseInt(isoDate.slice(5, 7), 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  return { y, m };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function monthEnd(y: number, m: number): string {
  const d = new Date(y, m, 0).getDate();
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function monthLabel(y: number, m: number): string {
  return new Date(y, m - 1, 1).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
  });
}

function quarterOfMonth(m: number): number {
  return Math.floor((m - 1) / 3) + 1;
}

function quarterBounds(y: number, q: number): { start: string; end: string } {
  const startM = (q - 1) * 3 + 1;
  const endM = q * 3;
  return {
    start: `${y}-${pad2(startM)}-01`,
    end: monthEnd(y, endM),
  };
}

function bucketsForAllHistory(
  granularity: PeriodGranularity,
  transactions: TransactionRow[],
): PeriodBucket[] {
  const dates = transactions
    .map((t) => t.occurred_on)
    .filter((d): d is string => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (dates.length === 0) return bucketsForGranularity(granularity);

  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const min = parseIsoMonth(minDate);
  const now = new Date();
  const endY = now.getFullYear();
  const endM = now.getMonth() + 1;
  if (!min) return bucketsForGranularity(granularity);

  if (granularity === "month" || granularity === "ytd") {
    const out: PeriodBucket[] = [];
    let y = min.y;
    let m = min.m;
    while (y < endY || (y === endY && m <= endM)) {
      out.push({
        key: `${y}-${pad2(m)}`,
        label: monthLabel(y, m),
        start: `${y}-${pad2(m)}-01`,
        end: monthEnd(y, m),
      });
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return out;
  }

  if (granularity === "quarter") {
    const out: PeriodBucket[] = [];
    let y = min.y;
    let q = quarterOfMonth(min.m);
    const endQ = quarterOfMonth(endM);
    while (y < endY || (y === endY && q <= endQ)) {
      const b = quarterBounds(y, q);
      out.push({
        key: `${y}-Q${q}`,
        label: `Q${q} ${y}`,
        start: b.start,
        end: b.end,
      });
      q += 1;
      if (q > 4) {
        q = 1;
        y += 1;
      }
    }
    return out;
  }

  const out: PeriodBucket[] = [];
  for (let y = min.y; y <= endY; y += 1) {
    out.push({
      key: String(y),
      label: String(y),
      start: `${y}-01-01`,
      end: `${y}-12-31`,
    });
  }
  return out;
}

function bucketFromBarRow(row: {
  key: string;
  label: string;
  start: string;
  end: string;
}): PeriodBucket {
  return {
    key: row.key,
    label: row.label,
    start: row.start,
    end: row.end,
  };
}

function bucketSelectLabel(g: PeriodGranularity): string {
  switch (g) {
    case "month":
      return "Month";
    case "quarter":
      return "Quarter";
    case "year":
      return "Year";
    case "ytd":
      return "Month";
    default:
      return "Period";
  }
}

type BankAccountPickerRow = { id: string; name: string };

type Props = {
  householdId: string;
  categories: CategoryRow[];
  primaryGroups: PrimaryCategoryGroupRow[];
  transactions: TransactionRow[];
  incomeRules: IncomeRuleRow[];
  /** Linked Plaid accounts (Settings → Bank); powers bank-transfer account filter. */
  bankAccounts?: BankAccountPickerRow[];
};

export function DashboardOverviewCharts({
  householdId,
  categories,
  primaryGroups,
  transactions,
  incomeRules,
  bankAccounts = [],
}: Props) {
  const [granularity, setGranularity] = useState<PeriodGranularity>("month");
  const [overviewRangeMode, setOverviewRangeMode] =
    useState<OverviewRangeMode>("last12");
  const [showIncome, setShowIncome] = useState(true);
  const [showPurchasesCategoryStacks, setShowPurchasesCategoryStacks] =
    useState(true);
  const [drilldownCategory, setDrilldownCategory] =
    useState<CategorySpendRow | null>(null);
  const [weeklyBudgetDrilldown, setWeeklyBudgetDrilldown] =
    useState<WeeklyBudgetCategoryDrilldownPayload | null>(null);
  const [categoryBucketKey, setCategoryBucketKey] = useState<string | null>(
    null,
  );
  const [overviewBarDrilldown, setOverviewBarDrilldown] =
    useState<OverviewBarDrilldownSpec | null>(null);
  const [categoryTrendRangeMode, setCategoryTrendRangeMode] =
    useState<OverviewRangeMode>("last12");
  const [categoryTrendGranularity, setCategoryTrendGranularity] =
    useState<PeriodGranularity>("month");
  const [selectedTrendSeriesKeys, setSelectedTrendSeriesKeys] = useState<
    string[]
  >(() => {
    const billsCat = categories.find(
      (c) => !c.parent_category_id && c.name.trim().toLowerCase().includes("bills"),
    );
    if (!billsCat) return [];
    const hasSubs = categories.some((c) => c.parent_category_id === billsCat.id);
    if (hasSubs) return [trendSeriesKeySubtree(billsCat.id)];
    return [trendSeriesKeyName(billsCat.name.trim())];
  });
  const [categoryTrendStacked, setCategoryTrendStacked] = useState(true);
  /** Parent ids with subcategories: when present, sub-rows are hidden in the trend picker. */
  const [collapsedTrendParents, setCollapsedTrendParents] = useState<
    Set<string>
  >(() => new Set());
  /** Parents with subcategories: when id is in the set, sub-rows are hidden. */
  const [collapsedParentIds, setCollapsedParentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const defaultBreakdownCategorySelection = useMemo(
    () => defaultSpendingBreakdownSelection(categories, primaryGroups),
    [categories, primaryGroups],
  );
  const [breakdownSelectionOverride, setBreakdownSelectionOverride] = useState<
    Set<string> | null
  >(null);
  const breakdownSelectedIds =
    breakdownSelectionOverride ?? defaultBreakdownCategorySelection;

  const [breakdownPickerOpen, setBreakdownPickerOpen] = useState(false);
  const breakdownPickerRef = useRef<HTMLDivElement>(null);
  const [bankTransferAccountId, setBankTransferAccountId] = useState<
    string | null
  >(null);

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const c = useMemo(() => getChartAxisTheme(isDark), [isDark]);
  const tipStyle = useMemo(() => getRechartsTooltipStyle(isDark), [isDark]);

  const periodBuckets = useMemo(
    () =>
      overviewRangeMode === "all"
        ? bucketsForAllHistory(granularity, transactions)
        : bucketsForGranularity(granularity),
    [granularity, overviewRangeMode, transactions],
  );

  const chartRows = useMemo(() => {
    const buckets = periodBuckets;
    return buckets.map((b) => {
      const t = totalsForBucket(transactions, b, { incomeRules });
      return {
        key: b.key,
        label: b.label,
        start: b.start,
        end: b.end,
        income: t.income,
        spending: t.spending,
      };
    });
  }, [periodBuckets, transactions, incomeRules]);

  const creditCardPaymentRows = useMemo(
    () =>
      periodBuckets.map((b) => ({
        key: b.key,
        label: b.label,
        start: b.start,
        end: b.end,
        amount: creditCardPaymentTotalForBucket(transactions, b),
      })),
    [periodBuckets, transactions],
  );

  const bankTransferAccountOptions = useMemo(
    () => [...bankAccounts].sort((a, b) => a.name.localeCompare(b.name)),
    [bankAccounts],
  );

  useEffect(() => {
    if (bankTransferAccountId == null) return;
    if (!bankTransferAccountOptions.some((o) => o.id === bankTransferAccountId)) {
      setBankTransferAccountId(null);
    }
  }, [bankTransferAccountOptions, bankTransferAccountId]);

  const bankTransferRows = useMemo(
    () =>
      periodBuckets.map((b) => ({
        key: b.key,
        label: b.label,
        start: b.start,
        end: b.end,
        volume:
          bankTransferAccountId == null
            ? bankTransferVolumeForBucket(transactions, b)
            : bankTransferSignedNetForAccountBucket(
                transactions,
                b,
                bankTransferAccountId,
              ),
      })),
    [periodBuckets, transactions, bankTransferAccountId],
  );

  const customPrimaryGroups = useMemo(
    () =>
      [...primaryGroups].filter((g) => !isBuiltinPrimarySlug(g.slug)),
    [primaryGroups],
  );

  const customPrimaryChartRows = useMemo(() => {
    const map = new Map<
      string,
      { key: string; label: string; start: string; end: string; amount: number }[]
    >();
    for (const g of customPrimaryGroups) {
      map.set(
        g.slug,
        periodBuckets.map((b) => ({
          key: b.key,
          label: b.label,
          start: b.start,
          end: b.end,
          amount: primarySignedNetForBucket(transactions, b, g.slug),
        })),
      );
    }
    return map;
  }, [customPrimaryGroups, periodBuckets, transactions]);

  const totalCreditCardPayments = useMemo(
    () => creditCardPaymentRows.reduce((s, r) => s + r.amount, 0),
    [creditCardPaymentRows],
  );

  const hasCreditCardPaymentData = creditCardPaymentRows.some(
    (r) => r.amount > 0,
  );

  const hasBankTransferData = useMemo(() => {
    if (bankTransferAccountId == null) {
      return bankTransferRows.some((r) => r.volume > 0);
    }
    return bankTransferRows.some((r) => r.volume !== 0);
  }, [bankTransferRows, bankTransferAccountId]);

  const totalBankTransferVolume = useMemo(
    () => bankTransferRows.reduce((s, r) => s + r.volume, 0),
    [bankTransferRows],
  );

  const bankTransferAccountLabel =
    bankTransferAccountId == null
      ? null
      : bankTransferAccountOptions.find((o) => o.id === bankTransferAccountId)
          ?.name ?? null;

  const rangeStart = chartRows[0]?.start ?? "";
  const rangeEnd = chartRows[chartRows.length - 1]?.end ?? "";

  const chartRowKeySig = useMemo(
    () => chartRows.map((r) => r.key).join("|"),
    [chartRows],
  );

  useEffect(() => {
    if (chartRows.length === 0) {
      setCategoryBucketKey(null);
      return;
    }
    setCategoryBucketKey((prev) => {
      if (prev && chartRows.some((r) => r.key === prev)) return prev;
      const lastWithSpend = [...chartRows]
        .reverse()
        .find((r) => r.spending > 0);
      return (
        lastWithSpend?.key ?? chartRows[chartRows.length - 1]!.key
      );
    });
  }, [granularity, chartRowKeySig]);

  const categoryViewBucket = useMemo(() => {
    if (chartRows.length === 0) return undefined;
    const hit = chartRows.find((r) => r.key === categoryBucketKey);
    return hit ?? chartRows[chartRows.length - 1];
  }, [chartRows, categoryBucketKey]);

  const catRangeStart = categoryViewBucket?.start ?? "";
  const catRangeEnd = categoryViewBucket?.end ?? "";

  const categoryRows = useMemo(() => {
    if (!catRangeStart || !catRangeEnd) return [];
    return spendingByCategoryBreakdownRows(
      categories,
      primaryGroups,
      transactions,
      catRangeStart,
      catRangeEnd,
      breakdownSelectedIds,
    );
  }, [
    categories,
    primaryGroups,
    transactions,
    catRangeStart,
    catRangeEnd,
    breakdownSelectedIds,
  ]);

  const breakdownSelectionKey = useMemo(
    () => [...breakdownSelectedIds].sort().join("|"),
    [breakdownSelectedIds],
  );

  const hasUncategorizedCatalogCategory = useMemo(
    () =>
      categories.some((c) => c.name.trim().toLowerCase() === "uncategorized"),
    [categories],
  );

  const breakdownPickerCategoriesSorted = useMemo(
    () => sortCategoriesForPicker(categories),
    [categories],
  );

  function toggleBreakdownCategoryVisible(id: string) {
    setBreakdownSelectionOverride((prev) => {
      const base = new Set(prev ?? defaultBreakdownCategorySelection);
      if (base.has(id)) base.delete(id);
      else base.add(id);
      return base;
    });
  }

  useEffect(() => {
    if (!breakdownPickerOpen) return;
    function onPointerDown(e: PointerEvent) {
      const el = breakdownPickerRef.current;
      if (el && !el.contains(e.target as Node)) {
        setBreakdownPickerOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [breakdownPickerOpen]);

  const categoryPeriodTotalSpending = useMemo(
    () => categoryRows.reduce((s, r) => s + r.amount, 0),
    [categoryRows],
  );

  const totalIncome = chartRows.reduce((s, r) => s + r.income, 0);
  const totalSpending = chartRows.reduce((s, r) => s + r.spending, 0);
  const difference = totalIncome - totalSpending;

  // Header shows the selected period (current month by default) rather than the full chart range.
  const displayIncome = categoryViewBucket?.income ?? 0;
  const displaySpending = categoryViewBucket?.spending ?? 0;
  const displayDifference = displayIncome - displaySpending;

  const pieData = useMemo(
    () =>
      categoryRows
        .filter((r) => r.amount > 0)
        .map((r) => ({
          name: r.name,
          value: r.amount,
          fill: r.color,
          row: r,
        })),
    [categoryRows],
  );

  const hasCategoryBudgets = useMemo(
    () => categories.some((c) => c.monthly_budget != null),
    [categories],
  );

  const showWeeklyBudgetTable = useMemo(
    () =>
      granularity === "month" &&
      hasCategoryBudgets &&
      Boolean(catRangeStart && catRangeEnd) &&
      isSingleCalendarMonthRange(catRangeStart, catRangeEnd),
    [granularity, hasCategoryBudgets, catRangeStart, catRangeEnd],
  );

  const categoryTableGroups = useMemo(
    () => buildSpendingCategoryTableGroups(categories, categoryRows),
    [categories, categoryRows],
  );

  const monthlyBudgetForSpendRow = useCallback(
    (row: CategorySpendRow): number | null => {
      if (row.categoryId != null) {
        const cat = categories.find((c) => c.id === row.categoryId);
        if (!cat) return null;
        return effectiveMonthlyBudgetForDateRange(
          cat,
          catRangeStart,
          catRangeEnd,
        );
      }
      const uncat = categories.find(
        (c) => c.name.trim().toLowerCase() === "uncategorized",
      );
      return uncat
        ? effectiveMonthlyBudgetForDateRange(
            uncat,
            catRangeStart,
            catRangeEnd,
          )
        : null;
    },
    [categories, catRangeStart, catRangeEnd],
  );

  const rollupMonthlyBudget = useCallback(
    (group: Extract<SpendingCategoryTableGroup, { kind: "parent" }>) => {
      const p = categories.find((c) => c.id === group.parentId);
      const pEff =
        p != null
          ? effectiveMonthlyBudgetForDateRange(p, catRangeStart, catRangeEnd)
          : null;
      const subVals = group.subs.map((sr) => monthlyBudgetForSpendRow(sr));
      return sumOptionalBudgets(pEff, ...subVals);
    },
    [categories, catRangeStart, catRangeEnd, monthlyBudgetForSpendRow],
  );

  /** Totals for the category table footer (flat rows — not grouped) so parent/child rows are not double-counted. */
  const spendingByCategoryTableFooter = useMemo(() => {
    let budgetTotal = 0;
    let leftTotal = 0;
    let anyBudget = false;
    for (const r of categoryRows) {
      const mb = monthlyBudgetForSpendRow(r);
      if (mb != null && Number.isFinite(mb)) {
        anyBudget = true;
        budgetTotal += mb;
        leftTotal += mb - r.amount;
      }
    }
    return {
      spent: categoryPeriodTotalSpending,
      budget: anyBudget ? budgetTotal : null,
      left: anyBudget ? leftTotal : null,
    };
  }, [categoryRows, categoryPeriodTotalSpending, monthlyBudgetForSpendRow]);

  function toggleParentCollapsed(parentId: string) {
    setCollapsedParentIds((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  }

  function shortSubcategoryLabel(fullName: string): string {
    const sep = "›";
    if (!fullName.includes(sep)) return fullName;
    return fullName.split(sep).pop()?.trim() ?? fullName;
  }

  const heading = periodHeading(granularity);
  const headingWithRange =
    overviewRangeMode === "all" ? `All history (${heading})` : heading;
  const categoryPeriodTitle = categoryViewBucket?.label ?? heading;
  const drilldownAggregateLabel = categoryViewBucket
    ? `${categoryViewBucket.label} (${heading})`
    : heading;
  const hasAnyTx = transactions.length > 0;
  const hasBarData = chartRows.some((r) => r.income > 0 || r.spending > 0);

  const purchasesStackModel = useMemo(
    () =>
      buildPurchasesBarStackChartData(
        transactions,
        chartRows,
        CATEGORY_BREAKDOWN_TOP_N,
      ),
    [transactions, chartRows],
  );

  const incomeVsPurchasesBarData = useMemo(() => {
    if (
      showPurchasesCategoryStacks &&
      purchasesStackModel.segments.length > 0
    ) {
      return purchasesStackModel.rows;
    }
    return chartRows;
  }, [
    chartRows,
    purchasesStackModel.rows,
    purchasesStackModel.segments.length,
    showPurchasesCategoryStacks,
  ]);

  const purchasesBarIsStacked =
    showPurchasesCategoryStacks && purchasesStackModel.segments.length > 0;

  const trendPickerGroups = useMemo((): TrendPickerGroup[] => {
    if (categories.length === 0) {
      const hasUncat = transactions.some((t) => {
        if (!Number.isFinite(t.amount) || t.amount >= 0) return false;
        return (
          categoryDisplayName(t).trim().toLowerCase() === "uncategorized"
        );
      });
      return hasUncat
        ? [{ kind: "leaf", displayName: "Uncategorized", color: "#9ca3af" }]
        : [];
    }

    const ordered = sortCategoriesForPicker(categories);
    const tops = ordered.filter((c) => !c.parent_category_id);
    const groups: TrendPickerGroup[] = [];

    for (const p of tops) {
      const subs = ordered.filter((c) => c.parent_category_id === p.id);
      if (subs.length === 0) {
        groups.push({
          kind: "leaf",
          displayName: formatCategoryLabel(p, categories),
          color: p.color?.trim() ?? null,
        });
      } else {
        groups.push({
          kind: "parent",
          parentId: p.id,
          parentName: p.name.trim(),
          color: p.color?.trim() ?? null,
          subs: subs.map((s) => ({
            id: s.id,
            displayName: formatCategoryLabel(s, categories),
            color: s.color?.trim() ?? null,
          })),
        });
      }
    }

    const hasUncategorizedCat = tops.some(
      (c) => c.name.trim().toLowerCase() === "uncategorized",
    );
    if (!hasUncategorizedCat) {
      const hasUncat = transactions.some((t) => {
        if (!Number.isFinite(t.amount) || t.amount >= 0) return false;
        return (
          categoryDisplayName(t).trim().toLowerCase() === "uncategorized"
        );
      });
      if (hasUncat) {
        groups.push({
          kind: "leaf",
          displayName: "Uncategorized",
          color: "#9ca3af",
        });
      }
    }

    return groups;
  }, [categories, transactions]);

  const categoryTrendBuckets = useMemo(
    () =>
      categoryTrendRangeMode === "all"
        ? bucketsForAllHistory(categoryTrendGranularity, transactions)
        : bucketsForGranularity(categoryTrendGranularity),
    [categoryTrendRangeMode, categoryTrendGranularity, transactions],
  );

  const categoryTrendHeading =
    categoryTrendRangeMode === "all"
      ? `All history (${periodHeading(categoryTrendGranularity)})`
      : periodHeading(categoryTrendGranularity);

  const categoryTrendChartData = useMemo(() => {
    if (selectedTrendSeriesKeys.length === 0 || categoryTrendBuckets.length === 0)
      return [];
    const trendFullRangeStart = categoryTrendBuckets[0]!.start;
    const trendFullRangeEnd =
      categoryTrendBuckets[categoryTrendBuckets.length - 1]!.end;

    const seriesByKey = new Map<string, CategoryBucketSpendRow[]>();
    for (const key of selectedTrendSeriesKeys) {
      const parsed = parseTrendSeriesKey(key);
      if (parsed.type === "subtree") {
        seriesByKey.set(
          key,
          spendingByBucketsForCategorySubtree(
            transactions,
            categoryTrendBuckets,
            parsed.parentId,
            categories,
          ),
        );
      } else {
        seriesByKey.set(
          key,
          spendingByBucketsForCategory(
            transactions,
            categoryTrendBuckets,
            parsed.name,
            trendFullRangeStart,
            trendFullRangeEnd,
            CATEGORY_BREAKDOWN_TOP_N,
          ),
        );
      }
    }

    return categoryTrendBuckets.map((b, i) => {
      const row: Record<string, string | number> = {
        label: b.label,
        key: b.key,
        start: b.start,
        end: b.end,
      };
      selectedTrendSeriesKeys.forEach((seriesKey, idx) => {
        row[`ct${idx}`] = seriesByKey.get(seriesKey)?.[i]?.spending ?? 0;
      });
      return row;
    });
  }, [
    categoryTrendBuckets,
    selectedTrendSeriesKeys,
    transactions,
    categories,
  ]);

  const hasCategoryTrendSeriesData = useMemo(() => {
    if (categoryTrendChartData.length === 0) return false;
    return categoryTrendChartData.some((row) =>
      selectedTrendSeriesKeys.some(
        (_n, idx) => Number(row[`ct${idx}`] ?? 0) > 0,
      ),
    );
  }, [categoryTrendChartData, selectedTrendSeriesKeys]);

  function toggleTrendSeriesKey(key: string) {
    setSelectedTrendSeriesKeys((prev) => {
      const i = prev.indexOf(key);
      if (i >= 0) return prev.filter((k) => k !== key);
      if (prev.length >= CATEGORY_TREND_MAX_LINES) return prev;
      return [...prev, key];
    });
  }

  function toggleCollapsedTrendParent(parentId: string) {
    setCollapsedTrendParents((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  }

  const drilldownSeries = useMemo(() => {
    if (!drilldownCategory || !catRangeStart || !catRangeEnd) return [];
    const mode =
      drilldownCategory.drilldownSpendingMode ?? "purchases_bills";
    if (drilldownCategory.drilldownSubtreeRootId) {
      return spendingByBucketsForCategorySubtree(
        transactions,
        periodBuckets,
        drilldownCategory.drilldownSubtreeRootId,
        categories,
        mode,
      );
    }
    return spendingByBucketsForCategory(
      transactions,
      periodBuckets,
      drilldownCategory.name,
      catRangeStart,
      catRangeEnd,
      CATEGORY_BREAKDOWN_TOP_N,
      mode,
    );
  }, [
    drilldownCategory,
    transactions,
    periodBuckets,
    catRangeStart,
    catRangeEnd,
    categories,
  ]);

  const weeklyBudgetDrilldownSeries = useMemo((): CategoryBucketSpendRow[] => {
    if (!weeklyBudgetDrilldown) return [];
    const { category, weekStart, weekEnd, weekLabel } = weeklyBudgetDrilldown;
    return [
      {
        key: "week",
        label: weekLabel,
        start: weekStart,
        end: weekEnd,
        spending: category.amount,
      },
    ];
  }, [weeklyBudgetDrilldown]);

  const openMonthlyCategoryDrilldown = (row: CategorySpendRow) => {
    setWeeklyBudgetDrilldown(null);
    setDrilldownCategory(row);
  };

  const openWeeklyBudgetCategoryDrilldown = (
    payload: WeeklyBudgetCategoryDrilldownPayload,
  ) => {
    setDrilldownCategory(null);
    setWeeklyBudgetDrilldown(payload);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Income vs purchases & bills + weekly budget stacked in left column */}
        <div className="flex flex-col gap-6">
        {/* Income vs purchases & bills */}
        <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Income and purchases &amp; bills
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                {categoryPeriodTitle}
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                {formatUsd(displaySpending)}
                <span className="ml-2 text-sm font-normal text-zinc-500 dark:text-zinc-400">
                  purchases &amp; bills
                </span>
              </p>
            </div>
            <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={showIncome}
                  onChange={(e) => setShowIncome(e.target.checked)}
                  className="rounded border-zinc-300 dark:border-zinc-600 dark:bg-zinc-900"
                />
                Show income
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={showPurchasesCategoryStacks}
                  onChange={(e) =>
                    setShowPurchasesCategoryStacks(e.target.checked)
                  }
                  className="rounded border-zinc-300 dark:border-zinc-600 dark:bg-zinc-900"
                />
                Show categories (stacked)
              </label>
            </div>
          </div>

          <div className="mt-4 h-[240px] w-full min-w-0">
            {!hasAnyTx ? (
              <p className="flex h-full items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
                Add transactions to see this chart.
              </p>
            ) : !hasBarData ? (
              <p className="flex h-full items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
                No income or purchases &amp; bills in this period.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={incomeVsPurchasesBarData}
                  margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={c.gridStroke}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: c.tickFill }}
                    interval={0}
                    angle={chartRows.length > 8 ? -35 : 0}
                    textAnchor={chartRows.length > 8 ? "end" : "middle"}
                    height={chartRows.length > 8 ? 56 : 28}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: c.tickFill }}
                    tickFormatter={(v) => formatUsdCompact(Number(v))}
                    width={48}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0]?.payload as (typeof chartRows)[0] &
                        Record<string, number>;
                      return (
                        <div className={c.tooltipShell}>
                          <div className={c.tooltipTitle}>
                            {String(label)}
                          </div>
                          {showIncome ? (
                            <div className={c.incomeLine}>
                              Income: {formatUsd(row.income)}
                            </div>
                          ) : null}
                          {purchasesBarIsStacked ? (
                            <>
                              {purchasesStackModel.segments
                                .map((seg) => ({
                                  name: seg.displayName,
                                  value: Number(row[seg.dataKey] ?? 0),
                                  color: seg.color,
                                }))
                                .filter((x) => x.value > 0)
                                .sort((a, b) => b.value - a.value)
                                .map((line) => (
                                  <div
                                    key={line.name}
                                    className="mt-1 flex items-center justify-between gap-3 text-[11px] tabular-nums"
                                  >
                                    <span className="flex min-w-0 items-center gap-1.5">
                                      <span
                                        className="h-2 w-2 shrink-0 rounded-sm"
                                        style={{
                                          backgroundColor: line.color,
                                        }}
                                        aria-hidden
                                      />
                                      <span className="min-w-0 truncate text-zinc-600 dark:text-zinc-300">
                                        {line.name}
                                      </span>
                                    </span>
                                    <span className="shrink-0 text-zinc-900 dark:text-zinc-100">
                                      {formatUsd(line.value)}
                                    </span>
                                  </div>
                                ))}
                              <div className={c.spendLine}>
                                Purchases &amp; bills (total):{" "}
                                {formatUsd(row.spending)}
                              </div>
                            </>
                          ) : (
                            <div className={c.spendLine}>
                              Purchases &amp; bills: {formatUsd(row.spending)}
                            </div>
                          )}
                          <p className={c.tooltipFooter}>
                            Click a bar for transactions
                          </p>
                        </div>
                      );
                    }}
                  />
                  {showIncome ? (
                    <Bar
                      dataKey="income"
                      name="Income"
                      fill={c.barIncome}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={28}
                      style={{ cursor: "pointer" }}
                      onClick={(item) => {
                        const row = item?.payload as (typeof chartRows)[0];
                        if (!row?.start || !row?.end) return;
                        setOverviewBarDrilldown({
                          kind: "income",
                          bucket: bucketFromBarRow(row),
                        });
                      }}
                    />
                  ) : null}
                  {purchasesBarIsStacked ? (
                    purchasesStackModel.segments.map((seg, idx) => (
                      <Bar
                        key={seg.dataKey}
                        dataKey={seg.dataKey}
                        name={seg.displayName}
                        stackId="purchases"
                        fill={seg.color}
                        radius={
                          idx === purchasesStackModel.segments.length - 1
                            ? [4, 4, 0, 0]
                            : [0, 0, 0, 0]
                        }
                        maxBarSize={28}
                        style={{ cursor: "pointer" }}
                        onClick={(item) => {
                          const row = item?.payload as (typeof chartRows)[0];
                          if (!row?.start || !row?.end) return;
                          setOverviewBarDrilldown({
                            kind: "purchases",
                            bucket: bucketFromBarRow(row),
                          });
                        }}
                      />
                    ))
                  ) : (
                    <Bar
                      dataKey="spending"
                      name="Purchases & bills"
                      fill={c.barSpend}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={28}
                      style={{ cursor: "pointer" }}
                      onClick={(item) => {
                        const row = item?.payload as (typeof chartRows)[0];
                        if (!row?.start || !row?.end) return;
                        setOverviewBarDrilldown({
                          kind: "purchases",
                          bucket: bucketFromBarRow(row),
                        });
                      }}
                    />
                  )}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {hasBarData ? (
            <div className="mt-2 space-y-1 text-center text-[11px] text-zinc-500 dark:text-zinc-400">
              <p>
                Click a bar to list and edit the transactions in that period.
              </p>
              {purchasesBarIsStacked ? (
                <p>
                  Blue stacks use household category colors (top{" "}
                  {CATEGORY_BREAKDOWN_TOP_N} by total spend in this view, rest in
                  &quot;Other&quot;). Same rules as the solid blue bar.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 space-y-2 border-t border-zinc-100 pt-4 text-sm dark:border-zinc-800">
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-600 dark:bg-emerald-500"
                  aria-hidden
                />
                Income
              </span>
              <span className="tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                {formatUsd(displayIncome)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full bg-blue-600 dark:bg-blue-500"
                  aria-hidden
                />
                Purchases &amp; bills
              </span>
              <span className="tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                {formatUsd(displaySpending)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-zinc-100 pt-2 dark:border-zinc-800">
              <span className="text-zinc-600 dark:text-zinc-400">Difference (income − purchases)</span>
              <span
                className={
                  displayDifference >= 0
                    ? "tabular-nums font-semibold text-emerald-700 dark:text-emerald-400"
                    : "tabular-nums font-semibold text-red-700 dark:text-red-400"
                }
              >
                {displayDifference >= 0 ? "+" : ""}
                {formatUsd(displayDifference)}
              </span>
            </div>
          </div>
        </section>

        {showWeeklyBudgetTable ? (
          <DashboardWeeklyBudgetTable
            categories={categories}
            transactions={transactions}
            monthStart={catRangeStart}
            monthEnd={catRangeEnd}
            monthLabel={categoryPeriodTitle}
            onCategoryDrilldown={openWeeklyBudgetCategoryDrilldown}
          />
        ) : null}
        </div>

        {/* Spending by category */}
        <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                <span>Spending by category</span>
                <span className="group relative inline-flex">
                  <button
                    type="button"
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-400/90 bg-zinc-100/90 text-[10px] font-semibold italic leading-none text-zinc-600 outline-none hover:border-zinc-500 hover:bg-zinc-200/90 hover:text-zinc-800 focus-visible:ring-2 focus-visible:ring-violet-500/40 dark:border-zinc-500 dark:bg-zinc-800/80 dark:text-zinc-300 dark:hover:border-zinc-400 dark:hover:bg-zinc-700/90 dark:hover:text-zinc-100"
                    aria-label="How spending by category works"
                  >
                    i
                  </button>
                  <span
                    role="tooltip"
                    className="invisible absolute left-0 top-full z-[100] mt-1.5 w-[min(calc(100vw-2rem),22rem)] rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-xs font-normal leading-snug text-zinc-700 opacity-0 shadow-lg transition-opacity duration-100 pointer-events-none group-hover:visible group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:visible group-focus-within:pointer-events-auto group-focus-within:opacity-100 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200"
                  >
                    The table and chart use the{" "}
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {bucketSelectLabel(granularity)}
                    </span>{" "}
                    selected above (not the full {heading.toLowerCase()} window).
                    Open{" "}
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      Categories in table
                    </span>{" "}
                    to choose which categories appear. Defaults check every{" "}
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      Purchases &amp; bills
                    </span>{" "}
                    category (totals match the stacked blue bar); uncheck any of
                    them to hide. Other categories use full dashboard spending
                    rules when checked (still excluding{" "}
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      Transfer
                    </span>{" "}
                    and payment-style categories such as{" "}
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      Credit Card Payment
                    </span>
                    ). Click a row for details. Recategorize on{" "}
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      Transactions
                    </span>
                    .
                  </span>
                </span>
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {categoryPeriodTitle}
                </span>
                <span className="text-zinc-400 dark:text-zinc-600"> · </span>
                {heading}
              </p>
            </div>
            {chartRows.length > 0 ? (
              <div className="flex w-full shrink-0 flex-col gap-3 sm:w-auto sm:flex-row sm:items-end sm:justify-end">
                <div className="min-w-0 sm:min-w-[200px]">
                  <label
                    htmlFor="category-period-bucket"
                    className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                  >
                    {bucketSelectLabel(granularity)}
                  </label>
                  <select
                    id="category-period-bucket"
                    value={
                      categoryBucketKey ??
                      chartRows[chartRows.length - 1]!.key
                    }
                    onChange={(e) => setCategoryBucketKey(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-500 dark:focus:ring-zinc-500/25"
                  >
                    {chartRows.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.label}
                        {r.spending > 0
                          ? ` (${formatUsd(r.spending)} spent)`
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div
                  className="relative min-w-0 sm:min-w-[220px]"
                  ref={breakdownPickerRef}
                >
                  <span
                    id="category-breakdown-picker-label"
                    className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                  >
                    Categories in table
                  </span>
                  <button
                    type="button"
                    id="category-breakdown-picker-trigger"
                    aria-expanded={breakdownPickerOpen}
                    aria-haspopup="listbox"
                    aria-labelledby="category-breakdown-picker-label"
                    onClick={() => setBreakdownPickerOpen((o) => !o)}
                    className="mt-1 flex w-full items-center justify-between gap-2 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-left text-sm text-zinc-900 shadow-sm outline-none hover:bg-zinc-50 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900 dark:focus:border-zinc-500 dark:focus:ring-zinc-500/25"
                  >
                    <span className="min-w-0 truncate">
                      {breakdownSelectedIds.size}{" "}
                      {breakdownSelectedIds.size === 1
                        ? "category"
                        : "categories"}{" "}
                      selected
                    </span>
                    <span className="shrink-0 text-zinc-400" aria-hidden>
                      {breakdownPickerOpen ? "▲" : "▼"}
                    </span>
                  </button>
                  {breakdownSelectionOverride != null ? (
                    <button
                      type="button"
                      onClick={() => setBreakdownSelectionOverride(null)}
                      className="mt-1 text-[11px] font-medium text-violet-600 hover:text-violet-800 dark:text-violet-400 dark:hover:text-violet-200"
                    >
                      Reset to defaults
                    </button>
                  ) : null}
                  {breakdownPickerOpen ? (
                    <div
                      className="absolute right-0 z-[80] mt-1 max-h-72 w-[min(100%,20rem)] overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-950"
                      role="listbox"
                      aria-multiselectable="true"
                    >
                      {breakdownPickerCategoriesSorted.map((c) => (
                        <label
                          key={c.id}
                          className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
                        >
                          <input
                            type="checkbox"
                            checked={breakdownSelectedIds.has(c.id)}
                            onChange={() =>
                              toggleBreakdownCategoryVisible(c.id)
                            }
                            className="rounded border-zinc-300 dark:border-zinc-600 dark:bg-zinc-900"
                          />
                          <span className="min-w-0 flex-1 truncate text-zinc-800 dark:text-zinc-200">
                            {formatCategoryLabel(c, categories)}
                          </span>
                        </label>
                      ))}
                      {!hasUncategorizedCatalogCategory ? (
                        <label
                          className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
                        >
                          <input
                            type="checkbox"
                            checked={breakdownSelectedIds.has(
                              BREAKDOWN_UNCATEGORIZED_ID,
                            )}
                            onChange={() =>
                              toggleBreakdownCategoryVisible(
                                BREAKDOWN_UNCATEGORIZED_ID,
                              )
                            }
                            className="rounded border-zinc-300 dark:border-zinc-600 dark:bg-zinc-900"
                          />
                          <span className="text-zinc-800 dark:text-zinc-200">
                            Uncategorized
                          </span>
                        </label>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {chartRows.length === 0 ? (
            <p className="mt-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              Overview period data is not available yet.
            </p>
          ) : (
            <div className="mt-4 flex flex-col gap-6">
              <div className="relative mx-auto w-full max-w-[240px] shrink-0">
                <div className="min-h-[220px] h-[220px] w-full min-w-0">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={58}
                        outerRadius={82}
                        paddingAngle={1}
                        className="cursor-pointer outline-none"
                        onClick={(_, index) => {
                          const slice = pieData[index];
                          if (slice?.row) openMonthlyCategoryDrilldown(slice.row);
                        }}
                      >
                        {pieData.map((entry, i) => (
                          <Cell key={`${entry.name}-${i}`} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={tipStyle}
                        formatter={(value) =>
                          formatUsd(
                            typeof value === "number"
                              ? value
                              : Number.parseFloat(String(value ?? 0)),
                          )
                        }
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Total
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {formatUsd(categoryPeriodTotalSpending)}
                  </span>
                </div>
              </div>

              <div className="min-w-0 w-full rounded-lg border border-zinc-200 bg-zinc-50/50 dark:border-zinc-700 dark:bg-zinc-950/50">
                <table className="w-full table-fixed border-collapse text-left text-[11px] leading-tight sm:text-xs">
                  <colgroup>
                    {hasCategoryBudgets ? (
                      <>
                        <col className="w-[26%]" />
                        <col className="w-[19%]" />
                        <col className="w-[10%]" />
                        <col className="w-[22.5%]" />
                        <col className="w-[22.5%]" />
                      </>
                    ) : (
                      <>
                        <col className="w-[48%]" />
                        <col className="w-[26%]" />
                        <col className="w-[26%]" />
                      </>
                    )}
                  </colgroup>
                  <thead>
                    <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                      <th className="pb-2 pl-1.5 pr-1 text-left font-medium sm:pl-2 sm:pr-2">
                        Category
                      </th>
                      <th className="pb-2 pr-1 text-right font-medium sm:pr-2">
                        Spent
                      </th>
                      <th
                        className="pb-2 pr-1 text-right font-medium sm:pr-2"
                        title="Percent of total spending"
                      >
                        %
                      </th>
                      {hasCategoryBudgets ? (
                        <>
                          <th className="pb-2 pr-1 text-right font-medium sm:pr-2">
                            Budget
                          </th>
                          <th className="pb-2 pr-1 text-right font-medium sm:pr-2">
                            Left
                          </th>
                        </>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {categoryTableGroups.map((group) => {
                      if (group.kind === "single") {
                        const r = group.row;
                        const mb = monthlyBudgetForSpendRow(r);
                        return (
                          <tr
                            key={r.categoryId ?? r.name}
                            className="cursor-pointer border-b border-zinc-100 outline-none last:border-b-0 transition-colors hover:bg-zinc-100/80 focus-visible:bg-zinc-100/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-400 dark:border-zinc-800 dark:hover:bg-zinc-800/60 dark:focus-visible:bg-zinc-800/60 dark:focus-visible:outline-zinc-500"
                            tabIndex={0}
                            role="button"
                            onClick={() => openMonthlyCategoryDrilldown(r)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openMonthlyCategoryDrilldown(r);
                              }
                            }}
                            aria-label={`View ${r.name} spending by period`}
                          >
                            <td className="min-w-0 py-1.5 pl-1.5 pr-1 font-medium text-zinc-900 sm:py-2 sm:pl-2 sm:pr-2 dark:text-zinc-100">
                              <span className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full"
                                  style={{ backgroundColor: r.color }}
                                  aria-hidden
                                />
                                <span className="min-w-0 truncate" title={r.name}>
                                  {r.name}
                                </span>
                              </span>
                            </td>
                            <td className="whitespace-nowrap py-1.5 pr-1 text-right tabular-nums text-zinc-800 sm:py-2 sm:pr-2 dark:text-zinc-100">
                              {formatUsd(r.amount)}
                            </td>
                            <td className="py-1.5 pr-1 text-right tabular-nums text-zinc-600 sm:py-2 sm:pr-2 dark:text-zinc-200">
                              {categoryPeriodTotalSpending > 0
                                ? `${((r.amount / categoryPeriodTotalSpending) * 100).toFixed(1)}%`
                                : "—"}
                            </td>
                            {hasCategoryBudgets ? (
                              <>
                                <td className="whitespace-nowrap py-1.5 pr-1 text-right tabular-nums text-zinc-600 sm:py-2 sm:pr-2 dark:text-zinc-200">
                                  {mb != null ? formatUsd(mb) : "—"}
                                </td>
                                <td
                                  className={`whitespace-nowrap py-1.5 pr-1 text-right tabular-nums sm:py-2 sm:pr-2 ${
                                    mb == null
                                      ? "text-zinc-500 dark:text-zinc-500"
                                      : mb - r.amount >= 0
                                        ? "text-emerald-700 dark:text-emerald-400"
                                        : "text-red-700 dark:text-red-400"
                                  }`}
                                >
                                  {mb != null ? formatUsd(mb - r.amount) : "—"}
                                </td>
                              </>
                            ) : null}
                          </tr>
                        );
                      }

                      const collapsed = collapsedParentIds.has(group.parentId);
                      const rollup = group.rollup;
                      const mbRoll = rollupMonthlyBudget(group);
                      return (
                        <Fragment key={group.parentId}>
                          <tr
                            className="cursor-pointer border-b border-zinc-100 outline-none transition-colors hover:bg-zinc-100/80 focus-visible:bg-zinc-100/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-400 dark:border-zinc-800 dark:hover:bg-zinc-800/60 dark:focus-visible:bg-zinc-800/60 dark:focus-visible:outline-zinc-500"
                            tabIndex={0}
                            role="button"
                            onClick={() => openMonthlyCategoryDrilldown(rollup)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openMonthlyCategoryDrilldown(rollup);
                              }
                            }}
                            aria-expanded={!collapsed}
                            aria-label={`View ${rollup.name} spending by period`}
                          >
                            <td className="min-w-0 py-1.5 pl-1.5 pr-1 font-medium text-zinc-900 sm:py-2 sm:pl-2 sm:pr-2 dark:text-zinc-100">
                              <span className="flex min-w-0 items-center gap-1 sm:gap-1.5">
                                <button
                                  type="button"
                                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-200/80 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                                  aria-label={
                                    collapsed
                                      ? "Show subcategories"
                                      : "Hide subcategories"
                                  }
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleParentCollapsed(group.parentId);
                                  }}
                                >
                                  <span
                                    className={`inline-block text-xs transition-transform ${
                                      collapsed ? "" : "rotate-90"
                                    }`}
                                    aria-hidden
                                  >
                                    ▶
                                  </span>
                                </button>
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full"
                                  style={{ backgroundColor: rollup.color }}
                                  aria-hidden
                                />
                                <span
                                  className="min-w-0 truncate"
                                  title={rollup.name}
                                >
                                  {rollup.name}
                                </span>
                              </span>
                            </td>
                            <td className="whitespace-nowrap py-1.5 pr-1 text-right tabular-nums text-zinc-800 sm:py-2 sm:pr-2 dark:text-zinc-100">
                              {formatUsd(rollup.amount)}
                            </td>
                            <td className="py-1.5 pr-1 text-right tabular-nums text-zinc-600 sm:py-2 sm:pr-2 dark:text-zinc-200">
                              {categoryPeriodTotalSpending > 0
                                ? `${((rollup.amount / categoryPeriodTotalSpending) * 100).toFixed(1)}%`
                                : "—"}
                            </td>
                            {hasCategoryBudgets ? (
                              <>
                                <td className="whitespace-nowrap py-1.5 pr-1 text-right tabular-nums text-zinc-600 sm:py-2 sm:pr-2 dark:text-zinc-200">
                                  {mbRoll != null ? formatUsd(mbRoll) : "—"}
                                </td>
                                <td
                                  className={`whitespace-nowrap py-1.5 pr-1 text-right tabular-nums sm:py-2 sm:pr-2 ${
                                    mbRoll == null
                                      ? "text-zinc-500 dark:text-zinc-500"
                                      : mbRoll - rollup.amount >= 0
                                        ? "text-emerald-700 dark:text-emerald-400"
                                        : "text-red-700 dark:text-red-400"
                                  }`}
                                >
                                  {mbRoll != null
                                    ? formatUsd(mbRoll - rollup.amount)
                                    : "—"}
                                </td>
                              </>
                            ) : null}
                          </tr>
                          {!collapsed &&
                            group.subs.map((sub) => {
                              const mbSub = monthlyBudgetForSpendRow(sub);
                              const label = shortSubcategoryLabel(sub.name);
                              return (
                                <tr
                                  key={sub.categoryId ?? sub.name}
                                  className="cursor-pointer border-b border-zinc-100 bg-zinc-50/60 outline-none last:border-b-0 transition-colors hover:bg-zinc-100/80 focus-visible:bg-zinc-100/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-400 dark:border-zinc-800 dark:bg-zinc-950/40 dark:hover:bg-zinc-800/60 dark:focus-visible:bg-zinc-800/60 dark:focus-visible:outline-zinc-500"
                                  tabIndex={0}
                                  role="button"
                                  onClick={() =>
                                    openMonthlyCategoryDrilldown(sub)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      openMonthlyCategoryDrilldown(sub);
                                    }
                                  }}
                                  aria-label={`View ${sub.name} spending by period`}
                                >
                                  <td className="min-w-0 py-1.5 pl-1.5 pr-1 text-zinc-800 sm:py-2 sm:pl-10 sm:pr-2 dark:text-zinc-200">
                                    <span className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                                      <span
                                        className="h-2 w-2 shrink-0 rounded-full"
                                        style={{ backgroundColor: sub.color }}
                                        aria-hidden
                                      />
                                      <span
                                        className="min-w-0 truncate text-[11px] font-normal sm:text-xs"
                                        title={sub.name}
                                      >
                                        {label}
                                      </span>
                                    </span>
                                  </td>
                                  <td className="whitespace-nowrap py-1.5 pr-1 text-right tabular-nums text-zinc-800 sm:py-2 sm:pr-2 dark:text-zinc-100">
                                    {formatUsd(sub.amount)}
                                  </td>
                                  <td className="py-1.5 pr-1 text-right tabular-nums text-zinc-600 sm:py-2 sm:pr-2 dark:text-zinc-200">
                                    {categoryPeriodTotalSpending > 0
                                      ? `${((sub.amount / categoryPeriodTotalSpending) * 100).toFixed(1)}%`
                                      : "—"}
                                  </td>
                                  {hasCategoryBudgets ? (
                                    <>
                                      <td className="whitespace-nowrap py-1.5 pr-1 text-right tabular-nums text-zinc-600 sm:py-2 sm:pr-2 dark:text-zinc-200">
                                        {mbSub != null ? formatUsd(mbSub) : "—"}
                                      </td>
                                      <td
                                        className={`whitespace-nowrap py-1.5 pr-1 text-right tabular-nums sm:py-2 sm:pr-2 ${
                                          mbSub == null
                                            ? "text-zinc-500 dark:text-zinc-500"
                                            : mbSub - sub.amount >= 0
                                              ? "text-emerald-700 dark:text-emerald-400"
                                              : "text-red-700 dark:text-red-400"
                                        }`}
                                      >
                                        {mbSub != null
                                          ? formatUsd(mbSub - sub.amount)
                                          : "—"}
                                      </td>
                                    </>
                                  ) : null}
                                </tr>
                              );
                            })}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-zinc-300 bg-zinc-100/90 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900/90 dark:text-zinc-100">
                      <td className="py-2 pl-1.5 pr-1 font-semibold sm:pl-2 sm:pr-2">
                        Total
                      </td>
                      <td className="whitespace-nowrap py-2 pr-1 text-right tabular-nums font-semibold sm:pr-2">
                        {formatUsd(spendingByCategoryTableFooter.spent)}
                      </td>
                      <td className="py-2 pr-1 text-right tabular-nums text-zinc-500 dark:text-zinc-400 sm:pr-2">
                        —
                      </td>
                      {hasCategoryBudgets ? (
                        <>
                          <td className="whitespace-nowrap py-2 pr-1 text-right tabular-nums font-semibold text-zinc-800 dark:text-zinc-200 sm:pr-2">
                            {spendingByCategoryTableFooter.budget != null
                              ? formatUsd(spendingByCategoryTableFooter.budget)
                              : "—"}
                          </td>
                          <td
                            className={`whitespace-nowrap py-2 pr-1 text-right tabular-nums font-semibold sm:pr-2 ${
                              spendingByCategoryTableFooter.left == null
                                ? "text-zinc-500 dark:text-zinc-500"
                                : spendingByCategoryTableFooter.left >= 0
                                  ? "text-emerald-800 dark:text-emerald-300"
                                  : "text-red-800 dark:text-red-300"
                            }`}
                          >
                            {spendingByCategoryTableFooter.left != null
                              ? formatUsd(spendingByCategoryTableFooter.left)
                              : "—"}
                          </td>
                        </>
                      ) : null}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <div className="flex flex-col gap-3 border-b border-zinc-100 pb-4 dark:border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Category spending over time
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Track household categories (same rules as &quot;Spending by
              category&quot; — excludes transfers and credit-card payment
              categories). Choose timeframe, period length, and which lines to
              plot.
            </p>
          </div>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="min-w-0">
                <span
                  id="category-trend-timeframe-label"
                  className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                >
                  Timeframe
                </span>
                <div
                  className="mt-1 flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-zinc-100/80 p-1 dark:border-zinc-700 dark:bg-zinc-900/90"
                  role="group"
                  aria-labelledby="category-trend-timeframe-label"
                >
                  {OVERVIEW_RANGE_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      aria-pressed={categoryTrendRangeMode === opt.id}
                      onClick={() => setCategoryTrendRangeMode(opt.id)}
                      className={
                        categoryTrendRangeMode === opt.id
                          ? "rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100 dark:shadow-black/20"
                          : "rounded-md px-3 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="min-w-0">
                <span
                  id="category-trend-period-label"
                  className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                >
                  Period
                </span>
                <div
                  className="mt-1 flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-zinc-100/80 p-1 dark:border-zinc-700 dark:bg-zinc-900/90"
                  role="group"
                  aria-labelledby="category-trend-period-label"
                >
                  {GRANULARITIES.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      aria-pressed={categoryTrendGranularity === g.id}
                      onClick={() => setCategoryTrendGranularity(g.id)}
                      className={
                        categoryTrendGranularity === g.id
                          ? "rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100 dark:shadow-black/20"
                          : "rounded-md px-3 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                      }
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="min-w-0">
                <span
                  id="category-trend-view-label"
                  className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                >
                  View
                </span>
                <label
                  className="mt-1 flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-200"
                  htmlFor="category-trend-stacked"
                >
                  <input
                    id="category-trend-stacked"
                    type="checkbox"
                    checked={categoryTrendStacked}
                    onChange={(e) =>
                      setCategoryTrendStacked(e.target.checked)
                    }
                    className="rounded border-zinc-300 dark:border-zinc-600 dark:bg-zinc-900"
                  />
                  <span>
                    Stack lines (cumulative)
                    <span className="mt-0.5 block text-[10px] font-normal text-zinc-500 dark:text-zinc-400">
                      Top of stack = sum of selected categories
                    </span>
                  </span>
                </label>
              </div>
            </div>
            <div className="w-full shrink-0 lg:max-w-md">
              <div className="flex items-center justify-between gap-2">
                <span
                  id="category-trend-pick-label"
                  className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                >
                  Categories (max {CATEGORY_TREND_MAX_LINES})
                </span>
                {selectedTrendSeriesKeys.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setSelectedTrendSeriesKeys([])}
                    className="text-[11px] font-medium text-violet-600 hover:text-violet-800 dark:text-violet-400 dark:hover:text-violet-200"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
              <div
                className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50/80 px-2 py-2 dark:border-zinc-700 dark:bg-zinc-950/50"
                role="group"
                aria-labelledby="category-trend-pick-label"
              >
                {trendPickerGroups.length === 0 ? (
                  <p className="px-1 text-xs text-zinc-500 dark:text-zinc-400">
                    No categories yet — add some under Settings.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {trendPickerGroups.map((group, gIdx) => {
                      if (group.kind === "leaf") {
                        const seriesKey = trendSeriesKeyName(group.displayName);
                        const checked =
                          selectedTrendSeriesKeys.includes(seriesKey);
                        const atCap =
                          selectedTrendSeriesKeys.length >=
                            CATEGORY_TREND_MAX_LINES && !checked;
                        const swatch =
                          group.color ??
                          CATEGORY_TREND_COLOR_FALLBACK[
                            gIdx % CATEGORY_TREND_COLOR_FALLBACK.length
                          ]!;
                        return (
                          <li key={`leaf-${group.displayName}`}>
                            <label
                              className={`flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/80 ${
                                atCap ? "cursor-not-allowed opacity-50" : ""
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={atCap}
                                onChange={() => toggleTrendSeriesKey(seriesKey)}
                                className="rounded border-zinc-300 dark:border-zinc-600 dark:bg-zinc-900"
                              />
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: swatch }}
                                aria-hidden
                              />
                              <span className="min-w-0 truncate text-zinc-800 dark:text-zinc-200">
                                {group.displayName}
                              </span>
                            </label>
                          </li>
                        );
                      }

                      const subtreeKey = trendSeriesKeySubtree(group.parentId);
                      const subtreeChecked =
                        selectedTrendSeriesKeys.includes(subtreeKey);
                      const subsHidden = collapsedTrendParents.has(
                        group.parentId,
                      );
                      const parentSwatch =
                        group.color ??
                        CATEGORY_TREND_COLOR_FALLBACK[
                          gIdx % CATEGORY_TREND_COLOR_FALLBACK.length
                        ]!;

                      return (
                        <li key={group.parentId} className="space-y-0.5">
                          <div className="flex items-start gap-0.5">
                            <button
                              type="button"
                              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-200/80 dark:text-zinc-400 dark:hover:bg-zinc-800"
                              aria-expanded={!subsHidden}
                              aria-label={
                                subsHidden
                                  ? "Show subcategories"
                                  : "Hide subcategories"
                              }
                              onClick={() =>
                                toggleCollapsedTrendParent(group.parentId)
                              }
                            >
                              <span
                                className={`inline-block text-[10px] transition-transform ${
                                  subsHidden ? "" : "rotate-90"
                                }`}
                                aria-hidden
                              >
                                ▶
                              </span>
                            </button>
                            <label
                              className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/80 ${
                                selectedTrendSeriesKeys.length >=
                                  CATEGORY_TREND_MAX_LINES && !subtreeChecked
                                  ? "cursor-not-allowed opacity-50"
                                  : ""
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={subtreeChecked}
                                disabled={
                                  selectedTrendSeriesKeys.length >=
                                    CATEGORY_TREND_MAX_LINES && !subtreeChecked
                                }
                                onChange={() =>
                                  toggleTrendSeriesKey(subtreeKey)
                                }
                                className="rounded border-zinc-300 dark:border-zinc-600 dark:bg-zinc-900"
                              />
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: parentSwatch }}
                                aria-hidden
                              />
                              <span className="min-w-0 truncate font-medium text-zinc-800 dark:text-zinc-200">
                                {group.parentName}
                                <span className="font-normal text-zinc-500 dark:text-zinc-400">
                                  {" "}
                                  (total)
                                </span>
                              </span>
                            </label>
                          </div>
                          {!subsHidden ? (
                            <ul className="ml-6 space-y-0.5 border-l border-zinc-200 pl-2 dark:border-zinc-700">
                              {group.subs.map((sub) => {
                                const sk = trendSeriesKeyName(sub.displayName);
                                const subChecked =
                                  selectedTrendSeriesKeys.includes(sk);
                                const atCap =
                                  selectedTrendSeriesKeys.length >=
                                    CATEGORY_TREND_MAX_LINES && !subChecked;
                                const subSwatch =
                                  sub.color ??
                                  CATEGORY_TREND_COLOR_FALLBACK[
                                    gIdx % CATEGORY_TREND_COLOR_FALLBACK.length
                                  ]!;
                                return (
                                  <li key={sub.id}>
                                    <label
                                      className={`flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/80 ${
                                        atCap
                                          ? "cursor-not-allowed opacity-50"
                                          : ""
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={subChecked}
                                        disabled={atCap}
                                        onChange={() =>
                                          toggleTrendSeriesKey(sk)
                                        }
                                        className="rounded border-zinc-300 dark:border-zinc-600 dark:bg-zinc-900"
                                      />
                                      <span
                                        className="h-2 w-2 shrink-0 rounded-full"
                                        style={{ backgroundColor: subSwatch }}
                                        aria-hidden
                                      />
                                      <span className="min-w-0 truncate text-zinc-700 dark:text-zinc-300">
                                        {shortSubcategoryLabel(sub.displayName)}
                                      </span>
                                    </label>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>

        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {categoryTrendHeading}
          </span>
          {selectedTrendSeriesKeys.length > 0 ? (
            <>
              <span className="text-zinc-400 dark:text-zinc-600"> · </span>
              {selectedTrendSeriesKeys.length} line
              {selectedTrendSeriesKeys.length !== 1 ? "s" : ""} selected
              {categoryTrendStacked ? (
                <>
                  <span className="text-zinc-400 dark:text-zinc-600"> · </span>
                  stacked cumulative
                </>
              ) : null}
            </>
          ) : null}
        </p>

        <div className="mt-4 h-[280px] w-full min-w-0">
          {!hasAnyTx ? (
            <p className="flex h-full items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
              Add transactions to use this chart.
            </p>
          ) : selectedTrendSeriesKeys.length === 0 ? (
            <p className="flex h-full items-center justify-center px-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
              Select one or more categories above to plot spending by period.
            </p>
          ) : categoryTrendBuckets.length === 0 ? (
            <p className="flex h-full items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
              No periods in this timeframe.
            </p>
          ) : !hasCategoryTrendSeriesData ? (
            <p className="flex h-full items-center justify-center px-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
              No spending in this window for the selected categories.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              {categoryTrendStacked ? (
                <AreaChart
                  data={categoryTrendChartData}
                  margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={c.gridStroke}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: c.tickFill }}
                    interval={0}
                    angle={categoryTrendChartData.length > 8 ? -35 : 0}
                    textAnchor={
                      categoryTrendChartData.length > 8 ? "end" : "middle"
                    }
                    height={categoryTrendChartData.length > 8 ? 56 : 28}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: c.tickFill }}
                    tickFormatter={(v) => formatUsdCompact(Number(v))}
                    width={48}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0]?.payload as Record<
                        string,
                        string | number
                      >;
                      const segments = selectedTrendSeriesKeys.map(
                        (seriesKey, idx) => ({
                          key: seriesKey,
                          label: trendLegendLabel(seriesKey, categories),
                          value: Number(row[`ct${idx}`] ?? 0),
                          color: trendColorForSeriesKey(
                            seriesKey,
                            idx,
                            categories,
                          ),
                        }),
                      );
                      const total = segments.reduce((s, x) => s + x.value, 0);
                      const lines = segments
                        .filter((x) => x.value > 0)
                        .sort((a, b) => b.value - a.value);
                      return (
                        <div className={c.tooltipShell}>
                          <div className={c.tooltipTitle}>
                            {String(label)}
                          </div>
                          {lines.map((line) => (
                            <div
                              key={line.key}
                              className="mt-1 flex items-center justify-between gap-3 text-[11px] tabular-nums"
                            >
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full"
                                  style={{ backgroundColor: line.color }}
                                  aria-hidden
                                />
                                <span className="min-w-0 truncate text-zinc-600 dark:text-zinc-300">
                                  {line.label}
                                </span>
                              </span>
                              <span className="shrink-0 text-zinc-900 dark:text-zinc-100">
                                {formatUsd(line.value)}
                              </span>
                            </div>
                          ))}
                          {selectedTrendSeriesKeys.length > 1 ? (
                            <div className="mt-2 flex items-center justify-between gap-3 border-t border-zinc-200 pt-2 text-[11px] font-semibold tabular-nums dark:border-zinc-600">
                              <span className="text-zinc-700 dark:text-zinc-200">
                                Cumulative total
                              </span>
                              <span className="text-zinc-900 dark:text-zinc-100">
                                {formatUsd(total)}
                              </span>
                            </div>
                          ) : null}
                          <p className={c.tooltipFooter}>
                            Stacked areas sum to the top line (total spend).
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                    formatter={(value) => (
                      <span className="text-zinc-700 dark:text-zinc-300">
                        {value}
                      </span>
                    )}
                  />
                  {selectedTrendSeriesKeys.map((seriesKey, idx) => {
                    const stroke = trendColorForSeriesKey(
                      seriesKey,
                      idx,
                      categories,
                    );
                    return (
                      <Area
                        key={seriesKey}
                        type="monotone"
                        dataKey={`ct${idx}`}
                        name={trendLegendLabel(seriesKey, categories)}
                        stackId="categoryTrendStack"
                        stroke={stroke}
                        fill={stroke}
                        fillOpacity={isDark ? 0.35 : 0.42}
                        strokeWidth={1.25}
                        isAnimationActive={false}
                      />
                    );
                  })}
                </AreaChart>
              ) : (
                <LineChart
                  data={categoryTrendChartData}
                  margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={c.gridStroke}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: c.tickFill }}
                    interval={0}
                    angle={categoryTrendChartData.length > 8 ? -35 : 0}
                    textAnchor={
                      categoryTrendChartData.length > 8 ? "end" : "middle"
                    }
                    height={categoryTrendChartData.length > 8 ? 56 : 28}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: c.tickFill }}
                    tickFormatter={(v) => formatUsdCompact(Number(v))}
                    width={48}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0]?.payload as Record<
                        string,
                        string | number
                      >;
                      const segments = selectedTrendSeriesKeys.map(
                        (seriesKey, idx) => ({
                          key: seriesKey,
                          label: trendLegendLabel(seriesKey, categories),
                          value: Number(row[`ct${idx}`] ?? 0),
                          color: trendColorForSeriesKey(
                            seriesKey,
                            idx,
                            categories,
                          ),
                        }),
                      );
                      const lines = segments
                        .filter((x) => x.value > 0)
                        .sort((a, b) => b.value - a.value);
                      return (
                        <div className={c.tooltipShell}>
                          <div className={c.tooltipTitle}>
                            {String(label)}
                          </div>
                          {lines.map((line) => (
                            <div
                              key={line.key}
                              className="mt-1 flex items-center justify-between gap-3 text-[11px] tabular-nums"
                            >
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full"
                                  style={{ backgroundColor: line.color }}
                                  aria-hidden
                                />
                                <span className="min-w-0 truncate text-zinc-600 dark:text-zinc-300">
                                  {line.label}
                                </span>
                              </span>
                              <span className="shrink-0 text-zinc-900 dark:text-zinc-100">
                                {formatUsd(line.value)}
                              </span>
                            </div>
                          ))}
                          <p className={c.tooltipFooter}>
                            Same inclusion as category spending table
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                    formatter={(value) => (
                      <span className="text-zinc-700 dark:text-zinc-300">
                        {value}
                      </span>
                    )}
                  />
                  {selectedTrendSeriesKeys.map((seriesKey, idx) => (
                    <Line
                      key={seriesKey}
                      type="monotone"
                      dataKey={`ct${idx}`}
                      name={trendLegendLabel(seriesKey, categories)}
                      stroke={trendColorForSeriesKey(
                        seriesKey,
                        idx,
                        categories,
                      )}
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      activeDot={{ r: 4 }}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              )}
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Bank transfers
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{heading}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
              {formatUsd(totalBankTransferVolume)}
              <span className="ml-2 text-sm font-normal text-zinc-500 dark:text-zinc-400">
                {bankTransferAccountId == null
                  ? "gross movement"
                  : bankTransferAccountLabel
                    ? `net · ${bankTransferAccountLabel}`
                    : "net for account"}
              </span>
            </p>
          </div>
          {bankTransferAccountOptions.length > 0 ? (
            <div className="min-w-0 sm:min-w-[220px]">
              <label
                htmlFor="bank-transfer-account"
                className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
              >
                Account
              </label>
              <select
                id="bank-transfer-account"
                value={bankTransferAccountId ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setBankTransferAccountId(v === "" ? null : v);
                }}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-500 dark:focus:ring-zinc-500/25"
              >
                <option value="">
                  All accounts (gross movement)
                </option>
                {bankTransferAccountOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
        <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
          {bankTransferAccountId == null ? (
            <>
              Absolute dollars moved for categories (or descriptions) classified as{" "}
              <span className="font-medium text-zinc-800 dark:text-zinc-200">Bank transfers</span>.
              {bankTransferAccountOptions.length > 0 ? (
                <>
                  {" "}
                  Use <span className="font-medium text-zinc-800 dark:text-zinc-200">Account</span>{" "}
                  above for signed bars (in vs out on that bank account).{" "}
                </>
              ) : null}
              Not part of income or purchases &amp; bills on the first chart.
            </>
          ) : (
            <>
              Signed totals on the selected account for rows classified as{" "}
              <span className="font-medium text-zinc-800 dark:text-zinc-200">Bank transfers</span>
              : positive bars are inflows, negative bars are outflows. Switch to{" "}
              <span className="font-medium text-zinc-800 dark:text-zinc-200">All accounts</span> for
              gross movement.
            </>
          )}
        </p>
        {bankTransferAccountOptions.length === 0 ? (
          <p className="mt-2 text-xs text-amber-900/90 dark:text-amber-200/85">
            Connect a bank under{" "}
            <Link
              href="/settings/bank"
              className="font-medium underline decoration-amber-700/50 underline-offset-2 hover:decoration-amber-700 dark:decoration-amber-400/40 dark:hover:decoration-amber-300"
            >
              Settings → Bank
            </Link>{" "}
            to enable the account menu and signed transfer bars.
          </p>
        ) : null}

        {!hasAnyTx ? (
          <p className="mt-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Add transactions to see transfers.
          </p>
        ) : !hasBankTransferData ? (
          <p className="mt-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {bankTransferAccountId != null
              ? "No bank transfer activity on this account in this period window."
              : "No bank transfers in this period window."}
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-start">
            <div className="min-w-0 min-h-[260px] flex-1">
              <p className="mb-2 text-center text-[11px] text-zinc-500 dark:text-zinc-400">
                Click a bar to list and edit transactions in that period.
              </p>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={bankTransferRows}
                  margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={c.gridStroke}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: c.tickFill }}
                    interval={0}
                    angle={bankTransferRows.length > 8 ? -35 : 0}
                    textAnchor={
                      bankTransferRows.length > 8 ? "end" : "middle"
                    }
                    height={bankTransferRows.length > 8 ? 56 : 28}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: c.tickFill }}
                    tickFormatter={(v) => formatUsdCompact(Number(v))}
                    width={48}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0]?.payload as (typeof bankTransferRows)[0];
                      return (
                        <div className={c.tooltipShell}>
                          <div className={c.tooltipTitle}>
                            {String(label)}
                          </div>
                          <div className={c.tooltipBody}>
                            {bankTransferAccountId == null
                              ? `Volume: ${formatUsd(row.volume)}`
                              : `Net: ${formatUsd(row.volume)}`}
                          </div>
                          <p className={c.tooltipFooter}>
                            Click bar for transactions
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="volume"
                    name={
                      bankTransferAccountId == null
                        ? "Transfer volume"
                        : "Net transfers"
                    }
                    fill={isDark ? "#94a3b8" : "#64748b"}
                    radius={[4, 4, 4, 4]}
                    maxBarSize={28}
                    style={{ cursor: "pointer" }}
                    onClick={(item) => {
                      const row = item?.payload as (typeof bankTransferRows)[0];
                      if (!row?.start || !row?.end) return;
                      setOverviewBarDrilldown({
                        kind: "bank_transfers",
                        bucket: bucketFromBarRow(row),
                        accountId: bankTransferAccountId,
                        accountLabel: bankTransferAccountLabel,
                      });
                    }}
                  >
                    {bankTransferAccountId != null
                      ? bankTransferRows.map((r) => (
                          <Cell
                            key={r.key}
                            fill={
                              r.volume >= 0
                                ? isDark
                                  ? "#34d399"
                                  : "#059669"
                                : isDark
                                  ? "#f87171"
                                  : "#dc2626"
                            }
                          />
                        ))
                      : null}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="min-w-0 shrink-0 lg:w-[min(100%,380px)]">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                By period
              </h3>
              <div className="mt-2 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700 dark:bg-zinc-950/90">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-400">
                      <th className="px-3 py-2 font-medium">Period</th>
                      <th className="px-3 py-2 text-right font-medium">
                        {bankTransferAccountId == null ? "Volume" : "Net"}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...bankTransferRows]
                      .reverse()
                      .map((r) => (
                        <tr
                          key={r.key}
                          className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800"
                        >
                          <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
                            {r.label}
                          </td>
                          <td
                            className={`px-3 py-2 text-right tabular-nums ${
                              bankTransferAccountId != null && r.volume > 0
                                ? "text-emerald-700 dark:text-emerald-400"
                                : bankTransferAccountId != null && r.volume < 0
                                  ? "text-red-600 dark:text-red-400"
                                  : "text-zinc-800 dark:text-zinc-200"
                            }`}
                          >
                            {bankTransferAccountId == null
                              ? r.volume > 0
                                ? formatUsd(r.volume)
                                : "—"
                              : r.volume !== 0
                                ? formatUsd(r.volume)
                                : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Credit card payments
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{heading}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
              {formatUsd(totalCreditCardPayments)}
              <span className="ml-2 text-sm font-normal text-zinc-500 dark:text-zinc-400">
                paid to cards
              </span>
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
          Outflows that pay your card from the bank (including the{" "}
          <span className="font-medium text-zinc-800 dark:text-zinc-200">Credit card payment</span>{" "}
          category and matching uncategorized lines). Omitted from spending
          above so card purchases are not double-counted.
        </p>

        {!hasAnyTx ? (
          <p className="mt-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Add transactions to see card payments.
          </p>
        ) : !hasCreditCardPaymentData ? (
          <p className="mt-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No credit card payments in this period window.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-start">
            <div className="min-w-0 min-h-[260px] flex-1">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={creditCardPaymentRows}
                  margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke={c.gridStroke}
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: c.tickFill }}
                      interval={0}
                      angle={creditCardPaymentRows.length > 8 ? -35 : 0}
                      textAnchor={
                        creditCardPaymentRows.length > 8 ? "end" : "middle"
                      }
                      height={creditCardPaymentRows.length > 8 ? 56 : 28}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: c.tickFill }}
                      tickFormatter={(v) => formatUsdCompact(Number(v))}
                      width={48}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const row = payload[0]?.payload as (typeof creditCardPaymentRows)[0];
                        return (
                          <div className={c.tooltipShell}>
                            <div className={c.tooltipTitle}>
                              {String(label)}
                            </div>
                            <div className={c.tooltipOrange}>
                              Paid: {formatUsd(row.amount)}
                            </div>
                            <p className={c.tooltipFooter}>
                              Click bar for transactions
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Bar
                      dataKey="amount"
                      name="Paid to card"
                      fill={isDark ? "#f97316" : "#c2410c"}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={28}
                      style={{ cursor: "pointer" }}
                      onClick={(item) => {
                        const row = item?.payload as (typeof creditCardPaymentRows)[0];
                        if (!row?.start || !row?.end) return;
                        setOverviewBarDrilldown({
                          kind: "credit_card_payments",
                          bucket: bucketFromBarRow(row),
                        });
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
            </div>
            <div className="min-w-0 shrink-0 lg:w-[min(100%,380px)]">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                By period
              </h3>
              <div className="mt-2 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700 dark:bg-zinc-950/90">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-400">
                      <th className="px-3 py-2 font-medium">Period</th>
                      <th className="px-3 py-2 text-right font-medium">
                        Paid to card
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...creditCardPaymentRows]
                      .reverse()
                      .map((r) => (
                        <tr
                          key={r.key}
                          className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800"
                        >
                          <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
                            {r.label}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-zinc-800 dark:text-zinc-200">
                            {r.amount > 0 ? formatUsd(r.amount) : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </section>

      {customPrimaryGroups.map((g) => {
        const rows = customPrimaryChartRows.get(g.slug) ?? [];
        const hasData = rows.some((r) => r.amount !== 0);
        const totalNet = rows.reduce((s, r) => s + r.amount, 0);
        const fill = g.color || "#6366f1";
        return (
          <section
            key={g.id}
            className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{g.name}</h2>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{heading}</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatUsd(totalNet)}
                  <span className="ml-2 text-sm font-normal text-zinc-500 dark:text-zinc-400">
                    net (signed)
                  </span>
                </p>
              </div>
            </div>
            <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
              Custom primary category: signed net total per period (credits minus
              debits).
            </p>
            {!hasAnyTx ? (
              <p className="mt-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                Add transactions to see this chart.
              </p>
            ) : !hasData ? (
              <p className="mt-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                No activity in this period window.
              </p>
            ) : (
              <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-start">
                <div className="min-w-0 min-h-[260px] flex-1">
                  <p className="mb-2 text-center text-[11px] text-zinc-500 dark:text-zinc-400">
                    Click a bar to list and edit transactions in that period.
                  </p>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart
                      data={rows}
                      margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke={c.gridStroke}
                      />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: c.tickFill }}
                        interval={0}
                        angle={rows.length > 8 ? -35 : 0}
                        textAnchor={rows.length > 8 ? "end" : "middle"}
                        height={rows.length > 8 ? 56 : 28}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: c.tickFill }}
                        tickFormatter={(v) => formatUsdCompact(Number(v))}
                        width={48}
                      />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          const row = payload[0]?.payload as (typeof rows)[0];
                          return (
                            <div className={c.tooltipShell}>
                              <div className={c.tooltipTitle}>
                                {String(label)}
                              </div>
                              <div className={c.tooltipBody}>
                                Net: {formatUsd(row.amount)}
                              </div>
                              <p className={c.tooltipFooter}>
                                Click bar for transactions
                              </p>
                            </div>
                          );
                        }}
                      />
                      <Bar
                        dataKey="amount"
                        name={g.name}
                        fill={fill}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={28}
                        style={{ cursor: "pointer" }}
                        onClick={(item) => {
                          const row = item?.payload as (typeof rows)[0];
                          if (!row?.start || !row?.end) return;
                          setOverviewBarDrilldown({
                            kind: "primary",
                            bucket: bucketFromBarRow(row),
                            slug: g.slug,
                            title: g.name,
                            barColor: g.color,
                          });
                        }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="min-w-0 shrink-0 lg:w-[min(100%,380px)]">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    By period
                  </h3>
                  <div className="mt-2 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700 dark:bg-zinc-950/90">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-400">
                          <th className="px-3 py-2 font-medium">Period</th>
                          <th className="px-3 py-2 text-right font-medium">Net</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...rows]
                          .reverse()
                          .map((r) => (
                            <tr
                              key={r.key}
                              className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800"
                            >
                              <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
                                {r.label}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-zinc-800 dark:text-zinc-200">
                                {r.amount !== 0 ? formatUsd(r.amount) : "—"}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </section>
        );
      })}

      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Period and chart options
          </p>
          <div
            className="flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-zinc-100/80 p-1 dark:border-zinc-700 dark:bg-zinc-900/90"
            role="tablist"
            aria-label="Time period"
          >
            {GRANULARITIES.map((g) => (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={granularity === g.id}
                onClick={() => setGranularity(g.id)}
                className={
                  granularity === g.id
                    ? "rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100 dark:shadow-black/20"
                    : "rounded-md px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                }
              >
                {g.label}
              </button>
            ))}
          </div>
          <div
            className="flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-zinc-100/80 p-1 dark:border-zinc-700 dark:bg-zinc-900/90"
            role="tablist"
            aria-label="Overview range"
          >
            {OVERVIEW_RANGE_OPTIONS.map((r) => (
              <button
                key={r.id}
                type="button"
                role="tab"
                aria-selected={overviewRangeMode === r.id}
                onClick={() => setOverviewRangeMode(r.id)}
                className={
                  overviewRangeMode === r.id
                    ? "rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100 dark:shadow-black/20"
                    : "rounded-md px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                }
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Charts group transactions by{" "}
          <Link
            href="/settings/categories"
            className="font-medium text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-900 dark:text-violet-400 dark:decoration-violet-600 dark:hover:text-violet-200"
          >
            primary category
          </Link>{" "}
          (Income, Bank transfers, Purchases &amp; bills, Credit card payments,
          or your own). The first chart is{" "}
          <span className="font-medium text-zinc-800 dark:text-zinc-200">income</span> vs{" "}
          <span className="font-medium text-zinc-800 dark:text-zinc-200">purchases &amp; bills</span>{" "}
          only. Positive inflows that look like account-to-account moves are
          treated as transfers, not income, until you categorize them. Fine-tune
          what counts as income with{" "}
          <Link
            href="/settings/rules"
            className="font-medium text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-900 dark:text-violet-400 dark:decoration-violet-600 dark:hover:text-violet-200"
          >
            income rules
          </Link>{" "}
          and per-row tags.
        </p>
      </div>

      {drilldownCategory ? (
        <DashboardCategoryDrilldownPanel
          key={`${drilldownCategory.name}-${categoryBucketKey ?? ""}-${drilldownCategory.drilldownSpendingMode ?? "pb"}-${breakdownSelectionKey}`}
          householdId={householdId}
          categories={categories}
          category={drilldownCategory}
          series={drilldownSeries}
          overviewHeading={drilldownAggregateLabel}
          rangeStart={catRangeStart}
          rangeEnd={catRangeEnd}
          transactions={transactions}
          preferredPeriodBucketKey={categoryBucketKey}
          spendingBreakdownMode={
            drilldownCategory.drilldownSpendingMode ?? "purchases_bills"
          }
          onClose={() => setDrilldownCategory(null)}
        />
      ) : null}

      {weeklyBudgetDrilldown ? (
        <DashboardCategoryDrilldownPanel
          key={`wbd-${weeklyBudgetDrilldown.category.name}-${weeklyBudgetDrilldown.weekStart}`}
          householdId={householdId}
          categories={categories}
          category={weeklyBudgetDrilldown.category}
          series={weeklyBudgetDrilldownSeries}
          overviewHeading={`${categoryPeriodTitle} · ${weeklyBudgetDrilldown.weekLabel}`}
          rangeStart={weeklyBudgetDrilldown.weekStart}
          rangeEnd={weeklyBudgetDrilldown.weekEnd}
          transactions={transactions}
          onClose={() => setWeeklyBudgetDrilldown(null)}
        />
      ) : null}

      {overviewBarDrilldown ? (
        <DashboardOverviewBarDrilldownPanel
          key={
            overviewBarDrilldown.kind === "primary"
              ? `${overviewBarDrilldown.kind}-${overviewBarDrilldown.slug}-${overviewBarDrilldown.bucket.key}`
              : `${overviewBarDrilldown.kind}-${overviewBarDrilldown.bucket.key}`
          }
          householdId={householdId}
          categories={categories}
          transactions={transactions}
          spec={overviewBarDrilldown}
          incomeRules={incomeRules}
          onClose={() => setOverviewBarDrilldown(null)}
        />
      ) : null}
    </div>
  );
}
