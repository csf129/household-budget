-- Optional parent category: one level of subcategories per household.
-- Subcategories inherit primary_group_id from their parent (enforced by trigger).

alter table public.categories
  drop constraint if exists categories_household_id_name_key;

alter table public.categories
  add column if not exists parent_category_id uuid
    references public.categories (id) on delete restrict;

create index if not exists categories_parent_category_id_idx
  on public.categories (parent_category_id)
  where parent_category_id is not null;

-- Top-level category names unique per household
create unique index if not exists categories_household_top_level_name_uniq
  on public.categories (household_id, name)
  where parent_category_id is null;

-- Subcategory names unique per parent
create unique index if not exists categories_household_parent_name_uniq
  on public.categories (household_id, parent_category_id, name)
  where parent_category_id is not null;

comment on column public.categories.parent_category_id is
  'When set, this category is a subcategory of the referenced top-level category (no deeper nesting).';

-- Enforce: parent is top-level (its parent_category_id is null), same household; sync primary_group_id from parent
create or replace function public.categories_before_subcategory_sync()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  p_household uuid;
  p_parent_of_parent uuid;
  p_primary uuid;
begin
  if new.parent_category_id is null then
    return new;
  end if;

  select c.household_id, c.parent_category_id, c.primary_group_id
  into p_household, p_parent_of_parent, p_primary
  from public.categories c
  where c.id = new.parent_category_id;

  if p_household is null then
    raise exception 'Parent category not found';
  end if;

  if p_household is distinct from new.household_id then
    raise exception 'Parent category must belong to the same household';
  end if;

  if p_parent_of_parent is not null then
    raise exception 'Subcategories cannot be nested; choose a top-level parent only';
  end if;

  new.primary_group_id := p_primary;
  return new;
end;
$$;

drop trigger if exists categories_before_subcategory_sync on public.categories;
create trigger categories_before_subcategory_sync
  before insert or update of parent_category_id, household_id
  on public.categories
  for each row
  execute procedure public.categories_before_subcategory_sync();

-- When a top-level category's primary group changes, push to its direct subcategories
create or replace function public.categories_cascade_primary_to_subcategories()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.parent_category_id is not null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.primary_group_id is not distinct from old.primary_group_id then
    return new;
  end if;

  update public.categories c
  set primary_group_id = new.primary_group_id
  where c.parent_category_id = new.id
    and c.household_id = new.household_id;

  return new;
end;
$$;

drop trigger if exists categories_cascade_primary_to_subcategories on public.categories;
create trigger categories_cascade_primary_to_subcategories
  after insert or update of primary_group_id
  on public.categories
  for each row
  execute procedure public.categories_cascade_primary_to_subcategories();
