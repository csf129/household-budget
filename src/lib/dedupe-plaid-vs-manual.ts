import { normalizeDescription } from "@/lib/normalize-description";

export type DedupeLedgerRow = {
  id: string;
  occurred_on: string;
  amount: number;
  raw_description: string;
  normalized_description: string;
  plaid_transaction_id: string | null;
};

/** Ledger row linked to Plaid (has stable Plaid transaction id). */
export function transactionIsPlaidBacked(row: {
  plaid_transaction_id?: string | null;
}): boolean {
  const p = row.plaid_transaction_id;
  return p != null && String(p).trim() !== "";
}

export function ledgerAmountsEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.009;
}

function coerceAmount(v: number | string): number {
  const n = typeof v === "string" ? Number.parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function lettersOnlyCore(s: string): string {
  return normalizeDescription(s).replace(/[^a-z]/g, "");
}

/** Default max |date₁ − date₂| in calendar days for a duplicate pair. */
export const DEFAULT_MAX_CALENDAR_DAY_GAP = 3;

/** Clamp API/UI input to a safe 0–7 day window. */
export function clampMaxCalendarDayGap(value: unknown): number {
  const n =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : DEFAULT_MAX_CALENDAR_DAY_GAP;
  return Math.min(7, Math.max(0, Math.floor(n)));
}

/** Inclusive calendar-day distance between two `YYYY-MM-DD` strings. */
export function calendarDaysApart(isoA: string, isoB: string): number {
  const a = isoA.slice(0, 10);
  const b = isoB.slice(0, 10);
  const [ya, ma, da] = a.split("-").map((x) => Number.parseInt(x, 10));
  const [yb, mb, db] = b.split("-").map((x) => Number.parseInt(x, 10));
  if (![ya, ma, da, yb, mb, db].every((n) => Number.isFinite(n))) {
    return 9999;
  }
  const ta = Date.UTC(ya, ma - 1, da);
  const tb = Date.UTC(yb, mb - 1, db);
  return Math.abs(Math.round((ta - tb) / 86_400_000));
}

/**
 * Loose match for “same merchant / same line” when bank strings differ
 * (e.g. “Market Basket” vs “MARKET BASKET700000760”).
 */
export function descriptionsSimilarForPlaidManualDedupe(
  a: string,
  b: string,
): boolean {
  const na = normalizeDescription(a);
  const nb = normalizeDescription(b);
  if (na === nb) return true;

  const la = lettersOnlyCore(a);
  const lb = lettersOnlyCore(b);
  if (la.length === 0 || lb.length === 0) return false;
  if (la === lb) return true;

  const [shorter, longer] = la.length <= lb.length ? [la, lb] : [lb, la];
  if (shorter.length < 6) return false;
  return longer.includes(shorter);
}

function rowDescriptionsSimilar(m: DedupeLedgerRow, p: DedupeLedgerRow): boolean {
  const pairs: [string, string][] = [
    [m.raw_description, p.raw_description],
    [m.normalized_description, p.normalized_description],
    [m.raw_description, p.normalized_description],
    [m.normalized_description, p.raw_description],
  ];
  return pairs.some(([x, y]) =>
    descriptionsSimilarForPlaidManualDedupe(x ?? "", y ?? ""),
  );
}

/** Prefer keeping rows that look more like raw bank strings (among non-Plaid dupes). */
export function keeperPreferenceScore(r: DedupeLedgerRow): number {
  const raw = (r.raw_description ?? "").trim();
  let s = Math.min(raw.length, 240);
  if (/\d{4,}/.test(raw)) s += 45;
  const letters = raw.replace(/[^a-z]/gi, "");
  const uppers = raw.replace(/[^A-Z]/g, "").length;
  const lowers = raw.replace(/[^a-z]/g, "").length;
  if (letters.length >= 10 && uppers >= 8 && uppers >= lowers) s += 30;
  return s;
}

function clusterCalendarSpan(cluster: DedupeLedgerRow[]): number {
  const dates = cluster
    .map((r) => r.occurred_on.slice(0, 10))
    .filter((d) => d.length === 10)
    .sort();
  if (dates.length === 0) return 0;
  return calendarDaysApart(dates[0]!, dates[dates.length - 1]!);
}

function ufFind(parent: number[], i: number): number {
  if (parent[i] !== i) parent[i] = ufFind(parent, parent[i]);
  return parent[i];
}

function ufUnion(parent: number[], rank: number[], a: number, b: number): void {
  let ra = ufFind(parent, a);
  let rb = ufFind(parent, b);
  if (ra === rb) return;
  if (rank[ra] < rank[rb]) [ra, rb] = [rb, ra];
  parent[rb] = ra;
  if (rank[ra] === rank[rb]) rank[ra] += 1;
}

export type PlannedManualDuplicateDeletion = {
  deleteId: string;
  /** Ledger row retained (Plaid-backed when `keeper_is_plaid`, else the chosen manual copy). */
  keeper_ledger_id: string;
  keeper_is_plaid: boolean;
  /** Date on the row being removed. */
  occurred_on: string;
  /** Date on the kept row. */
  keeper_occurred_on: string;
  /** Calendar days between the two dates. */
  calendar_day_gap: number;
  amount: number;
  deleteDescription: string;
  keepDescription: string;
};

export type PlanPlaidManualDedupeOptions = {
  maxCalendarDayGap?: number;
};

/**
 * Groups ledger rows that share the same amount, have similar descriptions, and
 * are pairwise within `maxCalendarDayGap` (union–find). Drops clusters whose
 * overall date span exceeds `maxCalendarDayGap` (avoids chaining unrelated trips).
 *
 * - Mixed Plaid + non-Plaid: delete every non-Plaid row (keeper = closest Plaid by date).
 * - Plaid-only cluster: delete extras, keep one Plaid row (stable id order).
 * - Non-Plaid-only cluster: delete extras, keep one row (`keeperPreferenceScore`).
 */
export function planLedgerDuplicateDeletions(
  rows: DedupeLedgerRow[],
  options?: PlanPlaidManualDedupeOptions,
): PlannedManualDuplicateDeletion[] {
  const maxGap = clampMaxCalendarDayGap(options?.maxCalendarDayGap);
  const n = rows.length;
  if (n < 2) return [];

  const parent = Array.from({ length: n }, (_, i) => i);
  const rank = Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    const ai = coerceAmount(rows[i].amount);
    for (let j = i + 1; j < n; j++) {
      if (!ledgerAmountsEqual(ai, coerceAmount(rows[j].amount))) continue;
      if (calendarDaysApart(rows[i].occurred_on, rows[j].occurred_on) > maxGap) {
        continue;
      }
      if (!rowDescriptionsSimilar(rows[i], rows[j])) continue;
      ufUnion(parent, rank, i, j);
    }
  }

  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = ufFind(parent, i);
    const list = byRoot.get(r) ?? [];
    list.push(i);
    byRoot.set(r, list);
  }

  const out: PlannedManualDuplicateDeletion[] = [];

  for (const idxs of byRoot.values()) {
    if (idxs.length < 2) continue;
    const clusterRows = idxs.map((i) => rows[i]);
    if (clusterCalendarSpan(clusterRows) > maxGap) continue;

    const plaidIdxs = idxs.filter((i) => transactionIsPlaidBacked(rows[i]));
    const manualIdxs = idxs.filter((i) => !transactionIsPlaidBacked(rows[i]));

    if (plaidIdxs.length >= 1 && manualIdxs.length >= 1) {
      for (const mi of manualIdxs) {
        const m = rows[mi]!;
        let bestP: DedupeLedgerRow | null = null;
        let bestGap = Infinity;
        for (const pi of plaidIdxs) {
          const p = rows[pi]!;
          const g = calendarDaysApart(m.occurred_on, p.occurred_on);
          if (g < bestGap) {
            bestGap = g;
            bestP = p;
          }
        }
        if (bestP) {
          out.push({
            deleteId: m.id,
            keeper_ledger_id: bestP.id,
            keeper_is_plaid: true,
            occurred_on: m.occurred_on,
            keeper_occurred_on: bestP.occurred_on,
            calendar_day_gap: bestGap,
            amount: coerceAmount(m.amount),
            deleteDescription:
              m.raw_description?.trim() || m.normalized_description,
            keepDescription:
              bestP.raw_description?.trim() || bestP.normalized_description,
          });
        }
      }
      continue;
    }

    if (plaidIdxs.length >= 2 && manualIdxs.length === 0) {
      const plaidRows = plaidIdxs
        .map((i) => rows[i]!)
        .sort((a, b) => a.id.localeCompare(b.id));
      const keeper = plaidRows[0]!;
      for (const r of plaidRows.slice(1)) {
        const g = calendarDaysApart(r.occurred_on, keeper.occurred_on);
        out.push({
          deleteId: r.id,
          keeper_ledger_id: keeper.id,
          keeper_is_plaid: true,
          occurred_on: r.occurred_on,
          keeper_occurred_on: keeper.occurred_on,
          calendar_day_gap: g,
          amount: coerceAmount(r.amount),
          deleteDescription:
            r.raw_description?.trim() || r.normalized_description,
          keepDescription:
            keeper.raw_description?.trim() || keeper.normalized_description,
        });
      }
      continue;
    }

    if (manualIdxs.length >= 2 && plaidIdxs.length === 0) {
      const manualRows = manualIdxs
        .map((i) => rows[i]!)
        .sort((a, b) => {
          const d = keeperPreferenceScore(b) - keeperPreferenceScore(a);
          if (d !== 0) return d;
          return a.id.localeCompare(b.id);
        });
      const keeper = manualRows[0]!;
      for (const r of manualRows.slice(1)) {
        const g = calendarDaysApart(r.occurred_on, keeper.occurred_on);
        out.push({
          deleteId: r.id,
          keeper_ledger_id: keeper.id,
          keeper_is_plaid: false,
          occurred_on: r.occurred_on,
          keeper_occurred_on: keeper.occurred_on,
          calendar_day_gap: g,
          amount: coerceAmount(r.amount),
          deleteDescription:
            r.raw_description?.trim() || r.normalized_description,
          keepDescription:
            keeper.raw_description?.trim() || keeper.normalized_description,
        });
      }
    }
  }

  return out;
}

/** @deprecated Use `planLedgerDuplicateDeletions`. */
export const planDeleteManualDuplicatesWhenPlaidTwinExists =
  planLedgerDuplicateDeletions;
