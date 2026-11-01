-- Link ledger rows to Plaid bank_accounts for per-account analytics (e.g. signed transfer bars).
--
-- Runs after plaid_bank_link (20260414100000, creates bank_accounts +
-- plaid_transactions) and transactions_plaid_transaction_id (20260415120000),
-- so all referenced objects exist. Replaces the mis-ordered no-op at
-- 20260410140000. All statements are idempotent, so this is safe on databases
-- where the original migration already applied the column.

alter table public.transactions
  add column if not exists bank_account_id uuid references public.bank_accounts (id) on delete set null;

create index if not exists transactions_bank_account_id_idx
  on public.transactions (bank_account_id)
  where bank_account_id is not null;

comment on column public.transactions.bank_account_id is
  'Plaid-linked bank_accounts row when the transaction came from sync; used for account-scoped reporting.';

-- Backfill from plaid_transactions for rows already mirrored to the ledger.
update public.transactions t
set bank_account_id = p.bank_account_id
from public.plaid_transactions p
where t.plaid_transaction_id is not null
  and t.plaid_transaction_id = p.plaid_transaction_id
  and t.household_id = p.household_id
  and t.bank_account_id is null;
