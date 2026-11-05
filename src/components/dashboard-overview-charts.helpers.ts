import {
  bucketsForGranularity,
  type PeriodBucket,
  type PeriodGranularity,
} from "@/lib/dashboard-analytics";
import { formatCategoryLabel } from "@/lib/category-display";
import type { CategoryRow, TransactionRow } from "@/types/finance";

/**
 * Pure helpers, constants, and types extracted verbatim from
 * dashboard-overview-charts.tsx to keep that component focused on rendering.
 * No React, no side effects — safe to unit-test in isolation.
 */

export const GRANULARITIES: { id: PeriodGranularity; label: string }[] = [
  { id: "month", label: "Monthly" },
  { id: "quarter", label: "Quarterly" },
  { id: "year", label: "Yearly" },
  { id: "ytd", label: "Year to date" },
];

export type OverviewRangeMode = "last12" | "all";

export const OVERVIEW_RANGE_OPTIONS: { id: OverviewRangeMode; label: string }[] = [
  { id: "last12", label: "Last 12 months" },
  { id: "all", label: "All history" },
];

export const CATEGORY_TREND_MAX_LINES = 12;

export const CATEGORY_TREND_COLOR_FALLBACK = [
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
export function trendSeriesKeyName(displayName: string): string {
  return `n:${encodeURIComponent(displayName)}`;
}

export function trendSeriesKeySubtree(parentId: string): string {
  return `s:${parentId}`;
}

export function parseTrendSeriesKey(
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

export function trendLegendLabel(key: string, categories: CategoryRow[]): string {
  const p = parseTrendSeriesKey(key);
  if (p.type === "subtree") {
    const cat = categories.find((c) => c.id === p.parentId);
    return cat ? `${cat.name.trim()} (total)` : "Category (total)";
  }
  return p.name;
}

export function trendColorForSeriesKey(
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

export type TrendPickerLeaf = {
  kind: "leaf";
  displayName: string;
  color: string | null;
};

export type TrendPickerParent = {
  kind: "parent";
  parentId: string;
  /** Short name for the parent row (subtree total line). */
  parentName: string;
  color: string | null;
  subs: { id: string; displayName: string; color: string | null }[];
};

export type TrendPickerGroup = TrendPickerLeaf | TrendPickerParent;

export function parseIsoMonth(isoDate: string): { y: number; m: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const y = Number.parseInt(isoDate.slice(0, 4), 10);
  const m = Number.parseInt(isoDate.slice(5, 7), 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  return { y, m };
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function monthEnd(y: number, m: number): string {
  const d = new Date(y, m, 0).getDate();
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function monthLabel(y: number, m: number): string {
  return new Date(y, m - 1, 1).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
  });
}

export function quarterOfMonth(m: number): number {
  return Math.floor((m - 1) / 3) + 1;
}

export function quarterBounds(y: number, q: number): { start: string; end: string } {
  const startM = (q - 1) * 3 + 1;
  const endM = q * 3;
  return {
    start: `${y}-${pad2(startM)}-01`,
    end: monthEnd(y, endM),
  };
}

export function bucketsForAllHistory(
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

export function bucketFromBarRow(row: {
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

export function bucketSelectLabel(g: PeriodGranularity): string {
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

export type BankAccountPickerRow = { id: string; name: string };
