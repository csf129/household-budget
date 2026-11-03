import type { CSSProperties } from "react";

/**
 * Recharts does not read Tailwind; use these with `useTheme().resolvedTheme`.
 */
export function getChartAxisTheme(isDark: boolean) {
  return {
    gridStroke: isDark ? "#3f3f46" : "#e4e4e7",
    tickFill: isDark ? "#a1a1aa" : "#71717a",
    tooltipShell:
      "rounded-lg border px-3 py-2 text-xs shadow-lg " +
      (isDark
        ? "border-zinc-600 bg-zinc-900 text-zinc-100 shadow-black/50"
        : "border-zinc-200 bg-white text-zinc-900 shadow-md"),
    tooltipTitle: isDark ? "font-medium text-zinc-50" : "font-medium text-zinc-900",
    tooltipBody: isDark ? "mt-1 text-zinc-300" : "mt-1 text-zinc-700",
    tooltipOrange: isDark ? "mt-1 text-orange-300" : "mt-1 text-orange-800",
    tooltipFooter:
      "mt-1.5 border-t pt-1.5 text-[10px] " +
      (isDark ? "border-zinc-700 text-zinc-400" : "border-zinc-100 text-zinc-500"),
    incomeLine: isDark ? "mt-1 text-emerald-400" : "mt-1 text-emerald-700",
    spendLine: isDark ? "mt-1 text-sky-400" : "mt-1 text-blue-700",
    // Data-series colors, aligned with the Hearth app's calm, earthy palette
    // (mobile/src/shared/theme.js in the Hearth repo), tuned per theme so they
    // stay legible on both the light and dark chart surfaces. Income stays a
    // green and spend a blue so existing legends/captions still read true.
    barIncome: isDark ? "#89a98f" : "#4a6b57",
    barSpend: isDark ? "#6aa0c2" : "#3f6f8a",
    /** Net line (income − spend): Hearth's clay accent. */
    netLine: isDark ? "#c0896a" : "#8a5a44",
    /** Average reference line: Hearth's muted gold. */
    avgLine: isDark ? "#d0a74e" : "#b8913a",
    /** Budget reference line: Hearth's muted plum (distinct from the others). */
    budgetLine: isDark ? "#a284b2" : "#7a5c8a",
  };
}

/**
 * Hearth's earthy categorical palette (the `SWATCHES` from the Hearth app's
 * mobile/src/shared/theme.js). Used to color per-category bars so the report
 * reads like the rest of the family's apps. Theme-independent: each swatch is a
 * mid-tone that works on both light and dark chart surfaces.
 */
export const HEARTH_SWATCHES = [
  "#4a6b57", "#6d8a72", "#2f7a6a", "#5c8a7a",
  "#3f6f8a", "#4a7fa8", "#7a5c8a", "#9a6f9e",
  "#c25b7c", "#a8502f", "#c07a3e", "#b8913a",
  "#8a5a44", "#8a7a5c", "#5d6b73", "#6b6b6b",
] as const;

/** Stable Hearth swatch for a category name (deterministic hash → palette). */
export function hearthColorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return HEARTH_SWATCHES[h % HEARTH_SWATCHES.length]!;
}

/** Default Recharts `<Tooltip contentStyle={...} />` for pie and built-in tooltips. */
export function getRechartsTooltipStyle(isDark: boolean): CSSProperties {
  return isDark
    ? {
        backgroundColor: "#18181b",
        border: "1px solid #52525b",
        borderRadius: 8,
        color: "#fafafa",
        fontSize: 12,
        boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.45)",
      }
    : {
        backgroundColor: "#ffffff",
        border: "1px solid #e4e4e7",
        borderRadius: 8,
        color: "#171717",
        fontSize: 12,
      };
}
