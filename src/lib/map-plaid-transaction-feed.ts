import { normalizeDescription } from "@/lib/normalize-description";
import { plaidAmountToLedgerAmount } from "@/lib/plaid-supersede-imported";
import { plaidTransactionDisplayDescription } from "@/lib/plaid-transaction-description";
import type { TransactionRow } from "@/types/finance";

export type PlaidTransactionFeedDbRow = {
  plaid_transaction_id: string;
  bank_account_id?: string | null;
  amount: number | string;
  name: string;
  merchant_name: string | null;
  posted_date: string | null;
  authorized_date: string | null;
  pending: boolean;
  bank_accounts?:
    | { name?: string | null; display_name?: string | null; mask?: string | null }
    | Array<{ name?: string | null; display_name?: string | null; mask?: string | null }>
    | null;
};

/**
 * Maps a `plaid_transactions` row for the Transactions UI when it is not yet
 * mirrored into `transactions` (or as a fallback if mirroring failed).
 */
export function mapPlaidTransactionFeedRow(
  p: PlaidTransactionFeedDbRow,
): TransactionRow {
  const amt =
    typeof p.amount === "string" ? Number.parseFloat(p.amount) : p.amount;
  const ledgerAmt = plaidAmountToLedgerAmount(
    Number.isFinite(amt) ? amt : 0,
  );
  const desc = plaidTransactionDisplayDescription({
    name: p.name,
    merchant_name: p.merchant_name,
  });
  // Match supersede logic: authorized date first (closer to bank statement / Chase UI).
  const when = p.authorized_date || p.posted_date;
  const occurredOn =
    when && /^\d{4}-\d{2}-\d{2}$/.test(String(when).slice(0, 10))
      ? String(when).slice(0, 10)
      : "1970-01-01";
  const ba = Array.isArray(p.bank_accounts) ? p.bank_accounts[0] : p.bank_accounts;
  const accountName =
    ba?.display_name && String(ba.display_name).trim() !== ""
      ? String(ba.display_name)
      : ba?.name
        ? String(ba.name)
        : null;
  const accountMask = ba?.mask ? String(ba.mask) : null;
  const accountLabel =
    accountName && accountMask
      ? `${accountName} ·•••${accountMask}`
      : accountName ?? null;

  return {
    id: `plaid-feed:${p.plaid_transaction_id}`,
    amount: ledgerAmt,
    occurred_on: occurredOn,
    raw_description: desc,
    normalized_description: normalizeDescription(desc),
    notes: p.pending ? "Pending (Plaid)" : null,
    account_id: null,
    bank_account_id:
      p.bank_account_id != null ? String(p.bank_account_id) : null,
    category_id: null,
    categories: null,
    income_treatment: null,
    plaid_transaction_id: p.plaid_transaction_id,
    plaid_feed_only: true,
    account_name: accountLabel,
  };
}
