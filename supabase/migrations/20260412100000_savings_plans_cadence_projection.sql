-- Extend savings increment cadence (daily … annually) and opt-in for spending projection.

alter table public.savings_plans
  add column if not exists include_in_projection boolean not null default true;

alter table public.savings_plans
  drop constraint if exists savings_plans_increment_period_check;

alter table public.savings_plans
  add constraint savings_plans_increment_period_check
  check (
    increment_period is null
    or increment_period in (
      'daily',
      'weekly',
      'biweekly',
      'monthly',
      'annually'
    )
  );
