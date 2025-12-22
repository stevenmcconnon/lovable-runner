CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID,
  email TEXT NOT NULL,
  full_name TEXT,
  cognito_sub TEXT UNIQUE NOT NULL,
  has_used_trial BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS account_memberships (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, user_id)
);

CREATE TABLE IF NOT EXISTS account_invitations (
  token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  invited_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  redeemed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS profile_details (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  company_name TEXT,
  title TEXT,
  phone TEXT,
  location TEXT,
  photo_url TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  PRIMARY KEY (user_id, role)
);

CREATE TABLE IF NOT EXISTS subscription_plans (
  plan_key TEXT PRIMARY KEY,
  plan_name TEXT NOT NULL,
  price_monthly NUMERIC(10, 2) NOT NULL DEFAULT 0,
  monthly_edit_limit INTEGER,
  stripe_price_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  account_id UUID PRIMARY KEY,
  plan_key TEXT NOT NULL REFERENCES subscription_plans(plan_key),
  status TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS edit_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL,
  monthly_edit_limit INTEGER,
  edits_used INTEGER DEFAULT 0,
  edits_used_this_period INTEGER DEFAULT 0,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS edit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  site_id TEXT,
  business_name TEXT,
  business_type TEXT,
  business_phone TEXT,
  business_address TEXT,
  additional_details TEXT,
  latest_job_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS edit_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edit_request_id UUID NOT NULL REFERENCES edit_requests(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  lovable_project_id TEXT,
  s3_key TEXT,
  preview_url TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_edit_requests_latest_job'
      AND table_name = 'edit_requests'
  ) THEN
    ALTER TABLE edit_requests
      ADD CONSTRAINT fk_edit_requests_latest_job
      FOREIGN KEY (latest_job_id) REFERENCES edit_jobs(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  s3_key TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS templates_template_id_idx ON templates(template_id);

CREATE TABLE IF NOT EXISTS site_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE,
  account_id UUID,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  source_url TEXT,
  description TEXT,
  slug TEXT,
  prefix TEXT,
  bucket TEXT,
  business_name TEXT,
  business_type TEXT,
  business_phone TEXT,
  business_address TEXT,
  additional_details TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  public_url TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS site_generations_account_idx ON site_generations(account_id);
CREATE INDEX IF NOT EXISTS site_generations_request_idx ON site_generations(request_id);
CREATE INDEX IF NOT EXISTS edit_requests_account_created_idx ON edit_requests(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS edit_requests_status_created_idx ON edit_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS edit_jobs_status_created_idx ON edit_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS edit_jobs_request_created_idx ON edit_jobs(edit_request_id, created_at DESC);

CREATE TABLE IF NOT EXISTS account_sites (
  account_id UUID NOT NULL,
  slug TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, slug)
);

CREATE INDEX IF NOT EXISTS account_sites_slug_idx ON account_sites(slug);

CREATE TABLE IF NOT EXISTS domain_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID,
  slug TEXT,
  domain TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_order_id TEXT,
  price_cents INTEGER,
  currency TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS domain_orders_domain_idx ON domain_orders(domain);

CREATE TABLE IF NOT EXISTS site_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID,
  slug TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'manual',
  provider TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  is_primary BOOLEAN NOT NULL DEFAULT false,
  verification_token TEXT,
  dns_settings JSONB,
  https_status TEXT NOT NULL DEFAULT 'pending',
  https_ready_at TIMESTAMPTZ,
  https_checked_at TIMESTAMPTZ,
  certificate_arn TEXT,
  certificate_status TEXT,
  certificate_status_at TIMESTAMPTZ,
  certificate_validation JSONB,
  edge_domain TEXT,
  edge_distribution_id TEXT,
  edge_status TEXT,
  edge_status_at TIMESTAMPTZ,
  edge_function_name TEXT,
  edge_function_arn TEXT,
  canonical_host TEXT,
  canonical_mode TEXT,
  routing_error TEXT,
  verified_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS site_domains_slug_idx ON site_domains(slug);

ALTER TABLE site_domains ADD COLUMN IF NOT EXISTS https_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE site_domains ADD COLUMN IF NOT EXISTS https_ready_at TIMESTAMPTZ;
ALTER TABLE site_domains ADD COLUMN IF NOT EXISTS https_checked_at TIMESTAMPTZ;
ALTER TABLE site_domains ADD COLUMN IF NOT EXISTS certificate_arn TEXT;
ALTER TABLE site_domains ADD COLUMN IF NOT EXISTS certificate_status TEXT;
ALTER TABLE site_domains ADD COLUMN IF NOT EXISTS certificate_status_at TIMESTAMPTZ;
ALTER TABLE site_domains ADD COLUMN IF NOT EXISTS certificate_validation JSONB;
ALTER TABLE site_domains ADD COLUMN IF NOT EXISTS edge_domain TEXT;
ALTER TABLE site_domains ADD COLUMN IF NOT EXISTS edge_distribution_id TEXT;
ALTER TABLE site_domains ADD COLUMN IF NOT EXISTS edge_status TEXT;
ALTER TABLE site_domains ADD COLUMN IF NOT EXISTS edge_status_at TIMESTAMPTZ;
ALTER TABLE site_domains ADD COLUMN IF NOT EXISTS edge_function_name TEXT;
ALTER TABLE site_domains ADD COLUMN IF NOT EXISTS edge_function_arn TEXT;
ALTER TABLE site_domains ADD COLUMN IF NOT EXISTS canonical_host TEXT;
ALTER TABLE site_domains ADD COLUMN IF NOT EXISTS canonical_mode TEXT;
ALTER TABLE site_domains ADD COLUMN IF NOT EXISTS routing_error TEXT;
ALTER TABLE site_domains ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE site_domains ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS domain_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL,
  slug TEXT,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  payload JSONB,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS domain_jobs_status_schedule_idx ON domain_jobs(status, scheduled_at);
CREATE INDEX IF NOT EXISTS domain_jobs_domain_idx ON domain_jobs(domain);

CREATE TABLE IF NOT EXISTS domain_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL,
  slug TEXT,
  event_type TEXT NOT NULL,
  status TEXT,
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS domain_events_domain_idx ON domain_events(domain, created_at DESC);

CREATE TABLE IF NOT EXISTS launch_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL,
  request_id UUID NOT NULL UNIQUE,
  cost INTEGER NOT NULL DEFAULT 1,
  limit_snapshot INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS launch_reservations_account_idx ON launch_reservations(account_id);

CREATE TABLE IF NOT EXISTS site_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL,
  account_id UUID,
  target TEXT NOT NULL,
  status TEXT NOT NULL,
  bucket TEXT,
  prefix TEXT,
  public_url TEXT,
  requested_by UUID,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS site_deployments_slug_idx ON site_deployments(slug);

ALTER TABLE site_generations ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE site_generations ALTER COLUMN user_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS site_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL,
  event_date DATE NOT NULL DEFAULT CURRENT_DATE,
  views INTEGER NOT NULL DEFAULT 0,
  cta_clicks INTEGER NOT NULL DEFAULT 0,
  lead_submissions INTEGER NOT NULL DEFAULT 0,
  booking_requests INTEGER NOT NULL DEFAULT 0,
  unique_visitors INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (slug, event_date)
);

CREATE TABLE IF NOT EXISTS site_metric_visitors (
  slug TEXT NOT NULL,
  event_date DATE NOT NULL,
  visitor_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (slug, event_date, visitor_hash)
);

CREATE TABLE IF NOT EXISTS site_metric_referrers (
  slug TEXT NOT NULL,
  event_date DATE NOT NULL,
  referrer TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (slug, event_date, referrer)
);

CREATE TABLE IF NOT EXISTS site_metrics_daily (
  slug TEXT NOT NULL,
  stat_date DATE NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  cta_clicks INTEGER NOT NULL DEFAULT 0,
  lead_submissions INTEGER NOT NULL DEFAULT 0,
  booking_requests INTEGER NOT NULL DEFAULT 0,
  unique_visitors INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (slug, stat_date)
);

CREATE TABLE IF NOT EXISTS notification_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL,
  recipient TEXT NOT NULL,
  template TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT,
  body_html TEXT,
  reply_to TEXT,
  cc JSONB,
  metadata JSONB,
  dedupe_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notification_jobs_status_idx ON notification_jobs(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS notification_jobs_slug_idx ON notification_jobs(slug);

CREATE TABLE IF NOT EXISTS integration_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID,
  slug TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  scopes TEXT[],
  provider_user_id TEXT,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  metadata JSONB,
  last_error TEXT,
  last_refresh_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (slug, provider)
);

CREATE INDEX IF NOT EXISTS integration_tokens_status_idx ON integration_tokens(status);

CREATE TABLE IF NOT EXISTS site_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT,
  account_id UUID,
  actor_user_id UUID,
  actor_email TEXT,
  action TEXT NOT NULL,
  description TEXT,
  metadata JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS site_audit_logs_slug_idx ON site_audit_logs(slug, created_at);

CREATE TABLE IF NOT EXISTS job_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  slug TEXT,
  account_id UUID,
  request_id UUID,
  job_id UUID,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_events_slug_idx ON job_events(slug, created_at DESC);
CREATE INDEX IF NOT EXISTS job_events_action_idx ON job_events(action, created_at DESC);

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  slug TEXT,
  action TEXT NOT NULL,
  identifier TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, action, identifier, window_start)
);

