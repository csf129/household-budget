-- Optional: whether the expense is a recurring charge and how often it repeats.

alter table public.categories
  add column if not exists budget_recurring_payment boolean not null default false;

alter table public.categories
  add column if not exists budget_recurring_interval text;

alter table public.categories
  drop constraint if exists categories_budget_recurring_interval_check;

alter table public.categories
  add constraint categories_budget_recurring_interval_check
  check (
    budget_recurring_interval is null
    or budget_recurring_interval in (
      'weekly',
      'monthly',
      'quarterly',
      'semiannual',
      'annual'
    )
  );

comment on column public.categories.budget_recurring_payment is
  'True when this budget line follows a repeating payment schedule.';

comment on column public.categories.budget_recurring_interval is
  'How often the charge repeats: weekly, monthly, quarterly, semiannual, annual.';
