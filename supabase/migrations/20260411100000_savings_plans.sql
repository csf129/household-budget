-- Savings / project / vacation plans: target amount, timeline, optional recurring increment pace, contributions.

create table public.savings_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null,
  plan_kind text not null check (plan_kind in ('project', 'vacation')),
  target_amount numeric(14, 2) not null check (target_amount > 0),
  start_date date not null,
  target_date date not null,
  increment_amount numeric(14, 2),
  increment_period text check (
    increment_period is null
    or increment_period in ('weekly', 'biweekly', 'monthly')
  ),
  is_archived boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint savings_plans_dates_ok check (target_date >= start_date),
  constraint savings_plans_increment_pair check (
    (increment_amount is null and increment_period is null)
    or (
      increment_amount is not null
      and increment_period is not null
      and increment_amount > 0
    )
  )
);

create index savings_plans_household_id_idx on public.savings_plans (household_id);
create index savings_plans_household_active_idx
  on public.savings_plans (household_id, is_archived);

create trigger savings_plans_set_updated_at
  before update on public.savings_plans
  for each row
  execute procedure public.set_updated_at();

create table public.savings_plan_contributions (
  id uuid primary key default gen_random_uuid(),
  savings_plan_id uuid not null references public.savings_plans (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  contributed_on date not null default (current_date),
  note text,
  created_at timestamptz not null default now()
);

create index savings_plan_contributions_plan_id_idx
  on public.savings_plan_contributions (savings_plan_id);
create index savings_plan_contributions_household_id_idx
  on public.savings_plan_contributions (household_id);

alter table public.savings_plans enable row level security;
alter table public.savings_plan_contributions enable row level security;

create policy "savings_plans_all_member"
  on public.savings_plans
  for all
  using (household_id in (select public.user_household_ids()))
  with check (household_id in (select public.user_household_ids()));

create policy "savings_plan_contributions_all_member"
  on public.savings_plan_contributions
  for all
  using (household_id in (select public.user_household_ids()))
  with check (household_id in (select public.user_household_ids()));
