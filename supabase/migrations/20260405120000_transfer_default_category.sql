-- Add "Transfer" to default category seed (overview totals ignore this category).

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
       'Flights, hotels, rideshare on trips, and vacation spending.'),
      ('Transfer', '#64748b', 12,
       'Money moved between accounts (in or out). Not counted in overview income or spending; use for a clear ledger.')
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
