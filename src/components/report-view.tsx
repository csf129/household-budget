"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Legend,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatUsd, formatUsdCompact } from "@/lib/money";
import type {
  ReportCategorySeries,
  ReportData,
  ReportFeedback,
  SavingsAnalysis,
  SavingsEffort,
} from "@/types/report";

const INCOME_COLOR = "#16a34a";
const SPENDING_COLOR = "#7c3aed";
const NET_COLOR = "#0ea5e9";

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

export function ReportView({ householdName }: { householdName: string }) {
  const [months, setMonths] = useState(6);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [insights, setInsights] = useState<SavingsAnalysis | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);

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

  const chartData = useMemo(
    () =>
      (data?.months ?? []).map((m) => ({
        label: m.label.replace(/ \d{4}$/, ""),
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
      <div className="flex items-center justify-end">{monthPicker}</div>

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
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v) => formatUsdCompact(Number(v))} tick={{ fontSize: 12 }} width={56} />
              <Tooltip formatter={(v) => formatUsd(Number(v))} />
              <Legend />
              <Bar dataKey="income" name="Income" fill={INCOME_COLOR} radius={[3, 3, 0, 0]} />
              <Bar dataKey="spending" name="Spending" fill={SPENDING_COLOR} radius={[3, 3, 0, 0]} />
              <Line dataKey="net" name="Net" stroke={NET_COLOR} strokeWidth={2} dot={false} />
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
  );
}
