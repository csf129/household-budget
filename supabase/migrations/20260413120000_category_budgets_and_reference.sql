-- Planned monthly budgets per category + optional imported spreadsheet snapshot for AI.

alter table public.categories
  add column if not exists monthly_budget numeric(14, 2);

comment on column public.categories.monthly_budget is
  'Planned monthly spending (USD). Null means no budget set.';

create table public.household_budget_reference (
  household_id uuid primary key references public.households (id) on delete cascade,
  source_filename text,
  line_items jsonb not null default '[]'::jsonb,
  last_ai_summary text,
  updated_at timestamptz not null default now()
);

create index household_budget_reference_updated_idx
  on public.household_budget_reference (updated_at desc);

alter table public.household_budget_reference enable row level security;

create policy "household_budget_reference_all_member"
  on public.household_budget_reference for all
  using (household_id in (select public.user_household_ids()))
  with check (household_id in (select public.user_household_ids()));
