-- AI request rate limiting.
--
-- Every AI-backed endpoint (chat, auto-categorize, classify-income,
-- budget-propose, insights, assistant actions) spends real money on a model
-- provider and, before this, any household member could trigger them in a loop
-- with no ceiling. This adds a fixed-window counter per household, shared across
-- all of those endpoints, so total paid AI requests are bounded per minute.

create table if not exists public.ai_usage_counters (
  household_id  uuid        not null references public.households (id) on delete cascade,
  window_start  timestamptz not null,
  request_count integer     not null default 0,
  primary key (household_id, window_start)
);

-- Only the SECURITY DEFINER function below ever touches this table. RLS on with
-- no policies => no direct client access (matches bank_connection_secrets).
alter table public.ai_usage_counters enable row level security;

-- Atomically increment the current window's counter for a household and return
-- the new count. SECURITY DEFINER so it can write past RLS, but it verifies the
-- caller actually belongs to the household first, so a member cannot inflate
-- another household's counter (which would deny that household its AI quota).
create or replace function public.increment_ai_usage(
  p_household_id  uuid,
  p_window_seconds integer
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window integer := coalesce(nullif(p_window_seconds, 0), 60);
  v_bucket timestamptz;
  v_count  integer;
begin
  if v_window <= 0 then
    v_window := 60;
  end if;

  -- The caller must be a member of the household it is spending AI quota for.
  if not exists (
    select 1
    from public.household_members
    where household_id = p_household_id
      and user_id = auth.uid()
  ) then
    raise exception 'not a household member';
  end if;

  v_bucket := to_timestamp(
    floor(extract(epoch from now()) / v_window) * v_window
  );

  insert into public.ai_usage_counters (household_id, window_start, request_count)
  values (p_household_id, v_bucket, 1)
  on conflict (household_id, window_start)
  do update set request_count = public.ai_usage_counters.request_count + 1
  returning request_count into v_count;

  -- Opportunistic cleanup so the table does not grow without a separate cron.
  delete from public.ai_usage_counters
  where household_id = p_household_id
    and window_start < v_bucket - make_interval(secs => v_window * 5);

  return v_count;
end;
$$;

revoke all on function public.increment_ai_usage(uuid, integer) from public;
grant execute on function public.increment_ai_usage(uuid, integer) to authenticated, service_role;
