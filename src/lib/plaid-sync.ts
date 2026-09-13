import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaidApi, Transaction } from "plaid";
import { categoryRulesFromDb } from "@/lib/apply-category-rules";
import { decryptPlaidAccessToken } from "@/lib/plaid-token-crypto";
import { parsePlaidDate } from "@/lib/plaid-parse-date";
import { repairNearDuplicatePlaidLedgerPairsForHousehold } from "@/lib/plaid-ledger-near-duplicate-merge";
import { promoteUnmirroredPlaidFeedRowsToLedger } from "@/lib/promote-unmirrored-plaid-feed";
import { supersedeImportedTransactionsForPlaidTransaction } from "@/lib/plaid-supersede-imported";

function transactionToRow(
  t: Transaction,
  householdId: string,
  bankAccountId: string,
) {
  return {
    household_id: householdId,
    bank_account_id: bankAccountId,
    plaid_transaction_id: t.transaction_id,
    pending: t.pending,
    name: t.name,
    merchant_name: t.merchant_name ?? null,
    amount: t.amount,
    iso_currency_code: t.iso_currency_code,
    authorized_date: parsePlaidDate(t.authorized_date),
    posted_date: parsePlaidDate(t.date),
    category: t.personal_finance_category
      ? (JSON.parse(JSON.stringify(t.personal_finance_category)) as Record<
          string,
          unknown
        >)
      : null,
    raw: JSON.parse(JSON.stringify(t)) as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Runs `/transactions/sync` until `has_more` is false; updates cursor and last_sync_at.
 */
export async function syncPlaidTransactionsForConnection(
  admin: SupabaseClient,
  plaid: PlaidApi,
  bankConnectionId: string,
  householdId: string,
  opts: { deadlineMs?: number } = {},
): Promise<{
  upserted: number;
  removed: number;
  ledger_replaced: number;
  has_more: boolean;
}> {
  const startedAt = Date.now();
  const deadlineMs = opts.deadlineMs;
  const { data: sec, error: secErr } = await admin
    .from("bank_connection_secrets")
    .select("plaid_access_token_ciphertext")
    .eq("bank_connection_id", bankConnectionId)
    .maybeSingle();

  if (secErr) throw new Error(secErr.message);
  if (!sec?.plaid_access_token_ciphertext) {
    throw new Error("No stored Plaid token for this connection.");
  }

  const accessToken = decryptPlaidAccessToken(
    String(sec.plaid_access_token_ciphertext),
  );

  try {
    await plaid.transactionsRefresh({ access_token: accessToken });
  } catch (e) {
    console.warn(
      "plaid transactionsRefresh (non-fatal; sync may still return data):",
      e,
    );
  }

  const { data: cursorRow } = await admin
    .from("plaid_sync_state")
    .select("transactions_cursor")
    .eq("bank_connection_id", bankConnectionId)
    .maybeSingle();

  let cursor: string | undefined =
    cursorRow?.transactions_cursor != null &&
    String(cursorRow.transactions_cursor).length > 0
      ? String(cursorRow.transactions_cursor)
      : undefined;

  const { data: acctRows, error: acctErr } = await admin
    .from("bank_accounts")
    .select("id, plaid_account_id")
    .eq("bank_connection_id", bankConnectionId);

  if (acctErr) throw new Error(acctErr.message);
  const plaidToInternal = new Map(
    (acctRows ?? []).map((r) => [String(r.plaid_account_id), String(r.id)]),
  );

  const { data: rulesRaw } = await admin
    .from("category_rules")
    .select("category_id, match_type, pattern, priority, amount_sign")
    .eq("household_id", householdId);
  const categoryRules = categoryRulesFromDb(rulesRaw ?? []);

  let upserted = 0;
  let removed = 0;
  let ledgerReplaced = 0;
  let hasMore = true;

  while (hasMore) {
    const res = await plaid.transactionsSync({
      access_token: accessToken,
      cursor,
      count: 200,
    });

    const d = res.data;
    hasMore = d.has_more;
    const nextCursor = d.next_cursor;

    for (const r of d.removed ?? []) {
      const { error: delErr } = await admin
        .from("plaid_transactions")
        .delete()
        .eq("plaid_transaction_id", r.transaction_id);
      if (!delErr) removed += 1;
      await admin
        .from("transactions")
        .delete()
        .eq("plaid_transaction_id", r.transaction_id);
    }

    const toUpsert: ReturnType<typeof transactionToRow>[] = [];
    for (const t of [...(d.added ?? []), ...(d.modified ?? [])]) {
      const bankAccountId = plaidToInternal.get(t.account_id);
      if (!bankAccountId) continue;
      toUpsert.push(transactionToRow(t, householdId, bankAccountId));
    }

    if (toUpsert.length > 0) {
      const { error: upErr } = await admin
        .from("plaid_transactions")
        .upsert(toUpsert, { onConflict: "plaid_transaction_id" });
      if (upErr) throw new Error(upErr.message);
      upserted += toUpsert.length;

      const synced = [...(d.added ?? []), ...(d.modified ?? [])];
      for (const t of synced) {
        const bankAccountId = plaidToInternal.get(t.account_id);
        if (!bankAccountId) continue;
        // Isolate per-transaction failures: one bad row must not abort the whole
        // batch (which previously stranded its siblings with no ledger row once
        // the cursor advanced). Anything skipped here is healed by the
        // reconciliation pass after the loop.
        try {
          const r = await supersedeImportedTransactionsForPlaidTransaction(
            admin,
            householdId,
            t,
            categoryRules,
            bankAccountId,
          );
          ledgerReplaced += r.deleted;
        } catch (e) {
          console.error(
            "[plaid] supersede failed for transaction",
            t.transaction_id,
            e,
          );
        }
      }

      // Plaid may return both the old pending id and the new posted id in one batch.
      // The ledger row keeps the posted id; drop the superseded pending row from the
      // feed table so the UI does not show "Pending" next to the posted copy.
      for (const t of synced) {
        if (t.pending) continue;
        const superseded = t.pending_transaction_id?.trim();
        if (!superseded || superseded === t.transaction_id) continue;
        const { error: supersedesErr } = await admin
          .from("plaid_transactions")
          .delete()
          .eq("household_id", householdId)
          .eq("plaid_transaction_id", superseded);
        if (supersedesErr) throw new Error(supersedesErr.message);
      }
    }

    cursor = nextCursor;

    const { error: curErr } = await admin.from("plaid_sync_state").upsert(
      {
        bank_connection_id: bankConnectionId,
        transactions_cursor: nextCursor,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "bank_connection_id" },
    );
    if (curErr) throw new Error(curErr.message);

    if (!hasMore) break;

    // Stay under the platform function timeout (Vercel Hobby hard-caps at 60s
    // regardless of maxDuration). The cursor is saved after every page, so a
    // full historical backfill resumes on the next sync (webhook, cron, manual)
    // instead of being killed mid-request and surfacing as a "network error".
    if (deadlineMs != null && Date.now() - startedAt > deadlineMs) {
      break;
    }
  }

  await admin
    .from("bank_connections")
    .update({
      last_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", bankConnectionId);

  // When we stopped early there is still more to pull; skip the whole-household
  // reconciliation/repair passes (they are heavy) and let them run on the sync
  // that finishes the backfill.
  if (hasMore) {
    return { upserted, removed, ledger_replaced: ledgerReplaced, has_more: true };
  }

  // Self-heal any feed row that never got a ledger row (transient supersede
  // failure, aborted/partial sync). Runs before the near-duplicate repair so
  // the repair can collapse anything this re-inserts.
  try {
    const { inserted } =
      await promoteUnmirroredPlaidFeedRowsToLedger(admin, householdId);
    if (inserted > 0) {
      console.warn(
        `[plaid] reconciliation promoted ${inserted} un-mirrored feed row(s) to the ledger`,
      );
    }
  } catch (e) {
    console.warn("[plaid] promoteUnmirroredPlaidFeedRowsToLedger", e);
  }

  try {
    await repairNearDuplicatePlaidLedgerPairsForHousehold(admin, householdId);
  } catch (e) {
    console.warn("[plaid] repairNearDuplicatePlaidLedgerPairsForHousehold", e);
  }

  return { upserted, removed, ledger_replaced: ledgerReplaced, has_more: false };
}

/**
 * Sync every active Plaid connection for a household. Used as a daily safety
 * net (see the hearth-sync cron): the Plaid webhook is the primary trigger, but
 * if a webhook is dropped or rejected, this backfills so data cannot silently
 * freeze. One failing connection is logged and skipped, not fatal.
 */
export async function syncAllActivePlaidConnectionsForHousehold(
  admin: SupabaseClient,
  plaid: PlaidApi,
  householdId: string,
  opts: { deadlineMs?: number } = {},
): Promise<{
  connections: number;
  synced: number;
  upserted: number;
  removed: number;
  ledger_replaced: number;
  has_more: boolean;
}> {
  const startedAt = Date.now();
  const { data: conns, error } = await admin
    .from("bank_connections")
    .select("id")
    .eq("household_id", householdId)
    .eq("status", "active");
  if (error) throw new Error(error.message);

  let synced = 0;
  let upserted = 0;
  let removed = 0;
  let ledgerReplaced = 0;
  let hasMore = false;
  for (const c of conns ?? []) {
    const remaining =
      opts.deadlineMs != null
        ? opts.deadlineMs - (Date.now() - startedAt)
        : undefined;
    // Out of time budget — leave the rest for the next run (all resumable).
    if (remaining != null && remaining <= 0) {
      hasMore = true;
      break;
    }
    try {
      const r = await syncPlaidTransactionsForConnection(
        admin,
        plaid,
        String(c.id),
        householdId,
        remaining != null ? { deadlineMs: remaining } : {},
      );
      synced += 1;
      upserted += r.upserted;
      removed += r.removed;
      ledgerReplaced += r.ledger_replaced;
      if (r.has_more) hasMore = true;
    } catch (e) {
      console.error("[plaid] safety-net sync failed for connection", c.id, e);
    }
  }

  return {
    connections: (conns ?? []).length,
    synced,
    upserted,
    removed,
    ledger_replaced: ledgerReplaced,
    has_more: hasMore,
  };
}
