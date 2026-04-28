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
    barIncome: isDark ? "#22c55e" : "#16a34a",
    barSpend: isDark ? "#3b82f6" : "#2563eb",
  };
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
