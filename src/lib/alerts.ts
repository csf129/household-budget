import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationEvent } from "@/types/notifications";
import { eventTitle, eventBody } from "@/lib/notification-messages";

export type AlertSeverity = "warning" | "info";

export type AlertType = "missing_receipt" | "subscription_price_change" | "bill_paid";

export type AlertItem = {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  preview: string;
  date: string;
  /** Empty for alerts not tied to a single transaction. */
  transactionId: string;
  amount: number;
  rawDescription: string;
  categoryName: string | null;
  categoryColor: string | null;
  /** Prior amount — subscription_price_change only. */
  previousAmount?: number | null;
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

  const eventAlerts = await fetchNotificationEventAlerts(supabase, householdId);

  return [...alerts, ...eventAlerts].sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Notification events (subscription price changes, bills paid) surfaced in the
 * in-app feed. Gated on the household's `notify_in_app` setting (default on).
 */
export async function fetchNotificationEventAlerts(
  supabase: SupabaseClient,
  householdId: string,
): Promise<AlertItem[]> {
  const { data: settings } = await supabase
    .from("notification_settings")
    .select("notify_in_app")
    .eq("household_id", householdId)
    .maybeSingle();

  // Absent settings default to showing in-app alerts.
  if (settings && settings.notify_in_app === false) return [];

  const { data, error } = await supabase
    .from("notification_events")
    .select("id, type, dedup_key, merchant, merchant_label, amount, previous_amount, occurred_on, category_id")
    .eq("household_id", householdId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error || !data) return [];

  return (data as Record<string, unknown>[]).map((row) => {
    const type = String(row.type) as "subscription_price_change" | "bill_paid";
    const amount = typeof row.amount === "string" ? parseFloat(row.amount) : Number(row.amount ?? 0);
    const previousAmount =
      row.previous_amount == null
        ? null
        : typeof row.previous_amount === "string"
          ? parseFloat(row.previous_amount)
          : Number(row.previous_amount);
    const merchantLabel = String(row.merchant_label ?? row.merchant ?? "");
    const event: NotificationEvent = {
      type,
      dedupKey: String(row.dedup_key ?? ""),
      merchant: String(row.merchant ?? ""),
      merchantLabel,
      amount,
      previousAmount,
      occurredOn: String(row.occurred_on ?? "").slice(0, 10),
      categoryId: row.category_id ? String(row.category_id) : null,
    };
    return {
      id: String(row.id),
      type,
      severity: type === "subscription_price_change" ? "warning" : "info",
      title: eventTitle(event),
      preview: eventBody(event),
      date: event.occurredOn,
      transactionId: "",
      amount,
      rawDescription: merchantLabel,
      categoryName: null,
      categoryColor: null,
      previousAmount,
    } satisfies AlertItem;
  });
}

export async function fetchHouseholdAlertCount(
  supabase: SupabaseClient,
  householdId: string,
): Promise<number> {
  const alerts = await fetchHouseholdAlerts(supabase, householdId);
  return alerts.length;
}
