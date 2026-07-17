import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreditCardStatus, CreditCardView } from "@/types/credit-card";
import { buildCardReminders } from "@/lib/credit-card-reminders";

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toInt(v: unknown): number | null {
  const n = toNum(v);
  return n === null ? null : Math.trunc(n);
}

const VALID_STATUS: CreditCardStatus[] = ["active", "review", "cancelled"];

/**
 * Loads all Plaid-linked credit accounts (bank_accounts.type = 'credit') for the
 * household, joined with user-entered credit_cards metadata (null when absent).
 */
export async function fetchCreditCards(
  supabase: SupabaseClient,
  householdId: string,
): Promise<{ rows: CreditCardView[]; error: string | null }> {
  const { data: accts, error: acctErr } = await supabase
    .from("bank_accounts")
    .select(
      "id, name, display_name, mask, type, current_balance, available_balance, iso_currency_code",
    )
    .eq("household_id", householdId)
    .eq("type", "credit")
    .order("name", { ascending: true });

  if (acctErr) return { rows: [], error: acctErr.message };

  const accounts = accts ?? [];
  if (accounts.length === 0) return { rows: [], error: null };

  const ids = accounts.map((a) => String(a.id));

  const { data: meta, error: metaErr } = await supabase
    .from("credit_cards")
    .select(
      "bank_account_id, annual_fee, annual_fee_month, payment_due_day, points_program, points_balance, points_updated_on, reward_summary, status, notes",
    )
    .eq("household_id", householdId)
    .in("bank_account_id", ids);

  if (metaErr) return { rows: [], error: metaErr.message };

  const metaByAccount = new Map<string, Record<string, unknown>>();
  for (const m of meta ?? []) {
    metaByAccount.set(String((m as { bank_account_id: string }).bank_account_id), m as Record<string, unknown>);
  }

  const rows: CreditCardView[] = accounts.map((a) => {
    const acct = a as Record<string, unknown>;
    const m = metaByAccount.get(String(acct.id));
    const plaidName = String(acct.name ?? "");
    const nickname = acct.display_name ? String(acct.display_name) : "";
    const statusRaw = m ? String(m.status ?? "active") : "active";
    const status: CreditCardStatus = VALID_STATUS.includes(statusRaw as CreditCardStatus)
      ? (statusRaw as CreditCardStatus)
      : "active";

    return {
      id: String(acct.id),
      name: nickname || plaidName,
      plaidName,
      mask: acct.mask ? String(acct.mask) : null,
      currentBalance: toNum(acct.current_balance),
      availableBalance: toNum(acct.available_balance),
      isoCurrencyCode: acct.iso_currency_code ? String(acct.iso_currency_code) : null,
      annualFee: m ? toNum(m.annual_fee) : null,
      annualFeeMonth: m ? toInt(m.annual_fee_month) : null,
      paymentDueDay: m ? toInt(m.payment_due_day) : null,
      pointsProgram: m && m.points_program ? String(m.points_program) : null,
      pointsBalance: m ? toInt(m.points_balance) : null,
      pointsUpdatedOn: m && m.points_updated_on ? String(m.points_updated_on) : null,
      rewardSummary: m && m.reward_summary ? String(m.reward_summary) : null,
      status,
      notes: m && m.notes ? String(m.notes) : null,
    };
  });

  return { rows, error: null };
}

/**
 * Number of active credit-card reminders (upcoming payments + fee renewals) for
 * the sidebar badge. Returns 0 on any error so the nav never breaks.
 */
export async function fetchCreditCardReminderCount(
  supabase: SupabaseClient,
  householdId: string,
): Promise<number> {
  const { rows, error } = await fetchCreditCards(supabase, householdId);
  if (error) return 0;
  return buildCardReminders(rows).length;
}
