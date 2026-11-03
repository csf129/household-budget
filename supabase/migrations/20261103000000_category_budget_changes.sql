-- Audit trail for category monthly-budget changes, so the report can show a
-- history of who changed a budget, from what to what, and when.
--
-- One row per change. `category_name` snapshots the category's display label at
-- change time so the history stays readable even if the category is later
-- renamed or deleted. Amounts are the raw monthly_budget value (null = no
-- budget set / cleared). `source` records where the change was made.

CREATE TABLE category_budget_changes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  category_id   uuid REFERENCES categories(id) ON DELETE SET NULL,
  category_name text NOT NULL,
  old_amount    numeric(14, 2),
  new_amount    numeric(14, 2),
  changed_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source        text NOT NULL DEFAULT 'report' CHECK (source IN ('report', 'settings')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX category_budget_changes_household_created_idx
  ON category_budget_changes (household_id, created_at DESC);

ALTER TABLE category_budget_changes ENABLE ROW LEVEL SECURITY;

-- Any household member may read the history and record a change. Who may
-- actually change a budget is enforced in the route (head-only), not here.
CREATE POLICY "household members can manage budget changes"
  ON category_budget_changes
  FOR ALL
  USING (
    household_id IN (
      SELECT household_id FROM household_members WHERE user_id = auth.uid()
    )
  );
