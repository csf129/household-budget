-- Notifications: subscription price-change + bill-paid alerts.
--
-- Three tables:
--   notification_settings  — per-household channel + event-type toggles
--   push_subscriptions     — per-device Web Push endpoints (one row per browser)
--   notification_events    — detected events (dedup + in-app feed + delivery flags)

-- ---------------------------------------------------------------------------
-- notification_settings (one row per household)
-- ---------------------------------------------------------------------------
CREATE TABLE notification_settings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id         uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  -- Delivery channels. Web push is the default channel; in-app is a free
  -- always-visible fallback; email requires recipients + RESEND_API_KEY.
  notify_web_push      boolean NOT NULL DEFAULT true,
  notify_in_app        boolean NOT NULL DEFAULT true,
  notify_email         boolean NOT NULL DEFAULT false,
  email_recipients     text[]  NOT NULL DEFAULT '{}',
  -- Event types to detect.
  price_change_enabled boolean NOT NULL DEFAULT true,
  bill_paid_enabled    boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  last_run_at          timestamptz,
  UNIQUE (household_id)
);

ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "household members can manage notification settings"
  ON notification_settings
  FOR ALL
  USING (
    household_id IN (
      SELECT household_id FROM household_members WHERE user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- push_subscriptions (one row per browser/device)
-- ---------------------------------------------------------------------------
CREATE TABLE push_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint      text NOT NULL UNIQUE,
  p256dh        text NOT NULL,
  auth          text NOT NULL,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX push_subscriptions_household_idx ON push_subscriptions (household_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "household members can manage push subscriptions"
  ON push_subscriptions
  FOR ALL
  USING (
    household_id IN (
      SELECT household_id FROM household_members WHERE user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- notification_events (detected events; doubles as the in-app feed)
-- ---------------------------------------------------------------------------
CREATE TABLE notification_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id       uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  type               text NOT NULL CHECK (type IN ('subscription_price_change', 'bill_paid')),
  -- Stable key so the detector records each event at most once.
  dedup_key          text NOT NULL,
  merchant           text NOT NULL,          -- normalized merchant (grouping key)
  merchant_label     text NOT NULL,          -- display name
  amount             numeric(14, 2) NOT NULL,
  previous_amount    numeric(14, 2),         -- price-change only
  occurred_on        date NOT NULL,
  category_id        uuid REFERENCES categories(id) ON DELETE SET NULL,
  delivered_web_push boolean NOT NULL DEFAULT false,
  delivered_email    boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, dedup_key)
);

CREATE INDEX notification_events_household_created_idx
  ON notification_events (household_id, created_at DESC);

ALTER TABLE notification_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "household members can read notification events"
  ON notification_events
  FOR ALL
  USING (
    household_id IN (
      SELECT household_id FROM household_members WHERE user_id = auth.uid()
    )
  );

-- updated_at trigger for settings (matches other tables)
CREATE TRIGGER notification_settings_set_updated_at
  BEFORE UPDATE ON notification_settings
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();