-- Seed subscription plans (idempotent)
INSERT INTO subscription_plans (plan_key, plan_name, price_monthly, monthly_edit_limit, stripe_price_id)
VALUES
  ('starter', 'Starter', 29.00, 5, 'price_1SaXZTFXG8DaUq7ULBoQPaNO'),
  ('growth', 'Growth', 69.00, 20, 'price_1SaXYyFXG8DaUq7UVHtS7y7l'),
  ('scale', 'Scale', 149.00, 75, 'price_1SaXXbFXG8DaUq7UzIYWq2ra'),
  ('starter-annual', 'Starter Annual', 290.00, 5, 'price_1SaXa9FXG8DaUq7UenwkRVPC'),
  ('growth-annual', 'Growth Annual', 690.00, 20, 'price_1SaXbmFXG8DaUq7U1b5cP1Bu'),
  ('scale-annual', 'Scale Annual', 1490.00, 75, 'price_1SaXcoFXG8DaUq7UAPZhufT5')
ON CONFLICT (plan_key) DO NOTHING;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_profiles_updated_at ON profiles;
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_profile_details_updated_at ON profile_details;
CREATE TRIGGER set_profile_details_updated_at
  BEFORE UPDATE ON profile_details
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_subscription_plans_updated_at ON subscription_plans;
CREATE TRIGGER set_subscription_plans_updated_at
  BEFORE UPDATE ON subscription_plans
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER set_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_edit_requests_updated_at ON edit_requests;
CREATE TRIGGER set_edit_requests_updated_at
  BEFORE UPDATE ON edit_requests
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_edit_jobs_updated_at ON edit_jobs;
CREATE TRIGGER set_edit_jobs_updated_at
  BEFORE UPDATE ON edit_jobs
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_site_generations_updated_at ON site_generations;
CREATE TRIGGER set_site_generations_updated_at
  BEFORE UPDATE ON site_generations
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_domain_orders_updated_at ON domain_orders;
CREATE TRIGGER set_domain_orders_updated_at
  BEFORE UPDATE ON domain_orders
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_site_domains_updated_at ON site_domains;
CREATE TRIGGER set_site_domains_updated_at
  BEFORE UPDATE ON site_domains
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_domain_jobs_updated_at ON domain_jobs;
CREATE TRIGGER set_domain_jobs_updated_at
  BEFORE UPDATE ON domain_jobs
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_site_deployments_updated_at ON site_deployments;
CREATE TRIGGER set_site_deployments_updated_at
  BEFORE UPDATE ON site_deployments
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
