-- Link main ledger rows to Plaid when a bank sync supersedes a CSV/manual duplicate.

alter table public.transactions
  add column if not exists plaid_transaction_id text;

create unique index if not exists transactions_plaid_transaction_id_uidx
  on public.transactions (plaid_transaction_id)
  where plaid_transaction_id is not null;

comment on column public.transactions.plaid_transaction_id is
  'Plaid transaction_id when this row was created or updated from Plaid; prevents double supersede and matches CSV dedupe.';
