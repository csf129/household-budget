-- Optional budget season: recurring month/day window, or one-time date range.

alter table public.categories
  add column if not exists budget_repeats_annually boolean not null default true;

alter table public.categories
  add column if not exists budget_active_from_month smallint;

alter table public.categories
  add column if not exists budget_active_from_day smallint;

alter table public.categories
  add column if not exists budget_active_to_month smallint;

alter table public.categories
  add column if not exists budget_active_to_day smallint;

alter table public.categories
  add column if not exists budget_period_start date;

alter table public.categories
  add column if not exists budget_period_end date;

comment on column public.categories.budget_repeats_annually is
  'When true (default), budget_active_* month/day repeat every calendar year. When false, budget_period_* dates apply instead.';

comment on column public.categories.budget_active_from_month is
  '1–12; use with budget_active_from_day and *_to_* for annual season. All four null = budget applies year-round.';
