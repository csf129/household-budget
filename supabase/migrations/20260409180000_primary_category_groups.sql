-- Primary category groups: map each category to Income, Bank transfers,
-- Purchases & bills, Credit card payments, or custom groups for overview charts.

create table if not exists public.primary_category_groups (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  slug text not null,
  color text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (household_id, slug)
);

create index if not exists primary_category_groups_household_id_idx
  on public.primary_category_groups (household_id);

alter table public.categories
  add column if not exists primary_group_id uuid references public.primary_category_groups (id) on delete set null;

create index if not exists categories_primary_group_id_idx
  on public.categories (primary_group_id);

alter table public.primary_category_groups enable row level security;

create policy "primary_category_groups_all_member"
  on public.primary_category_groups
  for all
  using (household_id in (select public.user_household_ids()))
  with check (household_id in (select public.user_household_ids()));

-- -----------------------------------------------------------------------------
-- Ensure four built-in groups exist (idempotent)
-- -----------------------------------------------------------------------------

create or replace function public.ensure_primary_category_groups_for_household(p_household_id uuid)
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

  insert into public.primary_category_groups (household_id, name, slug, color, sort_order)
  values
    (p_household_id, 'Income', 'income', '#16a34a', 0),
    (p_household_id, 'Bank transfers', 'bank_transfers', '#64748b', 1),
    (p_household_id, 'Purchases & bills', 'purchases_bills', '#2563eb', 2),
    (p_household_id, 'Credit card payments', 'credit_card_payments', '#c2410c', 3)
  on conflict (household_id, slug) do nothing;

  update public.categories c
  set primary_group_id = g.id
  from public.primary_category_groups g
  where c.household_id = p_household_id
    and g.household_id = p_household_id
    and g.slug = 'bank_transfers'
    and lower(trim(c.name)) in ('transfer', 'transfers')
    and c.primary_group_id is distinct from g.id;

  update public.categories c
  set primary_group_id = g.id
  from public.primary_category_groups g
  where c.household_id = p_household_id
    and g.household_id = p_household_id
    and g.slug = 'credit_card_payments'
    and lower(replace(trim(c.name), '  ', ' ')) in (
      'credit card payment',
      'credit card payments'
    )
    and c.primary_group_id is distinct from g.id;

  update public.categories c
  set primary_group_id = g.id
  from public.primary_category_groups g
  where c.household_id = p_household_id
    and g.household_id = p_household_id
    and g.slug = 'purchases_bills'
    and c.primary_group_id is null;
end;
$$;

revoke all on function public.ensure_primary_category_groups_for_household(uuid) from public;
grant execute on function public.ensure_primary_category_groups_for_household(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- After seeding categories, attach primary_group_id to new template rows
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

  perform public.ensure_primary_category_groups_for_household(p_household_id);

  insert into public.categories (
    household_id, name, color, sort_order, description, primary_group_id
  )
  select
    p_household_id,
    t.name,
    t.color,
    t.sort_order,
    t.description,
    case
      when lower(trim(t.name)) in ('transfer', 'transfers') then (
        select g.id from public.primary_category_groups g
        where g.household_id = p_household_id and g.slug = 'bank_transfers'
      )
      when lower(trim(t.name)) in ('credit card payment', 'credit card payments') then (
        select g.id from public.primary_category_groups g
        where g.household_id = p_household_id and g.slug = 'credit_card_payments'
      )
      else (
        select g.id from public.primary_category_groups g
        where g.household_id = p_household_id and g.slug = 'purchases_bills'
      )
    end
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
       'Money moved between accounts (in or out). Not counted in overview income or spending; use for a clear ledger.'),
      ('Credit card payment', '#c2410c', 13,
       'Paying a card balance from your bank. Shown in the ledger but not in Overview income or spending, so card purchases are not double-counted.')
  ) as t(name, color, sort_order, description)
  where not exists (
    select 1
    from public.categories c
    where c.household_id = p_household_id
      and c.name = t.name
  );

  perform public.ensure_primary_category_groups_for_household(p_household_id);
end;
$$;

revoke all on function public.seed_default_categories(uuid) from public;
grant execute on function public.seed_default_categories(uuid) to authenticated;

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

  perform public.ensure_primary_category_groups_for_household(v_hid);
  perform public.seed_default_categories(v_hid);
end;
$$;

revoke all on function public.ensure_default_categories_for_my_household() from public;
grant execute on function public.ensure_default_categories_for_my_household() to authenticated;

-- -----------------------------------------------------------------------------
-- Backfill existing households (migration-time)
-- -----------------------------------------------------------------------------

insert into public.primary_category_groups (household_id, name, slug, color, sort_order)
select
  h.id,
  v.name,
  v.slug,
  v.color,
  v.sort_order
from public.households h
cross join (
  values
    ('Income', 'income', '#16a34a', 0),
    ('Bank transfers', 'bank_transfers', '#64748b', 1),
    ('Purchases & bills', 'purchases_bills', '#2563eb', 2),
    ('Credit card payments', 'credit_card_payments', '#c2410c', 3)
) as v(name, slug, color, sort_order)
on conflict (household_id, slug) do nothing;

update public.categories c
set primary_group_id = g.id
from public.primary_category_groups g
where c.household_id = g.household_id
  and g.slug = 'bank_transfers'
  and lower(trim(c.name)) in ('transfer', 'transfers');

update public.categories c
set primary_group_id = g.id
from public.primary_category_groups g
where c.household_id = g.household_id
  and g.slug = 'credit_card_payments'
  and lower(replace(trim(c.name), '  ', ' ')) in (
    'credit card payment',
    'credit card payments'
  );

update public.categories c
set primary_group_id = g.id
from public.primary_category_groups g
where c.household_id = g.household_id
  and g.slug = 'purchases_bills'
  and c.primary_group_id is null;
