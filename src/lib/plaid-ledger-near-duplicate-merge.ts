import type { SupabaseClient } from "@supabase/supabase-js";
import type { Transaction } from "plaid";
import { normalizeDescription } from "@/lib/normalize-description";
import { parsePlaidDate } from "@/lib/plaid-parse-date";
import {
  ledgerArchiveColumnExists,
  withActiveLedgerOnly,
} from "@/lib/ledger-archive-schema";
import { plaidTransactionDisplayDescription } from "@/lib/plaid-transaction-description";

/** Ledger: negative = outflow (matches `plaid-supersede-imported`). */
function plaidAmountToLedgerAmount(plaidAmount: number): number {
  const n = Number(plaidAmount);
  return Number.isFinite(n) ? -n : 0;
}

/** Calendar days ± around min/max Plaid dates to catch pending vs posted skew. */
const WINDOW_DAYS = 8;

function expandIsoDateRange(dates: string[], extraDays: number): {
  lo: string;
  hi: string;
} {
  const ts: number[] = [];
  for (const d of dates) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    if (!m) continue;
    ts.push(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  }
  if (ts.length === 0) {
    const t = Date.now();
    const lo = new Date(t - extraDays * 86400000);
    const hi = new Date(t + extraDays * 86400000);
    return { lo: lo.toISOString().slice(0, 10), hi: hi.toISOString().slice(0, 10) };
  }
  const min = Math.min(...ts);
  const max = Math.max(...ts);
  const lo = new Date(min - extraDays * 86400000);
  const hi = new Date(max + extraDays * 86400000);
  return { lo: lo.toISOString().slice(0, 10), hi: hi.toISOString().slice(0, 10) };
}

function parseAmount(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number.parseFloat(v);
  return Number(v);
}

function calendarDaysApart(a: string, b: string): number | null {
  const ma = /^(\d{4})-(\d{2})-(\d{2})/.exec(a);
  const mb = /^(\d{4})-(\d{2})-(\d{2})/.exec(b);
  if (!ma || !mb) return null;
  const da = Date.UTC(+ma[1], +ma[2] - 1, +ma[3]);
  const db = Date.UTC(+mb[1], +mb[2] - 1, +mb[3]);
  return Math.abs(Math.round((da - db) / 86400000));
}

/**
 * When Plaid posts a charge it sometimes omits `pending_transaction_id`, so we
 * insert a second ledger row instead of upgrading the pending row (same class
 * of bug as duplicate Stop & Shop / OpenAI lines). We also collapse rare
 * double-posted Plaid ids for the same normalized purchase.
 *
 * Deletes **pending** ledger rows when a **posted** sibling exists with the
 * same amount + normalized description in a short date window; then removes
 * extra **posted** duplicates keeping the row for `t.transaction_id` when
 * possible.
 */
export async function mergeNearDuplicatePlaidLedgerRowsForTransaction(
  admin: SupabaseClient,
  householdId: string,
  bankAccountId: string,
  t: Transaction,
): Promise<{ deleted: number }> {
  const hasLedgerArchive = await ledgerArchiveColumnExists(admin);

  const displayRaw = plaidTransactionDisplayDescription(t);
  const anchorNorm = normalizeDescription(displayRaw);
  const ledgerAmount = plaidAmountToLedgerAmount(t.amount);

  const posted = parsePlaidDate(t.date);
  const authorized = parsePlaidDate(t.authorized_date);
  const dates = Array.from(
    new Set(
      [
        posted,
        authorized,
        parsePlaidDate(t.datetime),
        parsePlaidDate(t.authorized_datetime),
      ].filter((x): x is string => Boolean(x)),
    ),
  );
  if (dates.length === 0) return { deleted: 0 };

  const { lo, hi } = expandIsoDateRange(dates, WINDOW_DAYS);

  let q = admin
    .from("transactions")
    .select(
      "id, plaid_transaction_id, amount, raw_description, normalized_description, occurred_on",
    )
    .eq("household_id", householdId)
    .eq("bank_account_id", bankAccountId)
    .not("plaid_transaction_id", "is", null)
    .gte("occurred_on", lo)
    .lte("occurred_on", hi);

  q = withActiveLedgerOnly(q, hasLedgerArchive);

  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);

  function ledgerNormMatchesAnchor(r: {
    raw_description?: string | null;
    normalized_description?: string | null;
  }): boolean {
    if (String(r.normalized_description ?? "") === anchorNorm) return true;
    return (
      normalizeDescription(String(r.raw_description ?? "")) === anchorNorm
    );
  }

  const candidates = (rows ?? []).filter((r) => {
    const amt = parseAmount(r.amount);
    if (!Number.isFinite(amt) || Math.abs(amt - ledgerAmount) > 0.009) return false;
    return ledgerNormMatchesAnchor(r);
  });

  if (candidates.length < 2) return { deleted: 0 };

  const ids = candidates.map((r) => String(r.plaid_transaction_id));
  const { data: feedRows, error: feedErr } = await admin
    .from("plaid_transactions")
    .select("plaid_transaction_id, pending")
    .eq("household_id", householdId)
    .in("plaid_transaction_id", ids);

  if (feedErr) throw new Error(feedErr.message);

  const pendingByPlaidId = new Map<string, boolean>();
  for (const fr of feedRows ?? []) {
    pendingByPlaidId.set(String(fr.plaid_transaction_id), Boolean(fr.pending));
  }

  const ledgerIdsToDelete = new Set<string>();
  const plaidIdsToDelete = new Set<string>();

  const hasPosted = candidates.some(
    (c) => pendingByPlaidId.get(String(c.plaid_transaction_id)) === false,
  );
  const strictPending = candidates.filter(
    (c) => pendingByPlaidId.get(String(c.plaid_transaction_id)) === true,
  );
  if (hasPosted && strictPending.length > 0) {
    for (const c of strictPending) {
      ledgerIdsToDelete.add(String(c.id));
      plaidIdsToDelete.add(String(c.plaid_transaction_id));
    }
  }

  const explicitPosted = candidates.filter(
    (c) => pendingByPlaidId.get(String(c.plaid_transaction_id)) === false,
  );
  if (explicitPosted.length >= 2) {
    const anchorTid = String(t.transaction_id);
    const keep =
      explicitPosted.find((c) => String(c.plaid_transaction_id) === anchorTid) ??
      explicitPosted
        .slice()
        .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on))[0];
    for (const c of explicitPosted) {
      if (String(c.id) !== String(keep.id)) {
        ledgerIdsToDelete.add(String(c.id));
        plaidIdsToDelete.add(String(c.plaid_transaction_id));
      }
    }
  }

  /**
   * Plaid sometimes omits `pending` on `plaid_transactions` rows, so neither
   * branch above runs. Same merchant + amount + norm, two rows within a few
   * days → keep the row for this sync txn, else the later `occurred_on`.
   */
  if (ledgerIdsToDelete.size === 0 && candidates.length === 2) {
    const [x, y] = candidates;
    const span = calendarDaysApart(
      String(x.occurred_on),
      String(y.occurred_on),
    );
    if (span != null && span <= 4) {
      const anchorTid = String(t.transaction_id);
      const keep =
        candidates.find((c) => String(c.plaid_transaction_id) === anchorTid) ??
        (String(x.occurred_on) >= String(y.occurred_on) ? x : y);
      for (const c of candidates) {
        if (String(c.id) !== String(keep.id)) {
          ledgerIdsToDelete.add(String(c.id));
          plaidIdsToDelete.add(String(c.plaid_transaction_id));
        }
      }
    }
  }

  if (ledgerIdsToDelete.size === 0) return { deleted: 0 };

  const deleteLedgerList = [...ledgerIdsToDelete];
  const { error: delTxErr } = await admin
    .from("transactions")
    .delete()
    .in("id", deleteLedgerList);
  if (delTxErr) throw new Error(delTxErr.message);

  const plaidList = [...plaidIdsToDelete].filter(Boolean);
  if (plaidList.length > 0) {
    const { error: delFeedErr } = await admin
      .from("plaid_transactions")
      .delete()
      .eq("household_id", householdId)
      .in("plaid_transaction_id", plaidList);
    if (delFeedErr) throw new Error(delFeedErr.message);
  }

  return { deleted: deleteLedgerList.length };
}

