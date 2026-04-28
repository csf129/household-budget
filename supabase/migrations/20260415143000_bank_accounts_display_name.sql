-- Optional user-defined nickname for Plaid-linked bank accounts/cards.

alter table public.bank_accounts
  add column if not exists display_name text;

comment on column public.bank_accounts.display_name is
  'User-defined label for Plaid account/card (e.g. "BOA Travel Visa").';

