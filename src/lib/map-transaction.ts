import type { ReceiptRow, TransactionRow } from "@/types/finance";

/**
 * Normalizes PostgREST rows (numeric as string, embedded relation as object or array).
 */
export function mapTransactionRow(raw: unknown): TransactionRow {
  const r = raw as Record<string, unknown>;
  const embed = r.categories;
  let categories: TransactionRow["categories"] = null;
  const parentFromCategory = (c: Record<string, unknown>) => {
    const par = c.parent;
    if (Array.isArray(par) && par[0] && typeof par[0] === "object") {
      const p = par[0] as Record<string, unknown>;
      const n = String(p.name ?? "").trim();
      return n ? { name: n } : null;
    }
    if (par && typeof par === "object" && !Array.isArray(par)) {
      const p = par as Record<string, unknown>;
      const n = String(p.name ?? "").trim();
      return n ? { name: n } : null;
    }
    return null;
  };

  const primaryFromCategory = (c: Record<string, unknown>) => {
    const pg = c.primary_category_groups;
    let primary_group: { slug: string; name: string } | null = null;
    if (Array.isArray(pg) && pg[0] && typeof pg[0] === "object") {
      const p = pg[0] as Record<string, unknown>;
      const slug = String(p.slug ?? "");
      if (slug)
        primary_group = { slug, name: String(p.name ?? "") };
    } else if (pg && typeof pg === "object" && !Array.isArray(pg)) {
      const p = pg as Record<string, unknown>;
      const slug = String(p.slug ?? "");
      if (slug)
        primary_group = { slug, name: String(p.name ?? "") };
    }
    return primary_group;
  };

  if (Array.isArray(embed) && embed[0] && typeof embed[0] === "object") {
    const c = embed[0] as Record<string, unknown>;
    const par = parentFromCategory(c);
    categories = {
      name: String(c.name ?? ""),
      color: c.color != null ? String(c.color) : null,
      primary_group: primaryFromCategory(c),
      parent: par,
    };
  } else if (embed && typeof embed === "object" && !Array.isArray(embed)) {
    const c = embed as Record<string, unknown>;
    const par = parentFromCategory(c);
    categories = {
      name: String(c.name ?? ""),
      color: c.color != null ? String(c.color) : null,
      primary_group: primaryFromCategory(c),
      parent: par,
    };
  }

  const amt = r.amount;
  const amount =
    typeof amt === "string"
      ? Number.parseFloat(amt)
      : typeof amt === "number"
        ? amt
        : Number.NaN;

  const inc = r.income_treatment;
  const income_treatment =
    inc === "include" || inc === "exclude" ? inc : null;

  const rawReceipts = r.transaction_receipts;
  const receipts: ReceiptRow[] = Array.isArray(rawReceipts)
    ? (rawReceipts as Record<string, unknown>[]).map((rec) => ({
        id: String(rec.id),
        transaction_id: String(r.id),
        file_path: String(rec.file_path ?? ""),
        file_name: String(rec.file_name ?? ""),
        file_size: Number(rec.file_size ?? 0),
        mime_type: String(rec.mime_type ?? ""),
        created_at: String(rec.created_at ?? ""),
      }))
    : [];

  const ptid = r.plaid_transaction_id;
  const arch = r.ledger_archived_at;
  return {
    id: String(r.id),
    amount,
    occurred_on: String(r.occurred_on ?? ""),
    raw_description: String(r.raw_description ?? ""),
    normalized_description: String(r.normalized_description ?? ""),
    notes: r.notes != null && r.notes !== "" ? String(r.notes) : null,
    account_id: r.account_id != null ? String(r.account_id) : null,
    bank_account_id:
      r.bank_account_id != null ? String(r.bank_account_id) : null,
    category_id: r.category_id != null ? String(r.category_id) : null,
    categories,
    income_treatment,
    is_business_expense: r.is_business_expense === true,
    receipts,
    plaid_transaction_id:
      ptid != null && String(ptid).trim() !== "" ? String(ptid) : null,
    ledger_archived_at:
      arch != null && String(arch).trim() !== ""
        ? String(arch)
        : null,
    plaid_feed_only: false,
    account_name: null,
  };
}
