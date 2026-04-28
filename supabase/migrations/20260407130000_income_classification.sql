-- Rules and per-transaction flags for what counts as "income" on the overview.
-- Idempotent: safe to run again in the Supabase SQL Editor if needed.

create table if not exists public.income_classification_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  match_type text not null check (match_type in ('exact_normalized', 'contains', 'prefix')),
  pattern text not null,
  treatment text not null check (treatment in ('include', 'exclude')),
  priority int not null default 100,
  created_at timestamptz not null default now(),
  unique (household_id, match_type, pattern)
);

create index if not exists income_classification_rules_household_id_idx
  on public.income_classification_rules (household_id);

create index if not exists income_classification_rules_lookup_idx
  on public.income_classification_rules (household_id, priority desc);

alter table public.transactions
  add column if not exists income_treatment text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'transactions_income_treatment_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_income_treatment_check
      check (income_treatment is null or income_treatment in ('include', 'exclude'));
  end if;
end $$;

comment on column public.transactions.income_treatment is
  'Override for overview income: include = always count positive as income; exclude = never; null = use income rules + defaults.';

alter table public.income_classification_rules enable row level security;

-- Avoid DROP POLICY (Supabase SQL editor warns about "destructive" drops).
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'income_classification_rules'
      and policyname = 'income_classification_rules_all_member'
  ) then
    create policy "income_classification_rules_all_member"
      on public.income_classification_rules for all
      using (household_id in (select public.user_household_ids()))
      with check (household_id in (select public.user_household_ids()));
  end if;
end $$;
