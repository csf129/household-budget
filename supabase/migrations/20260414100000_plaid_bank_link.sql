-- Plaid bank linking (household-scoped). Access tokens live in bank_connection_secrets
-- with RLS and no policies so only the service role (server) can read them.

-- -----------------------------------------------------------------------------
-- profiles (1:1 with auth.users), optional metadata surface
-- -----------------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = user_id);

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = user_id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row
  execute procedure public.handle_new_user_profile();

-- -----------------------------------------------------------------------------
-- bank_connections (no secret payload here — safe for member SELECT)
-- -----------------------------------------------------------------------------

create table public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  linked_by_user_id uuid references auth.users (id) on delete set null,
  plaid_item_id text not null unique,
  institution_id text,
  institution_name text,
  status text not null default 'active',
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index bank_connections_household_id_idx on public.bank_connections (household_id);

alter table public.bank_connections enable row level security;

create policy "bank_connections_all_household_member"
  on public.bank_connections for all
  using (household_id in (select public.user_household_ids()))
  with check (household_id in (select public.user_household_ids()));

-- Service-role only: no policies = JWT roles cannot read/write
create table public.bank_connection_secrets (
  bank_connection_id uuid primary key references public.bank_connections (id) on delete cascade,
  plaid_access_token_ciphertext text not null,
  updated_at timestamptz not null default now()
);

alter table public.bank_connection_secrets enable row level security;

create table public.plaid_sync_state (
  bank_connection_id uuid primary key references public.bank_connections (id) on delete cascade,
  transactions_cursor text,
  updated_at timestamptz not null default now()
);

alter table public.plaid_sync_state enable row level security;

-- -----------------------------------------------------------------------------
-- bank_accounts
-- -----------------------------------------------------------------------------

create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  bank_connection_id uuid not null references public.bank_connections (id) on delete cascade,
  plaid_account_id text not null unique,
  name text not null,
  official_name text,
  mask text,
  type text,
  subtype text,
  current_balance numeric(14, 2),
  available_balance numeric(14, 2),
  iso_currency_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index bank_accounts_household_id_idx on public.bank_accounts (household_id);
create index bank_accounts_connection_idx on public.bank_accounts (bank_connection_id);

alter table public.bank_accounts enable row level security;

create policy "bank_accounts_all_household_member"
  on public.bank_accounts for all
  using (household_id in (select public.user_household_ids()))
  with check (household_id in (select public.user_household_ids()));

-- -----------------------------------------------------------------------------
-- plaid_transactions (Plaid feed; separate from public.transactions ledger)
-- Amount matches Plaid API sign (positive = outflow for depository).
-- -----------------------------------------------------------------------------

create table public.plaid_transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  bank_account_id uuid not null references public.bank_accounts (id) on delete cascade,
  plaid_transaction_id text not null unique,
  pending boolean not null default false,
  name text not null,
  merchant_name text,
  amount numeric(14, 2) not null,
  iso_currency_code text,
  authorized_date date,
  posted_date date,
  category jsonb,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index plaid_transactions_household_date_idx
  on public.plaid_transactions (household_id, posted_date desc nulls last);

create index plaid_transactions_account_idx
  on public.plaid_transactions (bank_account_id);

alter table public.plaid_transactions enable row level security;

create policy "plaid_transactions_all_household_member"
  on public.plaid_transactions for all
  using (household_id in (select public.user_household_ids()))
  with check (household_id in (select public.user_household_ids()));

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------

create trigger bank_connections_set_updated_at
  before update on public.bank_connections
  for each row
  execute procedure public.set_updated_at();

create trigger bank_accounts_set_updated_at
  before update on public.bank_accounts
  for each row
  execute procedure public.set_updated_at();

create trigger plaid_transactions_set_updated_at
  before update on public.plaid_transactions
  for each row
  execute procedure public.set_updated_at();
