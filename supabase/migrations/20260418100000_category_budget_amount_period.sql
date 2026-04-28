-- Whether `monthly_budget` is interpreted as dollars per month or per week.

alter table public.categories
  add column if not exists budget_amount_period text not null default 'month';

alter table public.categories
  drop constraint if exists categories_budget_amount_period_check;

alter table public.categories
  add constraint categories_budget_amount_period_check
  check (budget_amount_period in ('month', 'week'));

comment on column public.categories.budget_amount_period is
  'month: monthly_budget is per calendar month. week: monthly_budget stores dollars per week.';
