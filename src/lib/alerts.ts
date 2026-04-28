import type { SupabaseClient } from "@supabase/supabase-js";

export type AlertSeverity = "warning" | "info";

export type AlertItem = {
  id: string;
  type: "missing_receipt";
  severity: AlertSeverity;
  title: string;
  preview: string;
  date: string;
  transactionId: string;
  amount: number;
  rawDescription: string;
  categoryName: string | null;
  categoryColor: string | null;
};

export async function fetchHouseholdAlerts(
  supabase: SupabaseClient,
  householdId: string,
): Promise<AlertItem[]> {
  // Business expense transactions that have no attached receipts
  const { data, error } = await supabase
    .from("transactions")
    .select(
      `id, amount, occurred_on, raw_description,
       categories ( name, color ),
       transaction_receipts ( id )`,
    )
    .eq("household_id", householdId)
    .eq("is_business_expense", true)
    .is("ledger_archived_at", null)
    .order("occurred_on", { ascending: false });

  if (error || !data) return [];

  const alerts: AlertItem[] = [];

  for (const row of data as Record<string, unknown>[]) {
    const receipts = row.transaction_receipts;
    const hasReceipt =
      Array.isArray(receipts) && receipts.length > 0;
    if (hasReceipt) continue;

    const cat = Array.isArray(row.categories)
      ? (row.categories[0] as Record<string, unknown> | undefined)
      : row.categories
        ? (row.categories as Record<string, unknown>)
        : null;

    const amount =
      typeof row.amount === "string"
        ? parseFloat(row.amount)
        : typeof row.amount === "number"
          ? row.amount
          : 0;

    const desc = String(row.raw_description ?? "").trim();
    const date = String(row.occurred_on ?? "");
    const usd = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(Math.abs(amount));

    alerts.push({
      id: `missing_receipt:${String(row.id)}`,
      type: "missing_receipt",
      severity: "warning",
      title: `Missing receipt — ${desc}`,
      preview: `${usd} on ${date} · No receipt attached to this business expense.`,
      date,
      transactionId: String(row.id),
      amount,
      rawDescription: desc,
      categoryName: cat ? String(cat.name ?? "") || null : null,
      categoryColor: cat ? String(cat.color ?? "") || null : null,
    });
  }

  return alerts;
}

export async function fetchHouseholdAlertCount(
  supabase: SupabaseClient,
  householdId: string,
): Promise<number> {
  const alerts = await fetchHouseholdAlerts(supabase, householdId);
  return alerts.length;
}
