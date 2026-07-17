ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS savings_plan_id uuid REFERENCES savings_plans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS transactions_savings_plan_id_idx
  ON transactions (household_id, savings_plan_id)
  WHERE savings_plan_id IS NOT NULL;
