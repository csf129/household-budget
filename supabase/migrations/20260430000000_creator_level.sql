-- Creator level: a level above Head, used for previewing the app as other levels.
--
-- Levels, highest first:
--   creator  — everything a head can do, plus the "View as" switcher
--   owner    — "Head" in the UI
--   member   — "Family member" in the UI
--
-- Creator is deliberately NOT grantable through the app. set_household_member_role
-- and remove_household_member both refuse to touch a creator row or hand out the
-- level, so a head cannot escalate themselves. Granting happens here, in SQL.

-- -----------------------------------------------------------------------------
-- Widen the role constraint
-- -----------------------------------------------------------------------------

alter table public.household_members
  drop constraint if exists household_members_role_check;

alter table public.household_members
  add constraint household_members_role_check
  check (role in ('creator', 'owner', 'member'));

-- -----------------------------------------------------------------------------
-- A creator is a head for every existing permission check
-- -----------------------------------------------------------------------------

create or replace function public.is_household_head(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members
    where household_id = p_household_id
      and user_id = auth.uid()
      and role in ('owner', 'creator')
  );
$$;

create or replace function public.is_household_creator(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members
    where household_id = p_household_id
      and user_id = auth.uid()
      and role = 'creator'
  );
$$;

grant execute on function public.is_household_creator(uuid) to authenticated;

-- Existing policy hardcoded role = 'owner', which would lock creators out.
drop policy if exists "households_update_owner" on public.households;

create policy "households_update_head"
  on public.households for update
  using (
    id in (
      select household_id from public.household_members
      where user_id = auth.uid() and role in ('owner', 'creator')
    )
  )
  with check (
    id in (
      select household_id from public.household_members
      where user_id = auth.uid() and role in ('owner', 'creator')
    )
  );

-- Same hardcoded 'owner' problem in the invite RPC.
create or replace function public.regenerate_household_invite()
returns text
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

  select household_id into v_household_id
  from public.household_members
  where user_id = auth.uid() and role in ('owner', 'creator')
  limit 1;

  if v_household_id is null then
    raise exception 'Only a household head can regenerate invite codes';
  end if;

  v_code := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));

  update public.households
  set invite_code = v_code
  where id = v_household_id;

  return v_code;
end;
$$;

-- -----------------------------------------------------------------------------
-- Member listing: creators first, then heads, then family members
-- -----------------------------------------------------------------------------

create or replace function public.list_household_members()
returns table (
  id uuid,
  user_id uuid,
  email text,
  display_name text,
  role text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id,
    m.user_id,
    u.email::text,
    m.display_name,
    m.role,
    m.created_at
  from public.household_members m
  join auth.users u on u.id = m.user_id
  where m.household_id in (select public.user_household_ids())
  order by
    case m.role when 'creator' then 0 when 'owner' then 1 else 2 end,
    m.created_at asc;
$$;

-- -----------------------------------------------------------------------------
-- Role changes: heads may not grant, demote, or remove a creator
-- -----------------------------------------------------------------------------

create or replace function public.set_household_member_role(
  p_member_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_current_role text;
  v_head_count int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- Creator is granted in SQL only; it is never handed out through the app.
  if p_role not in ('owner', 'member') then
    raise exception 'Invalid role';
  end if;

  select household_id, role into v_household_id, v_current_role
  from public.household_members
  where id = p_member_id;

  if v_household_id is null then
    raise exception 'Member not found';
  end if;

  if not public.is_household_head(v_household_id) then
    raise exception 'Only a household head can change member levels';
  end if;

  if v_current_role = 'creator' then
    raise exception 'The creator level cannot be changed from the app';
  end if;

  if v_current_role = p_role then
    return;
  end if;

  -- Demoting a head: keep at least one head (creators count) in the household.
  if v_current_role = 'owner' and p_role = 'member' then
    select count(*) into v_head_count
    from public.household_members
    where household_id = v_household_id and role in ('owner', 'creator');

    if v_head_count <= 1 then
      raise exception 'A household must have at least one head';
    end if;
  end if;

  update public.household_members
  set role = p_role
  where id = p_member_id;
end;
$$;

create or replace function public.remove_household_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_user_id uuid;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select household_id, user_id, role into v_household_id, v_user_id, v_role
  from public.household_members
  where id = p_member_id;

  if v_household_id is null then
    raise exception 'Member not found';
  end if;

  if not public.is_household_head(v_household_id) then
    raise exception 'Only a household head can remove members';
  end if;

  if v_role = 'creator' then
    raise exception 'A creator cannot be removed from the app';
  end if;

  if v_user_id = auth.uid() then
    raise exception 'You cannot remove yourself from the household';
  end if;

  delete from public.household_members
  where id = p_member_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grant the creator level (bootstrap; SQL is the only way in)
-- -----------------------------------------------------------------------------

update public.household_members m
set role = 'creator'
from auth.users u
where u.id = m.user_id
  and lower(u.email) = 'csf129@gmail.com';
