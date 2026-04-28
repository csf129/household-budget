-- Optional filter: rule applies only to positive, only to negative, or any non-zero amount.

-- category_rules
ALTER TABLE public.category_rules ADD COLUMN IF NOT EXISTS amount_sign text;

UPDATE public.category_rules SET amount_sign = 'any' WHERE amount_sign IS NULL;

ALTER TABLE public.category_rules ALTER COLUMN amount_sign SET DEFAULT 'any';
ALTER TABLE public.category_rules ALTER COLUMN amount_sign SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE public.category_rules ADD CONSTRAINT category_rules_amount_sign_check
    CHECK (amount_sign IN ('any', 'positive', 'negative'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

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
  ADD CONSTRAINT category_rules_household_match_pattern_sign_key
  UNIQUE (household_id, match_type, pattern, amount_sign);

-- income_classification_rules
ALTER TABLE public.income_classification_rules ADD COLUMN IF NOT EXISTS amount_sign text;

UPDATE public.income_classification_rules SET amount_sign = 'any' WHERE amount_sign IS NULL;

ALTER TABLE public.income_classification_rules ALTER COLUMN amount_sign SET DEFAULT 'any';
ALTER TABLE public.income_classification_rules ALTER COLUMN amount_sign SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE public.income_classification_rules ADD CONSTRAINT income_classification_rules_amount_sign_check
    CHECK (amount_sign IN ('any', 'positive', 'negative'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'income_classification_rules'
      AND c.contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE public.income_classification_rules DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.income_classification_rules
  ADD CONSTRAINT income_classification_rules_household_match_pattern_sign_key
  UNIQUE (household_id, match_type, pattern, amount_sign);
