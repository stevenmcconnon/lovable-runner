-- Add account scoping columns with literal default
ALTER TABLE IF EXISTS site_metrics ADD COLUMN IF NOT EXISTS account_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE IF EXISTS site_metric_visitors ADD COLUMN IF NOT EXISTS account_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE IF EXISTS site_metric_referrers ADD COLUMN IF NOT EXISTS account_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE IF EXISTS site_metrics_daily ADD COLUMN IF NOT EXISTS account_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';

-- Backfill from account_sites when available
UPDATE site_metrics sm
SET account_id = COALESCE(
  (SELECT account_id FROM account_sites WHERE slug = sm.slug LIMIT 1),
  sm.account_id,
  '00000000-0000-0000-0000-000000000000'
);

UPDATE site_metric_visitors smv
SET account_id = COALESCE(
  (SELECT account_id FROM account_sites WHERE slug = smv.slug LIMIT 1),
  smv.account_id,
  '00000000-0000-0000-0000-000000000000'
);

UPDATE site_metric_referrers smr
SET account_id = COALESCE(
  (SELECT account_id FROM account_sites WHERE slug = smr.slug LIMIT 1),
  smr.account_id,
  '00000000-0000-0000-0000-000000000000'
);

UPDATE site_metrics_daily smd
SET account_id = COALESCE(
  (SELECT account_id FROM account_sites WHERE slug = smd.slug LIMIT 1),
  smd.account_id,
  '00000000-0000-0000-0000-000000000000'
);

-- Rebuild constraints/indexes to scope by account
ALTER TABLE IF EXISTS site_metrics DROP CONSTRAINT IF EXISTS site_metrics_slug_event_date_key;
ALTER TABLE IF EXISTS site_metrics
  ADD CONSTRAINT site_metrics_account_slug_date_unique UNIQUE (account_id, slug, event_date);
CREATE INDEX IF NOT EXISTS site_metrics_account_idx ON site_metrics(account_id);

ALTER TABLE IF EXISTS site_metric_visitors DROP CONSTRAINT IF EXISTS site_metric_visitors_pkey;
ALTER TABLE IF EXISTS site_metric_visitors
  ADD CONSTRAINT site_metric_visitors_pkey PRIMARY KEY (account_id, slug, event_date, visitor_hash);
CREATE INDEX IF NOT EXISTS site_metric_visitors_account_idx ON site_metric_visitors(account_id);

ALTER TABLE IF EXISTS site_metric_referrers DROP CONSTRAINT IF EXISTS site_metric_referrers_pkey;
ALTER TABLE IF EXISTS site_metric_referrers
  ADD CONSTRAINT site_metric_referrers_pkey PRIMARY KEY (account_id, slug, event_date, referrer);
CREATE INDEX IF NOT EXISTS site_metric_referrers_account_idx ON site_metric_referrers(account_id);

ALTER TABLE IF EXISTS site_metrics_daily DROP CONSTRAINT IF EXISTS site_metrics_daily_pkey;
ALTER TABLE IF EXISTS site_metrics_daily
  ADD CONSTRAINT site_metrics_daily_pkey PRIMARY KEY (account_id, slug, stat_date);
CREATE INDEX IF NOT EXISTS site_metrics_daily_account_idx ON site_metrics_daily(account_id);
