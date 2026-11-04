-- Optional filter: a rule can require the transaction amount to equal a specific
-- magnitude (e.g. a $160 Venmo to the cleaners). Compared against the absolute
-- value of the amount, so the sign filter still controls debit vs credit.
-- NULL = any amount (existing behavior, backward compatible).

ALTER TABLE public.category_rules
  ADD COLUMN IF NOT EXISTS amount_exact numeric;

DO $$
BEGIN
  ALTER TABLE public.category_rules ADD CONSTRAINT category_rules_amount_exact_check
    CHECK (amount_exact IS NULL OR amount_exact >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Rebuild the uniqueness constraint so two rules can share description + sign
-- but differ by amount (e.g. "venmo any" vs "venmo = 160"). NULLS NOT DISTINCT
-- (PG15+) keeps the "remember category" upsert dedupe working for unbanded rows.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'category_rules'
      AND c.contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE public.category_rules DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.category_rules
  ADD CONSTRAINT category_rules_household_match_pattern_sign_amount_key
  UNIQUE NULLS NOT DISTINCT (household_id, match_type, pattern, amount_sign, amount_exact);
