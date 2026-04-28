-- Email summary subscription settings per household.
CREATE TABLE email_summary_settings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  recipients      text[] NOT NULL DEFAULT '{}',
  -- Multiple frequencies can be selected (e.g. weekly + monthly)
  frequencies     text[] NOT NULL DEFAULT '{}',
  -- Which sections to include in the email
  section_income_spending    boolean NOT NULL DEFAULT true,
  section_category_breakdown boolean NOT NULL DEFAULT true,
  section_budget_progress    boolean NOT NULL DEFAULT false,
  section_top_transactions   boolean NOT NULL DEFAULT false,
  section_business_expenses  boolean NOT NULL DEFAULT false,
  section_savings_plans      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_sent_at    timestamptz,
  UNIQUE (household_id)
);

ALTER TABLE email_summary_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "household members can manage email summary settings"
  ON email_summary_settings
  FOR ALL
  USING (
    household_id IN (
      SELECT household_id FROM household_members WHERE user_id = auth.uid()
    )
  );
