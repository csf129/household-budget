/** Stable slugs for built-in primary groups (match Supabase seed). */
export const PRIMARY_SLUG_INCOME = "income";
export const PRIMARY_SLUG_BANK_TRANSFERS = "bank_transfers";
export const PRIMARY_SLUG_PURCHASES_BILLS = "purchases_bills";
export const PRIMARY_SLUG_CREDIT_CARD_PAYMENTS = "credit_card_payments";

export const BUILTIN_PRIMARY_SLUGS = [
  PRIMARY_SLUG_INCOME,
  PRIMARY_SLUG_BANK_TRANSFERS,
  PRIMARY_SLUG_PURCHASES_BILLS,
  PRIMARY_SLUG_CREDIT_CARD_PAYMENTS,
] as const;

export type BuiltinPrimarySlug = (typeof BUILTIN_PRIMARY_SLUGS)[number];

export function isBuiltinPrimarySlug(slug: string): slug is BuiltinPrimarySlug {
  return (BUILTIN_PRIMARY_SLUGS as readonly string[]).includes(slug);
}