type LedgerRow = {
  id: string;
  plaid_transaction_id: string | null;
  bank_account_id: string | null;
  amount: unknown;
  raw_description: string | null;
  normalized_description: string | null;
  occurred_on: string;
};

/**
 * One-time cleanup after sync: find Plaid-linked pairs that still duplicate
 * (same purchase key, two rows, ≤4 days apart) without relying on Plaid
 * sending those transactions again in `/transactions/sync`.
 */
export async function repairNearDuplicatePlaidLedgerPairsForHousehold(
  admin: SupabaseClient,
  householdId: string,
): Promise<{ deleted: number }> {
  const hasLedgerArchive = await ledgerArchiveColumnExists(admin);
  const since = new Date();
  since.setMonth(since.getMonth() - 6);
  const sinceStr = since.toISOString().slice(0, 10);

  let q = admin
    .from("transactions")
    .select(
      "id, plaid_transaction_id, bank_account_id, amount, raw_description, normalized_description, occurred_on",
    )
    .eq("household_id", householdId)
    .not("plaid_transaction_id", "is", null)
    .gte("occurred_on", sinceStr);

  q = withActiveLedgerOnly(q, hasLedgerArchive);

  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);

  const byKey = new Map<string, LedgerRow[]>();
  for (const r of rows ?? []) {
    const amt = parseAmount(r.amount);
    if (!Number.isFinite(amt)) continue;
    const norm = normalizeDescription(
      String(r.raw_description ?? r.normalized_description ?? ""),
    );
    const key = `${String(r.bank_account_id ?? "")}\0${norm}\0${amt.toFixed(2)}`;
    const list = byKey.get(key);
    if (list) list.push(r as LedgerRow);
    else byKey.set(key, [r as LedgerRow]);
  }

  const ledgerIdsToDelete = new Set<string>();
  const plaidIdsToDelete = new Set<string>();

  for (const [, list] of byKey) {
    if (list.length !== 2) continue;
    const [a, b] = list;
    const span = calendarDaysApart(String(a.occurred_on), String(b.occurred_on));
    if (span == null || span > 4) continue;

    const keep =
      String(a.occurred_on) >= String(b.occurred_on) ? a : b;
    const drop = String(a.occurred_on) >= String(b.occurred_on) ? b : a;
    ledgerIdsToDelete.add(String(drop.id));
    if (drop.plaid_transaction_id) {
      plaidIdsToDelete.add(String(drop.plaid_transaction_id));
    }
  }

  if (ledgerIdsToDelete.size === 0) return { deleted: 0 };

  const delList = [...ledgerIdsToDelete];
  const { error: delTxErr } = await admin.from("transactions").delete().in("id", delList);
  if (delTxErr) throw new Error(delTxErr.message);

  const plaidList = [...plaidIdsToDelete].filter(Boolean);
  if (plaidList.length > 0) {
    const { error: delFeedErr } = await admin
      .from("plaid_transactions")
      .delete()
      .eq("household_id", householdId)
      .in("plaid_transaction_id", plaidList);
    if (delFeedErr) throw new Error(delFeedErr.message);
  }

  return { deleted: delList.length };
}
