import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaidApi, Transaction } from "plaid";
import { categoryRulesFromDb } from "@/lib/apply-category-rules";
import { decryptPlaidAccessToken } from "@/lib/plaid-token-crypto";
import { parsePlaidDate } from "@/lib/plaid-parse-date";
import { repairNearDuplicatePlaidLedgerPairsForHousehold } from "@/lib/plaid-ledger-near-duplicate-merge";
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
): Promise<{
  upserted: number;
  removed: number;
  ledger_replaced: number;
}> {
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
        const r = await supersedeImportedTransactionsForPlaidTransaction(
          admin,
          householdId,
          t,
          categoryRules,
          bankAccountId,
        );
        ledgerReplaced += r.deleted;
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
  }

  await admin
    .from("bank_connections")
    .update({
      last_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", bankConnectionId);

  try {
    await repairNearDuplicatePlaidLedgerPairsForHousehold(admin, householdId);
  } catch (e) {
    console.warn("[plaid] repairNearDuplicatePlaidLedgerPairsForHousehold", e);
  }

  return { upserted, removed, ledger_replaced: ledgerReplaced };
}
