-- Household budget: core schema + RLS + RPCs for household onboarding.
-- Run in Supabase SQL Editor or via: supabase db push (if using Supabase CLI).

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Our household',
  invite_code text unique,
  created_at timestamptz not null default now()
);

create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  unique (household_id, user_id)
);

create index household_members_user_id_idx on public.household_members (user_id);
create index household_members_household_id_idx on public.household_members (household_id);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index accounts_household_id_idx on public.accounts (household_id);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  color text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (household_id, name)
);

create index categories_household_id_idx on public.categories (household_id);

create table public.category_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  match_type text not null check (match_type in ('exact_normalized', 'contains', 'prefix')),
  pattern text not null,
  priority int not null default 100,
  created_at timestamptz not null default now(),
  unique (household_id, match_type, pattern)
);

create index category_rules_household_id_idx on public.category_rules (household_id);
create index category_rules_lookup_idx on public.category_rules (household_id, priority desc);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  account_id uuid references public.accounts (id) on delete set null,
  category_id uuid references public.categories (id) on delete set null,
  amount numeric(14, 2) not null,
  occurred_on date not null,
  raw_description text not null,
  normalized_description text not null,
  notes text,
  applied_rule_id uuid references public.category_rules (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_amount_nonzero check (amount <> 0)
);

create index transactions_household_date_idx on public.transactions (household_id, occurred_on desc);
create index transactions_normalized_idx on public.transactions (household_id, normalized_description);

-- -----------------------------------------------------------------------------
-- updated_at trigger
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger transactions_set_updated_at
  before update on public.transactions
  for each row
  execute procedure public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RPC: create household (caller becomes owner; invite code generated)
-- -----------------------------------------------------------------------------

create or replace function public.create_household(p_name text default 'Our household')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'User already belongs to a household';
  end if;

  v_code := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));

  insert into public.households (name, invite_code)
  values (p_name, v_code)
  returning id into v_household_id;

  insert into public.household_members (household_id, user_id, role)
  values (v_household_id, auth.uid(), 'owner');

  return v_household_id;
end;
$$;

revoke all on function public.create_household(text) from public;
grant execute on function public.create_household(text) to authenticated;

-- -----------------------------------------------------------------------------
-- RPC: join household via invite code
-- -----------------------------------------------------------------------------

create or replace function public.join_household(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'User already belongs to a household';
  end if;

  v_code := upper(trim(p_invite_code));

  select id into v_household_id
  from public.households
  where invite_code is not null and invite_code = v_code;

  if v_household_id is null then
    raise exception 'Invalid invite code';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_household_id, auth.uid(), 'member');

  return v_household_id;
end;
$$;

revoke all on function public.join_household(text) from public;
grant execute on function public.join_household(text) to authenticated;

-- -----------------------------------------------------------------------------
-- RPC: regenerate invite (owners only)
-- -----------------------------------------------------------------------------

create or replace function public.regenerate_household_invite()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select household_id into v_household_id
  from public.household_members
  where user_id = auth.uid() and role = 'owner'
  limit 1;

  if v_household_id is null then
    raise exception 'Only owners can regenerate invite codes';
  end if;

  v_code := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));

  update public.households
  set invite_code = v_code
  where id = v_household_id;

  return v_code;
end;
$$;

revoke all on function public.regenerate_household_invite() from public;
grant execute on function public.regenerate_household_invite() to authenticated;

-- -----------------------------------------------------------------------------
-- RLS helper: household ids for current user
-- -----------------------------------------------------------------------------

create or replace function public.user_household_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select household_id from public.household_members where user_id = auth.uid();
$$;

grant execute on function public.user_household_ids() to authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.category_rules enable row level security;
alter table public.transactions enable row level security;

-- Households: members can read; owners can update name/invite
create policy "households_select_member"
  on public.households for select
  using (id in (select public.user_household_ids()));

create policy "households_update_owner"
  on public.households for update
  using (
    id in (
      select household_id from public.household_members
      where user_id = auth.uid() and role = 'owner'
    )
  )
  with check (
    id in (
      select household_id from public.household_members
      where user_id = auth.uid() and role = 'owner'
    )
  );

-- household_members: visible to same household
create policy "household_members_select"
  on public.household_members for select
  using (household_id in (select public.user_household_ids()));

-- No direct insert/delete on household_members from clients (RPCs only)

-- Accounts
create policy "accounts_all_member"
  on public.accounts for all
  using (household_id in (select public.user_household_ids()))
  with check (household_id in (select public.user_household_ids()));

-- Categories
create policy "categories_all_member"
  on public.categories for all
  using (household_id in (select public.user_household_ids()))
  with check (household_id in (select public.user_household_ids()));

-- Rules
create policy "category_rules_all_member"
  on public.category_rules for all
  using (household_id in (select public.user_household_ids()))
  with check (household_id in (select public.user_household_ids()));

-- Transactions
create policy "transactions_all_member"
  on public.transactions for all
  using (household_id in (select public.user_household_ids()))
  with check (household_id in (select public.user_household_ids()));
