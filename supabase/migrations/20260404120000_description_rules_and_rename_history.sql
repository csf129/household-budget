-- Replace raw descriptions when normalized text matches (import + manual add).
-- Audit log for description renames from the transaction editor.

create table public.description_display_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  match_normalized text not null,
  replacement_raw text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, match_normalized)
);

create index description_display_rules_household_idx
  on public.description_display_rules (household_id);

create trigger description_display_rules_set_updated_at
  before update on public.description_display_rules
  for each row
  execute procedure public.set_updated_at();

alter table public.description_display_rules enable row level security;

create policy "description_display_rules_all_member"
  on public.description_display_rules for all
  using (household_id in (select public.user_household_ids()))
  with check (household_id in (select public.user_household_ids()));

create table public.description_rename_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  source_normalized text not null,
  new_raw text not null,
  scope text not null check (scope in ('this', 'all')),
  rows_affected int not null default 1,
  rule_remembered boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index description_rename_events_household_created_idx
  on public.description_rename_events (household_id, created_at desc);

alter table public.description_rename_events enable row level security;

create policy "description_rename_events_all_member"
  on public.description_rename_events for all
  using (household_id in (select public.user_household_ids()))
  with check (household_id in (select public.user_household_ids()));
