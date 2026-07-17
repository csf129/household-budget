ALTER TABLE email_summary_settings
  ADD COLUMN IF NOT EXISTS section_ai_insights boolean NOT NULL DEFAULT false;
