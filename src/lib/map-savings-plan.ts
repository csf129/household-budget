import type {
  SavingsIncrementPeriod,
  SavingsPlanContributionRow,
  SavingsPlanKind,
  SavingsPlanRow,
} from "@/types/finance";

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") return Number.parseFloat(v);
  return 0;
}

export function mapSavingsPlan(raw: unknown): SavingsPlanRow {
  const r = raw as Record<string, unknown>;
  const kind = r.plan_kind;
  const plan_kind: SavingsPlanKind =
    kind === "vacation" || kind === "project" ? kind : "project";
  const inc = r.increment_period;
  const validPeriods: SavingsIncrementPeriod[] = [
    "daily",
    "weekly",
    "biweekly",
    "monthly",
    "annually",
  ];
  const increment_period: SavingsIncrementPeriod | null =
    typeof inc === "string" && validPeriods.includes(inc as SavingsIncrementPeriod)
      ? (inc as SavingsIncrementPeriod)
      : null;
  const incAmt = r.increment_amount;
  const hasInc =
    incAmt != null &&
    String(incAmt).trim() !== "" &&
    Number.isFinite(num(incAmt)) &&
    num(incAmt) > 0;

  return {
    id: String(r.id),
    household_id: String(r.household_id ?? ""),
    title: String(r.title ?? "").trim() || "Untitled",
    plan_kind,
    target_amount: num(r.target_amount),
    start_date: String(r.start_date ?? "").slice(0, 10),
    target_date: String(r.target_date ?? "").slice(0, 10),
    increment_amount: hasInc && increment_period ? num(incAmt) : null,
    increment_period:
      hasInc && increment_period ? increment_period : null,
    is_archived: Boolean(r.is_archived),
    include_in_projection: r.include_in_projection !== false,
    notes: r.notes != null && String(r.notes).trim() !== "" ? String(r.notes) : null,
  };
}

export function mapSavingsContribution(raw: unknown): SavingsPlanContributionRow {
  const r = raw as Record<string, unknown>;
  return {
    id: String(r.id),
    savings_plan_id: String(r.savings_plan_id ?? ""),
    amount: num(r.amount),
    contributed_on: String(r.contributed_on ?? "").slice(0, 10),
    note:
      r.note != null && String(r.note).trim() !== "" ? String(r.note) : null,
  };
}
