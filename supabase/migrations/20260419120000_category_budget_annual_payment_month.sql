-- Annual lump budgets: amount is per year; `budget_annual_payment_month` is when it applies.

alter table public.categories
  add column if not exists budget_annual_payment_month smallint;

alter table public.categories
  drop constraint if exists categories_budget_amount_period_check;

alter table public.categories
  add constraint categories_budget_amount_period_check
  check (budget_amount_period in ('month', 'week', 'year'));

alter table public.categories
  drop constraint if exists categories_budget_annual_payment_month_check;

alter table public.categories
  add constraint categories_budget_annual_payment_month_check
  check (
    budget_annual_payment_month is null
    or (budget_annual_payment_month >= 1 and budget_annual_payment_month <= 12)
  );

comment on column public.categories.budget_annual_payment_month is
  'When budget_amount_period is year, calendar month (1–12) when the annual amount applies; null otherwise.';
