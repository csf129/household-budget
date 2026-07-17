-- Household member levels: Head (stored as 'owner') and Family member (stored as 'member').
-- The stored values stay 'owner'/'member' so existing RLS policies and RPCs keep working;
-- "Head" / "Family member" are the labels the UI presents for them.
--
-- Adds:
--   * household_members.display_name  — optional friendly name a Head can set per member
--   * list_household_members()        — members of the caller's household, with emails
--   * set_household_member_role()     — Head promotes/demotes; last Head cannot be demoted
--   * set_household_member_display_name()
--   * remove_household_member()       — Head revokes access; cannot remove self

alter table public.household_members
  add column if not exists display_name text;

-- -----------------------------------------------------------------------------
-- Helper: is the current user a Head of this household?
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
      and role = 'owner'
  );
$$;

grant execute on function public.is_household_head(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- RPC: list members of the caller's household (includes auth emails)
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
  order by (m.role = 'owner') desc, m.created_at asc;
$$;

revoke all on function public.list_household_members() from public;
grant execute on function public.list_household_members() to authenticated;

-- -----------------------------------------------------------------------------
-- RPC: change a member's level (Head only)
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

  if v_current_role = p_role then
    return;
  end if;

  -- Demoting a head: keep at least one head in the household.
  if v_current_role = 'owner' and p_role = 'member' then
    select count(*) into v_head_count
    from public.household_members
    where household_id = v_household_id and role = 'owner';

    if v_head_count <= 1 then
      raise exception 'A household must have at least one head';
    end if;
  end if;

  update public.household_members
  set role = p_role
  where id = p_member_id;
end;
$$;

revoke all on function public.set_household_member_role(uuid, text) from public;
grant execute on function public.set_household_member_role(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- RPC: set a member's display name (Head only)
-- -----------------------------------------------------------------------------

create or replace function public.set_household_member_display_name(
  p_member_id uuid,
  p_display_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select household_id into v_household_id
  from public.household_members
  where id = p_member_id;

  if v_household_id is null then
    raise exception 'Member not found';
  end if;

  if not public.is_household_head(v_household_id) then
    raise exception 'Only a household head can change member profiles';
  end if;

  v_name := nullif(btrim(coalesce(p_display_name, '')), '');

  if v_name is not null and length(v_name) > 60 then
    raise exception 'Display name must be 60 characters or fewer';
  end if;

  update public.household_members
  set display_name = v_name
  where id = p_member_id;
end;
$$;

revoke all on function public.set_household_member_display_name(uuid, text) from public;
grant execute on function public.set_household_member_display_name(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- RPC: remove a member from the household (Head only)
-- -----------------------------------------------------------------------------

create or replace function public.remove_household_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_user_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select household_id, user_id into v_household_id, v_user_id
  from public.household_members
  where id = p_member_id;

  if v_household_id is null then
    raise exception 'Member not found';
  end if;

  if not public.is_household_head(v_household_id) then
    raise exception 'Only a household head can remove members';
  end if;

  if v_user_id = auth.uid() then
    raise exception 'You cannot remove yourself from the household';
  end if;

  delete from public.household_members
  where id = p_member_id;
end;
$$;

revoke all on function public.remove_household_member(uuid) from public;
grant execute on function public.remove_household_member(uuid) to authenticated;
