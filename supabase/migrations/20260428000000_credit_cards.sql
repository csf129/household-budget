-- Credit card monitoring: supplemental metadata layered on top of Plaid-linked
-- credit accounts (bank_accounts where type = 'credit'). Plaid provides live
-- balances/available credit; points, annual fees, renewal months, and due days
-- are user-entered and stored here, 1:1 with a bank_account.

create table public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  bank_account_id uuid not null unique references public.bank_accounts (id) on delete cascade,
  -- Annual membership fee + the calendar month it posts / renews (1 = Jan).
  annual_fee numeric(14, 2),
  annual_fee_month int check (annual_fee_month between 1 and 12),
  -- Day of month the statement payment is due (1-31).
  payment_due_day int check (payment_due_day between 1 and 31),
  -- Rewards program + a freeform summary of the reward structure.
  points_program text,
  points_balance bigint,
  points_updated_on date,
  reward_summary text,
  -- Tracks the keep/cancel decision; actual cancellation happens with the issuer.
  status text not null default 'active' check (status in ('active', 'review', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index credit_cards_household_id_idx on public.credit_cards (household_id);

alter table public.credit_cards enable row level security;

create policy "credit_cards_all_member"
  on public.credit_cards
  for all
  using (household_id in (select public.user_household_ids()))
  with check (household_id in (select public.user_household_ids()));

create trigger credit_cards_set_updated_at
  before update on public.credit_cards
  for each row
  execute procedure public.set_updated_at();

-- Email summary opt-in section for credit card reminders.
alter table public.email_summary_settings
  add column if not exists section_card_reminders boolean not null default false;
