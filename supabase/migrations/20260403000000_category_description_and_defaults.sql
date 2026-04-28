-- Category descriptions + Chase-style default categories.
-- Run in Supabase SQL Editor after the initial migration, or via supabase db push.

alter table public.categories
  add column if not exists description text;

-- -----------------------------------------------------------------------------
-- Seed template categories (skips names that already exist for the household)
-- -----------------------------------------------------------------------------

create or replace function public.seed_default_categories(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = auth.uid()
  ) then
    raise exception 'Not a member of this household';
  end if;

  insert into public.categories (household_id, name, color, sort_order, description)
  select
    p_household_id,
    t.name,
    t.color,
    t.sort_order,
    t.description
  from (
    values
      ('Miscellaneous', '#9ca3af', 0,
       'Odds and ends that do not fit a more specific category.'),
      ('Personal', '#a16207', 1,
       'Clothing, haircuts, personal care, and similar.'),
      ('Shopping', '#db2777', 2,
       'Retail purchases that are not groceries (online or in-store).'),
      ('Home', '#a855f7', 3,
       'Furniture, decor, maintenance, and home supplies.'),
      ('Groceries', '#2563eb', 4,
       'Supermarket and grocery spending.'),
      ('Gas', '#1e3a8a', 5,
       'Fuel for vehicles.'),
      ('Bills & utilities', '#5b21b6', 6,
       'Recurring services: electric, water, internet, phone, subscriptions, etc.'),
      ('Food & drink', '#0d9488', 7,
       'Restaurants, coffee shops, takeout, and bars.'),
      ('Health & wellness', '#15803d', 8,
       'Medical, pharmacy, gym, and wellness.'),
      ('Fees & adjustments', '#ea580c', 9,
       'Bank fees, refunds, adjustments, and one-off charges to reconcile.'),
      ('Education', '#06b6d4', 10,
       'Tuition, courses, books, and school-related costs.'),
      ('Travel', '#9d174d', 11,
       'Flights, hotels, rideshare on trips, and vacation spending.')
  ) as t(name, color, sort_order, description)
  where not exists (
    select 1
    from public.categories c
    where c.household_id = p_household_id
      and c.name = t.name
  );
end;
$$;

revoke all on function public.seed_default_categories(uuid) from public;
grant execute on function public.seed_default_categories(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Idempotent: add any missing template categories for the caller's household
-- -----------------------------------------------------------------------------

create or replace function public.ensure_default_categories_for_my_household()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hid uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select household_id into v_hid
  from public.household_members
  where user_id = auth.uid()
  limit 1;

  if v_hid is null then
    return;
  end if;

  perform public.seed_default_categories(v_hid);
end;
$$;

revoke all on function public.ensure_default_categories_for_my_household() from public;
grant execute on function public.ensure_default_categories_for_my_household() to authenticated;

-- -----------------------------------------------------------------------------
-- create_household: seed defaults for new households
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

  perform public.seed_default_categories(v_household_id);

  return v_household_id;
end;
$$;
