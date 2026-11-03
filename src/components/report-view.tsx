"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "next-themes";
import {
  Bar,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getChartAxisTheme, hearthColorFor } from "@/lib/chart-palette";
import { formatUsd, formatUsdCompact } from "@/lib/money";
import type {
  BudgetChange,
  ReportCategorySeries,
  ReportData,
  ReportFeedback,
  ReportTransaction,
  ReportTransactionsPayload,
  SavingsAnalysis,
  SavingsEffort,
} from "@/types/report";

/** Props Recharts passes to a custom `dot` renderer (only the bits we use). */
type DotRenderProps = { cx?: number; cy?: number; index?: number; [k: string]: unknown };

const BILL_HINTS = [
  "electric",
  "gas",
  "propane",
  "water",
  "power",
  "utility",
  "utilities",
  "internet",
  "phone",
  "cable",
  "insurance",
  "subscription",
  "streaming",
  "membership",
];
const CAR_HINTS = ["gas", "fuel", "auto", "car", "vehicle", "insurance", "dmv", "registration"];

const matchesAny = (name: string, hints: string[]) => {
  const n = name.toLowerCase();
  return hints.some((h) => n.includes(h));
};

const MONTH_OPTIONS = [3, 6, 12];

function Card({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {title}
        </h2>
        {right}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function DirectionBadge({ direction }: { direction: ReportCategorySeries["direction"] }) {
  const map = {
    up: { label: "↑ up", cls: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300" },
    down: {
      label: "↓ down",
      cls: "bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-300",
    },
    flat: { label: "→ flat", cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
  } as const;
  const { label, cls } = map[direction];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">{value}</div>
      {sub ? <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{sub}</div> : null}
    </div>
  );
}

function deltaSub(current: number, avg: number): React.ReactNode {
  if (avg <= 0) return null;
  const pct = Math.round(((current - avg) / avg) * 100);
  const up = pct > 0;
  const cls = up ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400";
  if (pct === 0) return <span className="text-zinc-500">vs avg {formatUsd(avg)}</span>;
  return (
    <span className={cls}>
      {up ? "↑" : "↓"} {Math.abs(pct)}% vs avg {formatUsd(avg)}
    </span>
  );
}

function CategoryList({ rows }: { rows: ReportCategorySeries[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">No matching spending.</p>;
  }
  const max = Math.max(...rows.map((r) => r.current), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.name}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate font-medium text-zinc-800 dark:text-zinc-200">{r.name}</span>
            <span className="flex items-center gap-2 whitespace-nowrap">
              <span className="text-zinc-900 dark:text-zinc-100">{formatUsd(r.current)}</span>
              <DirectionBadge direction={r.direction} />
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full"
                style={{ width: `${(r.current / max) * 100}%`, backgroundColor: r.color }}
              />
            </div>
            <span className="w-28 text-right text-xs text-zinc-500 dark:text-zinc-400">
              {r.trailingAvg > 0 ? `avg ${formatUsd(r.trailingAvg)}` : "no history"}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

const EFFORT_META: Record<
  SavingsEffort,
  { label: string; badge: string; bar: string }
> = {
  easy: {
    label: "Easy win",
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
    bar: "bg-emerald-500",
  },
  medium: {
    label: "Medium effort",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
    bar: "bg-amber-500",
  },
  hard: {
    label: "Heavier lift",
    badge: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
    bar: "bg-rose-500",
  },
};

/** Build the category→note lookup the editors read from. "" = general note. */
function notesFromFeedback(feedback: ReportFeedback[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const f of feedback ?? []) {
    const note = f.note.trim();
    if (note) map[f.category] = note;
  }
  return map;
}

type SaveNote = (category: string, note: string) => Promise<void>;

/**
 * Add / edit / clear a household note for one category (or the general note
 * when `category` is ""). Notes persist and feed back into future AI analysis.
 */
function NoteEditor({
  category,
  value,
  onSave,
  addLabel = "Add a note",
  placeholder = "Add context for your assistant — e.g. a fixed commitment, a plan already in motion, or a correction.",
}: {
  category: string;
  value: string;
  onSave: SaveNote;
  addLabel?: string;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // `draft` seeds from `value` on mount. When the saved value changes
  // externally (a save completes, or the month switches), the parent remounts
  // this editor via a `key` tied to `value`, so there's no setState-in-effect
  // sync to do here.

  const save = async (next: string) => {
    setSaving(true);
    setErr(null);
    try {
      await onSave(category, next);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    if (value) {
      return (
        <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2 dark:border-violet-900/50 dark:bg-violet-950/30">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 whitespace-pre-wrap break-words text-sm text-violet-900 dark:text-violet-100">
              <span aria-hidden className="mr-1">📝</span>
              {value}
            </p>
            <button
              type="button"
              onClick={() => {
                setDraft(value);
                setEditing(true);
              }}
              className="shrink-0 text-xs font-medium text-violet-700 hover:underline dark:text-violet-300"
            >
              Edit
            </button>
          </div>
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={() => {
          setDraft("");
          setEditing(true);
        }}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:underline dark:text-violet-300"
      >
        + {addLabel}
      </button>
    );
  }

  return (
    <div className="mt-3">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        rows={3}
        maxLength={1000}
        autoFocus
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
      {err ? (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">
          {err}
        </p>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => save(draft)}
          disabled={saving}
          className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save note"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setDraft(value);
            setErr(null);
          }}
          disabled={saving}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => save("")}
            disabled={saving}
            className="ml-auto text-xs font-medium text-red-600 hover:underline disabled:opacity-60 dark:text-red-400"
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SavingsAnalysisView({
  analysis,
  notes,
  onSaveNote,
}: {
  analysis: SavingsAnalysis;
  notes: Record<string, string>;
  onSaveNote: SaveNote;
}) {
  const { opportunities, totalMonthlySaving, headline, shortlist } = analysis;
  const maxSaving = Math.max(...opportunities.map((o) => o.estMonthlySaving), 1);

  return (
    <div className="space-y-5">
      {/* Headline + total potential */}
      <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-5 dark:border-violet-900/50 dark:from-violet-950/40 dark:to-zinc-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-md text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">
            {headline}
          </p>
          <div className="shrink-0 sm:text-right">
            <div className="text-xs font-medium uppercase tracking-wide text-violet-600 dark:text-violet-300">
              Potential savings
            </div>
            <div className="mt-0.5 text-3xl font-semibold text-violet-700 dark:text-violet-200">
              {formatUsd(totalMonthlySaving)}
              <span className="text-base font-normal text-violet-500 dark:text-violet-300">/mo</span>
            </div>
            <div className="text-xs text-violet-500/80 dark:text-violet-300/80">
              ≈ {formatUsd(totalMonthlySaving * 12)} a year
            </div>
          </div>
        </div>
      </div>

      {/* Ranked opportunities */}
      <ol className="space-y-3">
        {opportunities.map((o, i) => {
          const meta = EFFORT_META[o.effort];
          const over = o.current - o.avg;
          return (
            <li
              key={`${o.category}-${i}`}
              className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/60"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {o.category}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.badge}`}>
                        {meta.label}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      Now {formatUsd(o.current)} vs {formatUsd(o.avg)} avg
                      {over > 0 ? (
                        <span className="text-red-500 dark:text-red-400">
                          {" "}
                          · {formatUsd(over)} over
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                    {formatUsd(o.estMonthlySaving)}
                  </div>
                  <div className="text-[11px] uppercase tracking-wide text-zinc-400">saves / mo</div>
                </div>
              </div>

              {/* Proportional savings bar */}
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className={`h-full rounded-full ${meta.bar}`}
                  style={{ width: `${Math.max(4, (o.estMonthlySaving / maxSaving) * 100)}%` }}
                />
              </div>

              {o.action ? (
                <p className="mt-3 flex gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                  <span aria-hidden className="text-violet-500">
                    →
                  </span>
                  <span>{o.action}</span>
                </p>
              ) : null}

              <NoteEditor
                key={`${o.category}:${notes[o.category] ?? ""}`}
                category={o.category}
                value={notes[o.category] ?? ""}
                onSave={onSaveNote}
                addLabel={`Add a note about ${o.category}`}
                placeholder={`e.g. why ${o.category} can't change right now, or what you're already doing about it.`}
              />
            </li>
          );
        })}
      </ol>

      {/* Do these first */}
      {shortlist.length > 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Do these first
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {shortlist.map((s) => (
              <span
                key={s}
                className="rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-700 dark:bg-violet-950/60 dark:text-violet-200"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The budget line's legend entry on a plot, which doubles as an inline editor
 * for household heads when the budget is a simple flat monthly amount.
 */
function BudgetEditor({
  categoryId,
  value,
  editable,
  canEdit,
  color,
  onSaved,
}: {
  categoryId: string | null;
  value: number | null;
  editable: boolean;
  canEdit: boolean;
  color: string;
  onSaved: (next: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value != null ? String(value) : "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const swatch = (
    <span
      aria-hidden
      className="inline-block h-0 w-4 shrink-0 border-t-2"
      style={{ borderColor: color }}
    />
  );

  const canInlineEdit = canEdit && editable && categoryId != null;

  const save = async (next: number | null) => {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/household/report/budget", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId, monthlyBudget: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
      onSaved((json.monthlyBudget ?? null) as number | null);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    const parsed = Number(draft.replace(/[$,\s]/g, ""));
    const valid = draft.trim() === "" || Number.isFinite(parsed);
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {swatch}
        <span className="text-zinc-500 dark:text-zinc-400">Budget $</span>
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
          placeholder="0"
          className="w-20 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs text-zinc-800 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <button
          type="button"
          disabled={saving || !valid}
          onClick={() => save(draft.trim() === "" ? null : Math.max(0, parsed))}
          className="rounded bg-violet-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setEditing(false);
            setDraft(value != null ? String(value) : "");
            setErr(null);
          }}
          className="rounded px-1.5 py-0.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
        {value != null ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => save(null)}
            className="text-xs font-medium text-red-600 hover:underline disabled:opacity-60 dark:text-red-400"
          >
            Clear
          </button>
        ) : null}
        {err ? <span className="text-xs text-red-600 dark:text-red-400">{err}</span> : null}
      </span>
    );
  }

  if (value != null) {
    return (
      <span className="inline-flex items-center gap-1.5">
        {swatch}
        <span>budget {formatUsd(value)}</span>
        {canInlineEdit ? (
          <button
            type="button"
            onClick={() => {
              setDraft(String(value));
              setEditing(true);
            }}
            className="font-medium text-violet-600 hover:underline dark:text-violet-300"
          >
            Edit
          </button>
        ) : canEdit && !editable ? (
          <span className="text-zinc-400">· edit in Settings</span>
        ) : null}
      </span>
    );
  }

  // No budget set.
  if (canInlineEdit) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft("");
          setEditing(true);
        }}
        className="inline-flex items-center gap-1 font-medium text-violet-600 hover:underline dark:text-violet-300"
      >
        + Set a monthly budget
      </button>
    );
  }
  return null;
}

/**
 * One category's monthly spend as bars, plus a dashed average line across the
 * window. Each month has a clickable circle on the average line: click it to
 * drop that month from the average (and re-add it). Clicking a bar asks the
 * parent to open that month's transactions.
 */
function CategoryPlot({
  category,
  months,
  onBarClick,
  canEditBudget,
}: {
  category: ReportCategorySeries;
  months: ReportData["months"];
  onBarClick: (monthKey: string) => void;
  canEditBudget: boolean;
}) {
  // Month indices the user excluded from the average (outliers).
  const [excluded, setExcluded] = useState<Set<number>>(() => new Set());
  // The currently-set monthly budget, kept local so an inline edit updates the
  // line immediately without refetching the whole report.
  const [budgetValue, setBudgetValue] = useState<number | null>(
    category.monthlyBudget != null ? Math.round(category.monthlyBudget) : null,
  );

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const c = useMemo(() => getChartAxisTheme(isDark), [isDark]);

  const series = category.series;
  const includedValues = series.filter((_, i) => !excluded.has(i));
  const average =
    includedValues.length > 0
      ? includedValues.reduce((a, b) => a + b, 0) / includedValues.length
      : 0;

  // Drawn as a flat reference line when a positive budget is set.
  const budget = budgetValue != null && budgetValue > 0 ? budgetValue : null;

  const chartData = months.map((m, i) => ({
    label: m.label.replace(/ \d{4}$/, ""),
    fullLabel: m.label,
    key: m.key,
    spend: Math.round(series[i] ?? 0),
    avg: Math.round(average),
    budget,
    idx: i,
    off: excluded.has(i),
  }));

  const toggle = (i: number) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const color = hearthColorFor(category.name);
  // Hollow fill for an excluded dot: match the card background so the solid
  // ring reads as "empty" in both themes.
  const dotHollowFill = isDark ? "#18181b" : "#ffffff";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
      <div className="flex items-baseline justify-between gap-2">
        <h3
          className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100"
          title={category.name}
        >
          {category.name}
        </h3>
        <div className="shrink-0 text-right text-xs text-zinc-500 dark:text-zinc-400">
          avg{" "}
          <span className="font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
            {formatUsd(average)}
          </span>
          {excluded.size > 0 ? (
            <span className="text-zinc-400"> · {excluded.size} excluded</span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 h-56 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={c.gridStroke} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: c.tickFill }} interval={0} />
            <YAxis
              tick={{ fontSize: 11, fill: c.tickFill }}
              tickFormatter={(v) => formatUsdCompact(Number(v))}
              width={48}
            />
            <Tooltip
              cursor={{ fill: c.gridStroke, fillOpacity: 0.3 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]?.payload as (typeof chartData)[number] | undefined;
                if (!row) return null;
                return (
                  <div className={c.tooltipShell}>
                    <div className={c.tooltipTitle}>{row.fullLabel}</div>
                    <div className={c.tooltipOrange}>Average: {formatUsd(average)}</div>
                    <div className={c.tooltipBody}>
                      Spend: {formatUsd(row.spend)}
                      {row.off ? " · excluded from avg" : ""}
                    </div>
                    {row.budget != null ? (
                      <div className="mt-1" style={{ color: c.budgetLine }}>
                        Budget: {formatUsd(row.budget)}
                      </div>
                    ) : null}
                    <p className={c.tooltipFooter}>Click a bar for its transactions</p>
                  </div>
                );
              }}
            />
            <Bar
              dataKey="spend"
              name="Spend"
              radius={[4, 4, 0, 0]}
              maxBarSize={36}
              style={{ cursor: "pointer" }}
            >
              {chartData.map((d) => (
                <Cell
                  key={d.key}
                  fill={color}
                  fillOpacity={d.off ? 0 : 0.28}
                  stroke={color}
                  strokeWidth={1.5}
                  onClick={() => onBarClick(d.key)}
                />
              ))}
            </Bar>
            {budget != null ? (
              <Line
                dataKey="budget"
                name="Budget"
                stroke={c.budgetLine}
                strokeWidth={2}
                isAnimationActive={false}
                dot={false}
                activeDot={false}
              />
            ) : null}
            <Line
              dataKey="avg"
              name="Average"
              stroke={c.avgLine}
              strokeWidth={2}
              strokeDasharray="5 4"
              isAnimationActive={false}
              activeDot={false}
              dot={(props: DotRenderProps) => {
                const { cx, cy, index } = props;
                const i = index ?? -1;
                if (cx == null || cy == null) return <g key={`d${i}`} />;
                const off = excluded.has(i);
                return (
                  <g key={`d${i}`}>
                    {/* larger invisible hit target for easier clicking */}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={11}
                      fill="transparent"
                      style={{ cursor: "pointer" }}
                      onClick={() => toggle(i)}
                    />
                    <circle
                      cx={cx}
                      cy={cy}
                      r={5}
                      fill={off ? dotHollowFill : c.avgLine}
                      stroke={c.avgLine}
                      strokeWidth={2}
                      style={{ cursor: "pointer" }}
                      onClick={() => toggle(i)}
                    />
                  </g>
                );
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
        <span className="inline-flex items-center gap-1">
          <span
            aria-hidden
            className="inline-block h-0 w-4 border-t-2 border-dashed"
            style={{ borderColor: c.avgLine }}
          />
          average — click a point to include/exclude a month
        </span>
        <BudgetEditor
          categoryId={category.categoryId ?? null}
          value={budgetValue}
          editable={category.budgetEditableInline ?? false}
          canEdit={canEditBudget}
          color={c.budgetLine}
          onSaved={setBudgetValue}
        />
        <span>click a bar for its transactions</span>
      </div>
    </div>
  );
}

/** Modal listing the transactions behind one category/month bar. */
function TransactionsModal({
  category,
  monthLabel,
  transactions,
  onClose,
}: {
  category: string;
  monthLabel: string;
  transactions: ReportTransaction[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const total = transactions.reduce((a, t) => a + t.amount, 0);
  const sorted = [...transactions].sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1));

  return createPortal(
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${category} transactions for ${monthLabel}`}
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-zinc-900 dark:text-zinc-100">{category}</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {monthLabel} · {transactions.length} transaction{transactions.length === 1 ? "" : "s"} ·{" "}
              {formatUsd(total)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto">
          {sorted.length === 0 ? (
            <p className="p-4 text-sm text-zinc-500 dark:text-zinc-400">
              No transactions for this month.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {sorted.map((t, i) => (
                <li
                  key={`${t.occurredOn}-${i}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-zinc-800 dark:text-zinc-200">{t.description}</p>
                    <p className="text-xs tabular-nums text-zinc-400">{t.occurredOn}</p>
                  </div>
                  <span
                    className={`shrink-0 text-sm tabular-nums ${
                      t.amount < 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-zinc-900 dark:text-zinc-100"
                    }`}
                  >
                    {formatUsd(t.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Modal listing the household's recent monthly-budget changes (audit trail). */
function BudgetHistoryModal({ onClose }: { onClose: () => void }) {
  const [changes, setChanges] = useState<BudgetChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/household/report/budget")
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
        return json as { changes: BudgetChange[] };
      })
      .then((json) => {
        if (!cancelled) setChanges(json.changes);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fmt = (n: number | null) => (n == null ? "—" : formatUsd(n));
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso.slice(0, 10)
      : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Budget change history"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
          <div>
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Budget changes</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Who changed a monthly budget, from what to what, and when.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto">
          {error ? (
            <p className="p-4 text-sm text-red-600 dark:text-red-400" role="alert">
              Could not load history: {error}
            </p>
          ) : changes == null ? (
            <p className="p-4 text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
          ) : changes.length === 0 ? (
            <p className="p-4 text-sm text-zinc-500 dark:text-zinc-400">
              No budget changes recorded yet.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {changes.map((ch) => (
                <li key={ch.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-zinc-800 dark:text-zinc-200">
                      {ch.categoryName}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {fmtDate(ch.createdAt)}
                      {ch.changedByMe ? " · you" : ""}
                      {ch.source === "settings" ? " · Settings" : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm tabular-nums text-zinc-700 dark:text-zinc-300">
                    {fmt(ch.oldAmount)} <span className="text-zinc-400">→</span>{" "}
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {fmt(ch.newAmount)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The "Individual" tab: one plot per spending category, with a filter box and a
 * transactions drill-down. Transactions are loaded once for the window and
 * grouped client-side for instant popups.
 */
function IndividualTab({
  data,
  months,
  canEditBudget,
}: {
  data: ReportData;
  months: number;
  canEditBudget: boolean;
}) {
  const [payload, setPayload] = useState<ReportTransactionsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [popup, setPopup] = useState<{ category: string; monthKey: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // This component is remounted via `key={months}` when the window changes, so
  // initial state (loading=true, no payload) already covers the reset — the
  // effect only fetches and sets state in async callbacks (no sync setState).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/household/report/transactions?months=${months}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
        return json as ReportTransactionsPayload;
      })
      .then((json) => {
        if (!cancelled) setPayload(json);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [months]);

  // Group transactions by category + month for O(1) popup lookup. "\u0000" is a
  // safe separator (can't appear in a category name).
  const txByKey = useMemo(() => {
    const map = new Map<string, ReportTransaction[]>();
    for (const it of payload?.items ?? []) {
      const k = `${it.category}\u0000${it.monthKey}`;
      const arr = map.get(k);
      if (arr) arr.push(it);
      else map.set(k, [it]);
    }
    return map;
  }, [payload]);

  const categories = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const withSpend = data.categories.filter((c) => c.series.some((v) => v !== 0));
    return q ? withSpend.filter((c) => c.name.toLowerCase().includes(q)) : withSpend;
  }, [data.categories, filter]);

  // Window summary across ALL categories (not the filtered list): the total
  // monthly spend averaged over the window — i.e. the per-plot "avg" figures
  // added up — versus the average monthly income.
  const summary = useMemo(() => {
    const n = data.months.length || 1;
    const avgIncome = data.months.reduce((s, m) => s + m.income, 0) / n;
    const avgSpend = data.categories.reduce(
      (s, c) => s + c.series.reduce((a, b) => a + b, 0) / n,
      0,
    );
    return { n, avgIncome, avgSpend, diff: avgIncome - avgSpend };
  }, [data.months, data.categories]);

  const popupTx = popup ? txByKey.get(`${popup.category}\u0000${popup.monthKey}`) ?? [] : [];
  const popupMonthLabel = popup
    ? data.months.find((m) => m.key === popup.monthKey)?.label ?? popup.monthKey
    : "";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-sm text-zinc-500 dark:text-zinc-400">
          Each category&apos;s spend by month, with the average across the window. Click a point on
          the average line to drop or re-add a month; click a bar to see its transactions.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className="shrink-0 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Budget history
          </button>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter categories…"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 sm:w-56"
          />
        </div>
      </div>

      {/* Totals across all categories vs. average monthly income */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Avg spend · all categories"
          value={formatUsd(summary.avgSpend)}
          sub={`monthly average over ${summary.n} months`}
        />
        <Stat label="Avg monthly income" value={formatUsd(summary.avgIncome)} />
        <Stat
          label="Income − spending"
          value={formatUsd(summary.diff)}
          sub={
            <span
              className={
                summary.diff >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }
            >
              {summary.diff >= 0
                ? "left over each month on average"
                : "over income on average"}
            </span>
          }
        />
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading transactions…</p>
      ) : error ? (
        <p
          className="rounded-xl border border-red-200 bg-red-50/80 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300"
          role="alert"
        >
          Could not load transactions: {error}
        </p>
      ) : categories.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {filter.trim()
            ? "No categories match your filter."
            : "No spending categories in this window."}
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {categories.map((c) => (
            <CategoryPlot
              key={`${c.name}-${months}`}
              category={c}
              months={data.months}
              onBarClick={(monthKey) => setPopup({ category: c.name, monthKey })}
              canEditBudget={canEditBudget}
            />
          ))}
        </div>
      )}

      {popup ? (
        <TransactionsModal
          category={popup.category}
          monthLabel={popupMonthLabel}
          transactions={popupTx}
          onClose={() => setPopup(null)}
        />
      ) : null}

      {showHistory ? <BudgetHistoryModal onClose={() => setShowHistory(false)} /> : null}
    </div>
  );
}

export function ReportView({
  householdName,
  canEditBudget,
}: {
  householdName: string;
  canEditBudget: boolean;
}) {
  const [months, setMonths] = useState(6);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [insights, setInsights] = useState<SavingsAnalysis | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  const [tab, setTab] = useState<"overview" | "individual">("overview");

  // Household notes keyed by category ("" = general). Seeded from the report
  // payload and kept in sync as the user edits them.
  const [notes, setNotes] = useState<Record<string, string>>({});

  // Switching the window resets view state here (an event handler, not an
  // effect) so the fetch effect below never calls setState synchronously.
  const changeMonths = useCallback((next: number) => {
    setMonths(next);
    setLoading(true);
    setError(null);
    setData(null);
    setInsights(null);
    setInsightsError(null);
    setNotes({});
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/household/report?months=${months}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
        return json as ReportData;
      })
      .then((json) => {
        if (!cancelled) {
          setData(json);
          setNotes(notesFromFeedback(json.feedback));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [months]);

  const runInsights = useCallback(() => {
    setInsightsLoading(true);
    setInsightsError(null);
    fetch(`/api/household/report/insights?months=${months}`, { method: "POST" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
        return json as { insights: SavingsAnalysis };
      })
      .then((json) => setInsights(json.insights))
      .catch((err: unknown) =>
        setInsightsError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setInsightsLoading(false));
  }, [months]);

  // Persist a household note, then reflect it locally so the editors and the
  // next analysis stay in sync. Throws on failure so the editor can surface it.
  const saveNote = useCallback(async (category: string, note: string) => {
    const res = await fetch("/api/household/report/feedback", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, note }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
    setNotes((prev) => {
      const next = { ...prev };
      const trimmed = note.trim();
      if (trimmed) next[category] = trimmed;
      else delete next[category];
      return next;
    });
  }, []);

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const c = useMemo(() => getChartAxisTheme(isDark), [isDark]);

  const chartData = useMemo(
    () =>
      (data?.months ?? []).map((m) => ({
        label: m.label.replace(/ \d{4}$/, ""),
        fullLabel: m.label,
        income: Math.round(m.income),
        spending: Math.round(m.spending),
        net: Math.round(m.net),
      })),
    [data],
  );

  const bills = useMemo(
    () => (data?.categories ?? []).filter((c) => matchesAny(c.name, BILL_HINTS)),
    [data],
  );
  const cars = useMemo(
    () => (data?.categories ?? []).filter((c) => matchesAny(c.name, CAR_HINTS)),
    [data],
  );
  const topCategories = useMemo(() => (data?.categories ?? []).slice(0, 10), [data]);

  const monthPicker = (
    <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
      History
      <select
        value={months}
        onChange={(e) => changeMonths(Number(e.target.value))}
        className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      >
        {MONTH_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {m} months
          </option>
        ))}
      </select>
    </label>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading {householdName}&apos;s report…</p>
        {monthPicker}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50/80 p-4 text-sm dark:border-red-900/40 dark:bg-red-950/40">
        <p className="font-medium text-red-700 dark:text-red-300" role="alert">
          Could not load the report: {error}
        </p>
        <div className="mt-3">{monthPicker}</div>
      </div>
    );
  }

  if (!data) return null;

  const cur = data.months[data.currentIndex];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-100/70 p-0.5 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          {(["overview", "individual"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={`rounded-md px-3 py-1.5 font-medium capitalize transition-colors ${
                tab === t
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        {monthPicker}
      </div>

      {tab === "individual" ? (
        <IndividualTab
          key={months}
          data={data}
          months={months}
          canEditBudget={canEditBudget}
        />
      ) : (
      <div className="space-y-6">
      {/* Overview */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={`Income — ${cur?.label ?? ""}`}
          value={formatUsd(cur?.income ?? 0)}
          sub={deltaSub(cur?.income ?? 0, data.totals.avgIncome)}
        />
        <Stat
          label="Spending"
          value={formatUsd(cur?.spending ?? 0)}
          sub={deltaSub(cur?.spending ?? 0, data.totals.avgSpending)}
        />
        <Stat
          label="Net"
          value={formatUsd(cur?.net ?? 0)}
          sub={
            <span className={(cur?.net ?? 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
              {(cur?.net ?? 0) >= 0 ? "surplus" : "deficit"}
            </span>
          }
        />
        <Stat
          label="Avg monthly spend"
          value={formatUsd(data.totals.avgSpending)}
          sub={<span className="text-zinc-500">over prior {data.months.length - 1} mo</span>}
        />
      </div>

      {/* Income vs spending trend */}
      <Card title="Income vs spending">
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={c.gridStroke} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: c.tickFill }} interval={0} />
              <YAxis
                tickFormatter={(v) => formatUsdCompact(Number(v))}
                tick={{ fontSize: 11, fill: c.tickFill }}
                width={48}
              />
              <Tooltip
                cursor={{ fill: c.gridStroke, fillOpacity: 0.3 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as (typeof chartData)[number] | undefined;
                  if (!row) return null;
                  const lines = [
                    { name: "Income", value: row.income, color: c.barIncome },
                    { name: "Spending", value: row.spending, color: c.barSpend },
                    { name: "Net", value: row.net, color: c.netLine },
                  ];
                  return (
                    <div className={c.tooltipShell}>
                      <div className={c.tooltipTitle}>{row.fullLabel}</div>
                      {lines.map((l) => (
                        <div
                          key={l.name}
                          className="mt-1 flex items-center justify-between gap-3 text-[11px] tabular-nums"
                        >
                          <span className="flex items-center gap-1.5">
                            <span
                              className="h-2 w-2 shrink-0 rounded-sm"
                              style={{ backgroundColor: l.color }}
                              aria-hidden
                            />
                            <span className="text-zinc-600 dark:text-zinc-300">{l.name}</span>
                          </span>
                          <span className="text-zinc-900 dark:text-zinc-100">{formatUsd(l.value)}</span>
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="income" name="Income" fill={c.barIncome} radius={[4, 4, 0, 0]} maxBarSize={36} />
              <Bar dataKey="spending" name="Spending" fill={c.barSpend} radius={[4, 4, 0, 0]} maxBarSize={36} />
              <Line dataKey="net" name="Net" stroke={c.netLine} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Where the money goes */}
      <Card title="Where the money goes (top categories)">
        <CategoryList rows={topCategories} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Bills — up or down">
          <CategoryList rows={bills} />
        </Card>
        <Card title="Cars">
          <CategoryList rows={cars} />
        </Card>
      </div>

      {/* Credit cards */}
      <Card title="Credit cards">
        {data.creditCards.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No linked credit cards.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {data.creditCards.map((c) => {
              const util = c.utilization;
              const high = util != null && util > 0.3;
              return (
                <div
                  key={`${c.name}-${c.mask ?? ""}`}
                  className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {c.name}
                      {c.mask ? <span className="text-zinc-400"> ·•••{c.mask}</span> : null}
                    </span>
                    <span className="text-sm text-zinc-900 dark:text-zinc-100">
                      {c.balance != null ? formatUsd(c.balance) : "—"}
                    </span>
                  </div>
                  {util != null ? (
                    <div className="mt-2">
                      <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <div
                          className={`h-full rounded-full ${high ? "bg-red-500" : "bg-emerald-500"}`}
                          style={{ width: `${Math.min(100, Math.round(util * 100))}%` }}
                        />
                      </div>
                      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {Math.round(util * 100)}% utilization{high ? " — high" : ""}
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {c.paymentDueDay ? <span>Due day {c.paymentDueDay}</span> : null}
                    {c.annualFee ? <span>{formatUsd(c.annualFee)} annual fee</span> : null}
                    {c.pointsBalance != null ? (
                      <span>
                        {c.pointsBalance.toLocaleString()} {c.pointsProgram ?? "points"}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Savings */}
      <Card title="Savings plans">
        {data.savingsPlans.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No active savings plans.</p>
        ) : (
          <ul className="space-y-3">
            {data.savingsPlans.map((p) => {
              const pct = Math.min(100, Math.round(p.progress * 100));
              const behind = p.pace < 0;
              return (
                <li key={p.title}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">{p.title}</span>
                    <span className="text-zinc-900 dark:text-zinc-100">
                      {formatUsd(p.saved)} / {formatUsd(p.target)}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div className="h-full rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1 text-xs">
                    <span className={behind ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}>
                      {behind ? `behind pace by ${formatUsd(-p.pace)}` : "on or ahead of pace"}
                    </span>
                    <span className="text-zinc-400"> · target {p.targetDate}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* AI savings deep-dive */}
      <Card
        title="Where to save the most — easiest first"
        right={
          <button
            type="button"
            onClick={runInsights}
            disabled={insightsLoading}
            className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-60"
          >
            {insightsLoading ? "Analyzing…" : insights ? "Regenerate" : "Generate savings analysis"}
          </button>
        }
      >
        <div className="space-y-5">
          {insightsError ? (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {insightsError}
            </p>
          ) : insights ? (
            <SavingsAnalysisView analysis={insights} notes={notes} onSaveNote={saveNote} />
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Run your household&apos;s AI assistant over this report to get a prioritized,
              plain-English plan for where to cut spending first.
            </p>
          )}

          {/* Notes for your assistant — persisted and fed into every future run */}
          {(() => {
            const opportunityCats = new Set((insights?.opportunities ?? []).map((o) => o.category));
            const otherNotes = Object.entries(notes).filter(
              ([cat, note]) => cat !== "" && note.trim() && !opportunityCats.has(cat),
            );
            return (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Notes for your assistant
                </div>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Saved with your household and fed into every future analysis, so the plan
                  respects commitments, plans already in motion, and your corrections.
                </p>
                <NoteEditor
                  key={`general:${notes[""] ?? ""}`}
                  category=""
                  value={notes[""] ?? ""}
                  onSave={saveNote}
                  addLabel="Add a general note"
                  placeholder="e.g. We prepaid karate for 6 months, so that bill can't change until spring."
                />
                {otherNotes.length > 0 ? (
                  <div className="mt-4 space-y-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                    <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Saved notes
                    </div>
                    {otherNotes.map(([cat, note]) => (
                      <div key={cat}>
                        <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{cat}</div>
                        <NoteEditor key={note} category={cat} value={note} onSave={saveNote} />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })()}
        </div>
      </Card>
      </div>
      )}
    </div>
  );
}
