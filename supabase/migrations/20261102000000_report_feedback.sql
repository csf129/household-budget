-- Report feedback: household notes on the budget report that persist and feed
-- back into future AI savings analysis (the in-app deep-dive and the
-- /budget-report skill artifact).
--
-- One editable note per (household, category). `category` is the savings
-- opportunity / spending area the note is about, e.g. "Karate" or
-- "Food & drink"; the empty string "" is reserved for a general, report-wide
-- note. Clearing a note deletes its row. Any household member may read or
-- write — notes are shared household context, not per-user.

CREATE TABLE report_feedback (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  -- Savings area/category the note pertains to; "" = general report note.
  category     text NOT NULL DEFAULT '',
  note         text NOT NULL,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, category)
);

CREATE INDEX report_feedback_household_idx ON report_feedback (household_id);

ALTER TABLE report_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "household members can manage report feedback"
  ON report_feedback
  FOR ALL
  USING (
    household_id IN (
      SELECT household_id FROM household_members WHERE user_id = auth.uid()
    )
  );

CREATE TRIGGER report_feedback_set_updated_at
  BEFORE UPDATE ON report_feedback
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();
