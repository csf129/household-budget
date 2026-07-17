-- AI model preference per household.
CREATE TABLE ai_settings (
  household_id  uuid PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  model_id      text NOT NULL DEFAULT 'gpt-4o-mini',
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "household members can manage ai settings"
  ON ai_settings
  FOR ALL
  USING (
    household_id IN (
      SELECT household_id FROM household_members WHERE user_id = auth.uid()
    )
  );
