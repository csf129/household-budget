-- Receipt storage bucket (private — files accessed via signed URLs only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts',
  'receipts',
  false,
  20971520, -- 20 MB per file
  array['image/jpeg','image/png','image/webp','image/heic','application/pdf']
)
on conflict (id) do nothing;

-- Storage RLS: household members can upload / read / delete their own household's files.
-- Path convention: {household_id}/{transaction_id}/{uuid}-{filename}

create policy "receipts_insert_own_household"
  on storage.objects for insert
  with check (
    bucket_id = 'receipts'
    and auth.uid() is not null
    and exists (
      select 1 from public.household_members
      where user_id = auth.uid()
        and household_id = (string_to_array(name, '/'))[1]::uuid
    )
  );

create policy "receipts_select_own_household"
  on storage.objects for select
  using (
    bucket_id = 'receipts'
    and auth.uid() is not null
    and exists (
      select 1 from public.household_members
      where user_id = auth.uid()
        and household_id = (string_to_array(name, '/'))[1]::uuid
    )
  );

create policy "receipts_delete_own_household"
  on storage.objects for delete
  using (
    bucket_id = 'receipts'
    and auth.uid() is not null
    and exists (
      select 1 from public.household_members
      where user_id = auth.uid()
        and household_id = (string_to_array(name, '/'))[1]::uuid
    )
  );

-- Receipts metadata table
create table public.transaction_receipts (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  transaction_id  uuid not null references public.transactions(id) on delete cascade,
  file_path       text not null,       -- storage path: {household_id}/{transaction_id}/{uuid}-{filename}
  file_name       text not null,       -- original filename shown to user
  file_size       bigint not null,     -- bytes
  mime_type       text not null,
  uploaded_by     uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

alter table public.transaction_receipts enable row level security;

create policy "receipts_select_household_member"
  on public.transaction_receipts for select
  using (
    exists (
      select 1 from public.household_members
      where user_id = auth.uid() and household_id = transaction_receipts.household_id
    )
  );

create policy "receipts_insert_household_member"
  on public.transaction_receipts for insert
  with check (
    exists (
      select 1 from public.household_members
      where user_id = auth.uid() and household_id = transaction_receipts.household_id
    )
  );

create policy "receipts_delete_household_member"
  on public.transaction_receipts for delete
  using (
    exists (
      select 1 from public.household_members
      where user_id = auth.uid() and household_id = transaction_receipts.household_id
    )
  );

create index transaction_receipts_transaction_id_idx
  on public.transaction_receipts(transaction_id);

create index transaction_receipts_household_id_idx
  on public.transaction_receipts(household_id);

-- Business expense flag on transactions (for tax reporting)
alter table public.transactions
  add column if not exists is_business_expense boolean not null default false;
