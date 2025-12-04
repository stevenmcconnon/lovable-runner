CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL,
  email TEXT NOT NULL,
  full_name TEXT,
  cognito_sub TEXT UNIQUE NOT NULL,
  has_used_trial BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  verified_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS site_domains_slug_idx ON site_domains(slug);

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (slug, event_date)
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

DROP TRIGGER IF EXISTS set_site_deployments_updated_at ON site_deployments;
CREATE TRIGGER set_site_deployments_updated_at
  BEFORE UPDATE ON site_deployments
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
