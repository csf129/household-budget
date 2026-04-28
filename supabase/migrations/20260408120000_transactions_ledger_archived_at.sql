-- Soft-archive non-Plaid ledger rows: hidden from dashboard & active ledger until restored.

alter table public.transactions
  add column if not exists ledger_archived_at timestamptz null;

comment on column public.transactions.ledger_archived_at is
  'When set, row is excluded from active ledger, dashboard, and imports dedupe; clear to restore.';

create index if not exists transactions_household_archived_idx
  on public.transactions (household_id, ledger_archived_at)
  where ledger_archived_at is not null;
