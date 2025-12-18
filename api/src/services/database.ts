import { randomUUID } from 'node:crypto';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from '../env';
import {
  AccountSummary,
  AccountWithUsers,
  AdminEditRequestFilters,
  AdminJobFilters,
  AdminUserRecord,
  BusinessDetailsInput,
  DeploymentRecord,
  DomainOrderRecord,
  DomainRecord,
  DomainEventRecord,
  EditJobRecord,
  EditRequestRecord,
  EditRequestStatus,
  ProfileDetails,
  ProfileRecord,
  SubscriptionDetails,
  SubscriptionPlan,
  SiteGenerationRecord,
  TemplateUploadRecord,
  UsageDetails,
  UsageLimits,
  UserRole,
  DomainJobRecord,
  DomainJobStatus,
  DomainJobType,
} from '../types';

const pool = new Pool({
  connectionString: config.database.url,
  ssl: config.nodeEnv === 'production' ? { rejectUnauthorized: false } : undefined,
});

const analyticsPool =
  config.database.analyticsUrl && config.database.analyticsUrl !== config.database.url
    ? new Pool({
        connectionString: config.database.analyticsUrl,
        ssl: config.nodeEnv === 'production' ? { rejectUnauthorized: false } : undefined,
      })
    : pool;

const DOMAIN_JOB_LOCK_KEY = 837492;

const toIsoString = (value: any) => value?.toISOString?.() ?? value ?? null;

const mapProfile = (row: any): ProfileRecord => ({
  id: row.id,
  accountId: row.account_id,
  email: row.email,
  fullName: row.full_name,
  cognitoSub: row.cognito_sub,
  hasUsedTrial: Boolean(row.has_used_trial),
});

const mapAdminUser = (row: any): AdminUserRecord => ({
  id: row.id,
  accountId: row.account_id,
  email: row.email,
  fullName: row.full_name,
  cognitoSub: row.cognito_sub,
  hasUsedTrial: Boolean(row.has_used_trial),
  roles: (row.roles as UserRole[]) ?? [],
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
});

const mapDetails = (row: any): ProfileDetails => ({
  userId: row.user_id,
  companyName: row.company_name ?? undefined,
  title: row.title ?? undefined,
  phone: row.phone ?? undefined,
  location: row.location ?? undefined,
  photoUrl: row.photo_url ?? undefined,
  metadata: row.metadata ?? null,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
});

const mapJob = (row: any): EditJobRecord => ({
  id: row.id,
  editRequestId: row.edit_request_id,
  status: row.status,
  lovableProjectId: row.lovable_project_id,
  s3Key: row.s3_key,
  previewUrl: row.preview_url,
  errorMessage: row.error_message,
  createdAt: row.created_at?.toISOString?.() ?? row.created_at,
  updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
});

const mapRequest = (row: any): EditRequestRecord => ({
  id: row.id,
  accountId: row.account_id,
  userId: row.user_id,
  description: row.description,
  status: row.status,
  createdAt: row.created_at?.toISOString?.() ?? row.created_at,
  updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
  siteId: row.site_id,
  latestJob: row.latest_job_id
    ? {
        id: row.latest_job_id,
        editRequestId: row.id,
        status: row.latest_job_status,
        lovableProjectId: row.latest_job_lovable_project_id,
        s3Key: row.latest_job_s3_key,
        previewUrl: row.latest_job_preview_url,
        errorMessage: row.latest_job_error_message,
        createdAt: row.latest_job_created_at?.toISOString?.() ?? row.latest_job_created_at,
        updatedAt: row.latest_job_updated_at?.toISOString?.() ?? row.latest_job_updated_at,
      }
    : null,
});

const mapSiteGeneration = (row: any): SiteGenerationRecord => ({
  requestId: row.request_id,
  accountId: row.account_id,
  userId: row.user_id,
  sourceUrl: row.source_url,
  description: row.description,
  slug: row.slug,
  prefix: row.prefix,
  bucket: row.bucket,
  businessName: row.business_name,
  businessType: row.business_type,
  businessPhone: row.business_phone,
  businessAddress: row.business_address,
  additionalDetails: row.additional_details,
  status: row.status,
  publicUrl: row.public_url,
  errorMessage: row.error_message,
  createdAt: row.created_at?.toISOString?.() ?? row.created_at,
  updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
});

const mapDomainOrder = (row: any): DomainOrderRecord => ({
  id: row.id,
  accountId: row.account_id ?? null,
  slug: row.slug ?? null,
  domain: row.domain,
  status: row.status,
  providerOrderId: row.provider_order_id ?? null,
  priceCents: row.price_cents ?? null,
  currency: row.currency ?? null,
  metadata: row.metadata ?? null,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
});

const mapDomainRecord = (row: any): DomainRecord => ({
  id: row.id,
  accountId: row.account_id ?? null,
  slug: row.slug,
  domain: row.domain,
  type: row.type,
  provider: row.provider ?? null,
  status: row.status,
  isPrimary: Boolean(row.is_primary),
  verificationToken: row.verification_token ?? null,
  dnsSettings: row.dns_settings ?? null,
  httpsStatus: row.https_status ?? null,
  httpsReadyAt: toIsoString(row.https_ready_at),
  httpsCheckedAt: toIsoString(row.https_checked_at),
  certificateArn: row.certificate_arn ?? null,
  certificateStatus: row.certificate_status ?? null,
  certificateStatusAt: toIsoString(row.certificate_status_at),
  certificateValidation: row.certificate_validation ?? null,
  edgeDomain: row.edge_domain ?? null,
  edgeDistributionId: row.edge_distribution_id ?? null,
  edgeStatus: row.edge_status ?? null,
  edgeStatusAt: toIsoString(row.edge_status_at),
  edgeFunctionName: row.edge_function_name ?? null,
  edgeFunctionArn: row.edge_function_arn ?? null,
  canonicalHost: row.canonical_host ?? null,
  canonicalMode: row.canonical_mode ?? null,
  routingError: row.routing_error ?? null,
  verifiedAt: toIsoString(row.verified_at),
  lastCheckedAt: toIsoString(row.last_checked_at),
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
});

const mapDomainJob = (row: any): DomainJobRecord => ({
  id: row.id,
  domain: row.domain,
  slug: row.slug,
  type: row.job_type,
  status: row.status,
  attempts: Number(row.attempts ?? 0),
  payload: row.payload ?? null,
  scheduledAt: toIsoString(row.scheduled_at),
  startedAt: toIsoString(row.started_at),
  completedAt: toIsoString(row.completed_at),
  lastError: row.last_error ?? null,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
});

const normalizeTimestamp = (value?: string | Date | null) => {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
};

const mapDomainEvent = (row: any): DomainEventRecord => ({
  id: row.id,
  domain: row.domain,
  slug: row.slug,
  type: row.event_type,
  status: row.status,
  description: row.description,
  metadata: row.metadata ?? null,
  createdAt: toIsoString(row.created_at),
});

const mapDeploymentRecord = (row: any): DeploymentRecord => ({
  id: row.id,
  slug: row.slug,
  accountId: row.account_id ?? null,
  target: row.target,
  status: row.status,
  bucket: row.bucket ?? null,
  prefix: row.prefix ?? null,
  publicUrl: row.public_url ?? null,
  requestedBy: row.requested_by ?? null,
  errorMessage: row.error_message ?? null,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
  completedAt: toIsoString(row.completed_at),
});

export class DatabaseService {
  private pool: Pool;

  private analyticsPool: Pool;

  constructor(options: { pool?: Pool; analyticsPool?: Pool } = {}) {
    this.pool = options.pool ?? pool;
    this.analyticsPool = options.analyticsPool ?? analyticsPool;
  }

  async getProfileDetails(userId: string): Promise<ProfileDetails | null> {
    const { rows } = await this.query(
      `
      SELECT *
      FROM profile_details
      WHERE user_id = $1
      LIMIT 1
    `,
      [userId]
    );
    return rows[0] ? mapDetails(rows[0]) : null;
  }

  async upsertProfileDetails(
    userId: string,
    details: Partial<Omit<ProfileDetails, 'userId' | 'createdAt' | 'updatedAt'>>
  ): Promise<ProfileDetails> {
    const payload = {
      companyName: details.companyName ?? null,
      title: details.title ?? null,
      phone: details.phone ?? null,
      location: details.location ?? null,
      photoUrl: details.photoUrl ?? null,
      metadata: details.metadata ?? null,
    };
    const { rows } = await this.query(
      `
      INSERT INTO profile_details (user_id, company_name, title, phone, location, photo_url, metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (user_id) DO UPDATE
      SET company_name = EXCLUDED.company_name,
          title = EXCLUDED.title,
          phone = EXCLUDED.phone,
          location = EXCLUDED.location,
          photo_url = EXCLUDED.photo_url,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      RETURNING *
    `,
      [userId, payload.companyName, payload.title, payload.phone, payload.location, payload.photoUrl, payload.metadata]
    );
    return mapDetails(rows[0]);
  }

  async getProfileWithDetails(userId: string): Promise<{
    profile: ProfileRecord | null;
    details: ProfileDetails | null;
    roles: UserRole[];
  }> {
    const [profile, details, roles] = await Promise.all([
      this.getProfileById(userId),
      this.getProfileDetails(userId),
      this.getRolesForUser(userId),
    ]);
    return { profile, details, roles };
  }

  private async query<T extends QueryResultRow = QueryResultRow>(text: string, params: any[] = []) {
    return this.pool.query<T>(text, params);
  }

  private async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  private async analyticsQuery<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: any[] = []
  ) {
    return this.analyticsPool.query<T>(text, params);
  }

  private async recordAccountSite(
    accountId?: string | null,
    slug?: string | null,
    createdAt?: string | Date | null
  ): Promise<void> {
    if (!accountId || !slug) return;
    const timestamp = normalizeTimestamp(createdAt);
    await this.query(
      `
      INSERT INTO account_sites (account_id, slug, created_at)
      VALUES ($1,$2,$3)
      ON CONFLICT (account_id, slug)
      DO UPDATE SET created_at = LEAST(account_sites.created_at, EXCLUDED.created_at)
    `,
      [accountId, slug, timestamp]
    );
  }

  private async getAnalyticsClient(): Promise<PoolClient> {
    return this.analyticsPool.connect();
  }

  async getProfileByCognitoSub(sub: string): Promise<ProfileRecord | null> {
    const { rows } = await this.query(
      `
      SELECT id, account_id, email, full_name, cognito_sub, has_used_trial
      FROM profiles
      WHERE cognito_sub = $1
      LIMIT 1
    `,
      [sub]
    );
    return rows[0] ? mapProfile(rows[0]) : null;
  }

  async getProfileById(id: string): Promise<ProfileRecord | null> {
    const { rows } = await this.query(
      `
      SELECT id, account_id, email, full_name, cognito_sub, has_used_trial
      FROM profiles
      WHERE id = $1
      LIMIT 1
    `,
      [id]
    );
    return rows[0] ? mapProfile(rows[0]) : null;
  }

  async getRolesForUser(userId: string): Promise<UserRole[]> {
    const { rows } = await this.query<{ role: UserRole }>(
      `SELECT role FROM user_roles WHERE user_id = $1`,
      [userId]
    );
    return rows.map((row) => row.role);
  }

  async createProfileFromCognito(input: {
    cognitoSub: string;
    email: string;
    fullName?: string;
  }): Promise<ProfileRecord> {
    const profileId = randomUUID();
    const accountId = randomUUID();
    const { rows } = await this.query(
      `
      INSERT INTO profiles (id, account_id, email, full_name, cognito_sub, has_used_trial)
      VALUES ($1, $2, $3, $4, $5, false)
      ON CONFLICT (cognito_sub) DO UPDATE
        SET email = EXCLUDED.email,
            full_name = COALESCE(EXCLUDED.full_name, profiles.full_name)
      RETURNING id, account_id, email, full_name, cognito_sub, has_used_trial
    `,
      [profileId, accountId, input.email, input.fullName ?? null, input.cognitoSub]
    );
    if (!rows[0]) {
      throw new Error('Failed to create or fetch profile');
    }
    return mapProfile(rows[0]);
  }

  async ensureRolesForUser(userId: string, roles: UserRole[]): Promise<void> {
    if (!roles.length) return;
    const valuePlaceholders = roles.map((_, index) => `($1, $${index + 2})`).join(', ');
    const params = [userId, ...roles];
    await this.query(
      `
      INSERT INTO user_roles (user_id, role)
      VALUES ${valuePlaceholders}
      ON CONFLICT (user_id, role) DO NOTHING
    `,
      params
    );
  }

  async replaceRolesForUser(userId: string, roles: UserRole[]): Promise<void> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);
      if (roles.length) {
        const valuePlaceholders = roles.map((_, index) => `($1, $${index + 2})`).join(', ');
        await client.query(
          `
          INSERT INTO user_roles (user_id, role)
          VALUES ${valuePlaceholders}
        `,
          [userId, ...roles]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createProfileRecord(params: {
    email: string;
    fullName?: string;
    cognitoSub: string;
    accountId?: string;
  }): Promise<ProfileRecord> {
    const profileId = randomUUID();
    const accountId = params.accountId || randomUUID();
    const { rows } = await this.query(
      `
      INSERT INTO profiles (id, account_id, email, full_name, cognito_sub, has_used_trial)
      VALUES ($1,$2,$3,$4,$5,false)
      RETURNING id, account_id, email, full_name, cognito_sub, has_used_trial
    `,
      [profileId, accountId, params.email, params.fullName ?? null, params.cognitoSub]
    );
    return mapProfile(rows[0]);
  }

  async updateProfileById(
    userId: string,
    updates: { email?: string; fullName?: string; accountId?: string }
  ): Promise<ProfileRecord | null> {
    const fields: string[] = [];
    const params: any[] = [];
    if (updates.email !== undefined) {
      params.push(updates.email);
      fields.push(`email = $${params.length}`);
    }
    if (updates.fullName !== undefined) {
      params.push(updates.fullName);
      fields.push(`full_name = $${params.length}`);
    }
    if (updates.accountId !== undefined) {
      params.push(updates.accountId);
      fields.push(`account_id = $${params.length}`);
    }
    if (!fields.length) {
      return this.getProfileById(userId);
    }
    params.push(userId);
    const { rows } = await this.query(
      `
      UPDATE profiles
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length}
      RETURNING id, account_id, email, full_name, cognito_sub, has_used_trial
    `,
      params
    );
    return rows[0] ? mapProfile(rows[0]) : null;
  }

  async deleteProfileForAdmin(userId: string): Promise<void> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM profiles WHERE id = $1`, [userId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listUsersAdmin(filters: {
    role?: UserRole;
    search?: string;
    accountId?: string;
  } = {}): Promise<AdminUserRecord[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    if (filters.accountId) {
      params.push(filters.accountId);
      conditions.push(`p.account_id = $${params.length}`);
    }
    if (filters.role) {
      params.push(filters.role);
      conditions.push(`$${params.length} = ANY(roles.roles)`);
    }
    if (filters.search) {
      params.push(`%${filters.search}%`);
      params.push(`%${filters.search}%`);
      conditions.push(`(p.email ILIKE $${params.length - 1} OR p.full_name ILIKE $${params.length})`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await this.query(
      `
      WITH roles AS (
        SELECT user_id, ARRAY_AGG(role ORDER BY role) AS roles
        FROM user_roles
        GROUP BY user_id
      )
      SELECT
        p.*,
        COALESCE(roles.roles, ARRAY[]::text[]) AS roles
      FROM profiles p
      LEFT JOIN roles ON roles.user_id = p.id
      ${whereClause}
      ORDER BY p.created_at DESC
    `,
      params
    );
    return rows.map(mapAdminUser);
  }

  async getAdminUserById(userId: string): Promise<AdminUserRecord | null> {
    const { rows } = await this.query(
      `
      WITH roles AS (
        SELECT user_id, ARRAY_AGG(role ORDER BY role) AS roles
        FROM user_roles
        WHERE user_id = $1
        GROUP BY user_id
      )
      SELECT
        p.*,
        COALESCE(roles.roles, ARRAY[]::text[]) AS roles
      FROM profiles p
      LEFT JOIN roles ON roles.user_id = p.id
      WHERE p.id = $1
      LIMIT 1
    `,
      [userId]
    );
    return rows[0] ? mapAdminUser(rows[0]) : null;
  }

  async getSubscription(accountId: string): Promise<SubscriptionDetails | null> {
    const { rows } = await this.query(
      `
      SELECT
        s.plan_key,
        s.status,
        s.current_period_start,
        s.current_period_end,
        s.stripe_customer_id,
        s.stripe_subscription_id,
        sp.plan_name,
        sp.price_monthly,
        sp.monthly_edit_limit
      FROM subscriptions s
      LEFT JOIN subscription_plans sp ON sp.plan_key = s.plan_key
      WHERE s.account_id = $1
      ORDER BY s.created_at DESC
      LIMIT 1
    `,
      [accountId]
    );
    if (!rows[0]) return null;
    const row = rows[0];
    return {
      planKey: row.plan_key,
      planName: row.plan_name ?? row.plan_key,
      priceMonthly: Number(row.price_monthly ?? 0),
      status: row.status,
      currentPeriodStart: row.current_period_start?.toISOString?.() ?? row.current_period_start,
      currentPeriodEnd: row.current_period_end?.toISOString?.() ?? row.current_period_end,
      stripeCustomerId: row.stripe_customer_id,
      stripeSubscriptionId: row.stripe_subscription_id,
      monthlyEditLimit: row.monthly_edit_limit ?? null,
    };
  }

  async getSubscriptionPlan(planKey: string): Promise<SubscriptionPlan | null> {
    const { rows } = await this.query(
      `
      SELECT plan_key, plan_name, price_monthly, monthly_edit_limit, stripe_price_id
      FROM subscription_plans
      WHERE plan_key = $1
      LIMIT 1
    `,
      [planKey]
    );
    if (!rows[0]) return null;
    const row = rows[0];
    return {
      planKey: row.plan_key,
      planName: row.plan_name,
      priceMonthly: Number(row.price_monthly ?? 0),
      monthlyEditLimit: row.monthly_edit_limit ?? null,
      stripePriceId: row.stripe_price_id,
    };
  }

  async listSubscriptionPlans(): Promise<SubscriptionPlan[]> {
    const { rows } = await this.query(
      `
      SELECT plan_key, plan_name, price_monthly, monthly_edit_limit, stripe_price_id
      FROM subscription_plans
      ORDER BY price_monthly NULLS LAST, plan_key
    `
    );
    return rows.map((row) => ({
      planKey: row.plan_key,
      planName: row.plan_name,
      priceMonthly: Number(row.price_monthly ?? 0),
      monthlyEditLimit: row.monthly_edit_limit ?? null,
      stripePriceId: row.stripe_price_id,
    }));
  }

  async getUsage(accountId: string, fallbackLimit: number): Promise<UsageDetails> {
    const { rows } = await this.query(
      `
      SELECT monthly_edit_limit, edits_used, edits_used_this_period, period_start, period_end
      FROM edit_usage
      WHERE account_id = $1
      ORDER BY period_start DESC
      LIMIT 1
    `,
      [accountId]
    );
    const row = rows[0];
    const limit = Number(row?.monthly_edit_limit ?? fallbackLimit ?? 0);
    const used = Number(row?.edits_used ?? row?.edits_used_this_period ?? 0);
    return {
      monthlyEditLimit: limit,
      editsUsedThisPeriod: used,
      remainingEdits: Math.max(limit - used, 0),
      periodStart: row?.period_start?.toISOString?.() ?? row?.period_start ?? null,
      periodEnd: row?.period_end?.toISOString?.() ?? row?.period_end ?? null,
    };
  }

  async topUpEdits(accountId: string, amount: number, limit: number): Promise<void> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `
        SELECT id
        FROM edit_usage
        WHERE account_id = $1
        ORDER BY period_start DESC NULLS LAST, created_at DESC
        LIMIT 1
        FOR UPDATE
      `,
        [accountId]
      );
      if (rows[0]?.id) {
        await client.query(
          `
          UPDATE edit_usage
          SET edits_used = GREATEST(COALESCE(edits_used, 0) - $2, 0),
              edits_used_this_period = GREATEST(COALESCE(edits_used_this_period, 0) - $2, 0),
              monthly_edit_limit = $3
          WHERE id = $1
        `,
          [rows[0].id, amount, limit]
        );
      } else {
        await client.query(
          `
          INSERT INTO edit_usage (
            account_id,
            monthly_edit_limit,
            edits_used,
            edits_used_this_period,
            period_start,
            period_end
          ) VALUES (
            $1,
            $3,
            0,
            0,
            date_trunc('month', NOW()),
            date_trunc('month', NOW()) + interval '1 month'
          )
        `,
          [accountId, amount, limit]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async incrementUsage(accountId: string, limit: number, delta = 1): Promise<void> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `
        SELECT id
        FROM edit_usage
        WHERE account_id = $1
        ORDER BY period_start DESC NULLS LAST, created_at DESC
        LIMIT 1
        FOR UPDATE
      `,
        [accountId]
      );
      if (rows[0]?.id) {
        await client.query(
          `
          UPDATE edit_usage
          SET edits_used = COALESCE(edits_used, 0) + $2,
              edits_used_this_period = COALESCE(edits_used_this_period, 0) + $2,
              monthly_edit_limit = $3
          WHERE id = $1
        `,
          [rows[0].id, delta, limit]
        );
      } else {
        await client.query(
          `
          INSERT INTO edit_usage (
            account_id,
            monthly_edit_limit,
            edits_used,
            edits_used_this_period,
            period_start,
            period_end
          ) VALUES (
            $1,
            $3,
            $2,
            $2,
            date_trunc('month', NOW()),
            date_trunc('month', NOW()) + interval '1 month'
          )
        `,
          [accountId, delta, limit]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listCustomerEditRequests(accountId: string): Promise<EditRequestRecord[]> {
    const { rows } = await this.query(
      `
      SELECT
        er.*,
        lj.id AS latest_job_id,
        lj.status AS latest_job_status,
        lj.lovable_project_id AS latest_job_lovable_project_id,
        lj.s3_key AS latest_job_s3_key,
        lj.preview_url AS latest_job_preview_url,
        lj.error_message AS latest_job_error_message,
        lj.created_at AS latest_job_created_at,
        lj.updated_at AS latest_job_updated_at
      FROM edit_requests er
      LEFT JOIN LATERAL (
        SELECT * FROM edit_jobs ej
        WHERE ej.edit_request_id = er.id
        ORDER BY ej.created_at DESC
        LIMIT 1
      ) lj ON true
      WHERE er.account_id = $1
      ORDER BY er.created_at DESC
    `,
      [accountId]
    );
    return rows.map(mapRequest);
  }

  async createEditRequest(params: {
    accountId: string;
    userId: string;
    description: string;
    siteId?: string | null;
    businessDetails?: BusinessDetailsInput;
  }): Promise<EditRequestRecord> {
    const { rows } = await this.query(
      `
      INSERT INTO edit_requests (
        account_id,
        user_id,
        description,
        status,
        site_id,
        business_name,
        business_type,
        business_phone,
        business_address,
        additional_details
      ) VALUES ($1,$2,$3,'pending',$4,$5,$6,$7,$8,$9)
      RETURNING *
    `,
      [
        params.accountId,
        params.userId,
        params.description,
        params.siteId ?? null,
        params.businessDetails?.businessName ?? null,
        params.businessDetails?.businessType ?? null,
        params.businessDetails?.phone ?? null,
        params.businessDetails?.address ?? null,
        params.businessDetails?.additionalDetails ?? null,
      ]
    );
    return mapRequest(rows[0]);
  }

  async markTrialUsed(profileId: string): Promise<void> {
    await this.query(`UPDATE profiles SET has_used_trial = true WHERE id = $1`, [profileId]);
  }

  async createJobForRequest(editRequestId: string): Promise<EditJobRecord> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const insertResult = await client.query(
        `
        INSERT INTO edit_jobs (edit_request_id, status)
        VALUES ($1, 'queued')
        RETURNING *
      `,
        [editRequestId]
      );
      const job = insertResult.rows[0];
      await client.query(`UPDATE edit_requests SET latest_job_id = $1 WHERE id = $2`, [
        job.id,
        editRequestId,
      ]);
      await client.query('COMMIT');
      return mapJob(job);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getEditRequestById(id: string): Promise<EditRequestRecord | null> {
    const { rows } = await this.query(
      `
      SELECT
        er.*,
        lj.id AS latest_job_id,
        lj.status AS latest_job_status,
        lj.lovable_project_id AS latest_job_lovable_project_id,
        lj.s3_key AS latest_job_s3_key,
        lj.preview_url AS latest_job_preview_url,
        lj.error_message AS latest_job_error_message,
        lj.created_at AS latest_job_created_at,
        lj.updated_at AS latest_job_updated_at
      FROM edit_requests er
      LEFT JOIN LATERAL (
        SELECT * FROM edit_jobs ej
        WHERE ej.edit_request_id = er.id
        ORDER BY ej.created_at DESC
        LIMIT 1
      ) lj ON true
      WHERE er.id = $1
      LIMIT 1
    `,
      [id]
    );
    return rows[0] ? mapRequest(rows[0]) : null;
  }

  async listAdminEditRequests(filters: AdminEditRequestFilters): Promise<EditRequestRecord[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters.status) {
      params.push(filters.status);
      conditions.push(`er.status = $${params.length}`);
    }
    if (filters.accountId) {
      params.push(filters.accountId);
      conditions.push(`er.account_id = $${params.length}`);
    }
    if (filters.email) {
      params.push(`%${filters.email}%`);
      conditions.push(`profiles.email ILIKE $${params.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await this.query(
      `
      SELECT
        er.*,
        lj.id AS latest_job_id,
        lj.status AS latest_job_status,
        lj.lovable_project_id AS latest_job_lovable_project_id,
        lj.s3_key AS latest_job_s3_key,
        lj.preview_url AS latest_job_preview_url,
        lj.error_message AS latest_job_error_message,
        lj.created_at AS latest_job_created_at,
        lj.updated_at AS latest_job_updated_at
      FROM edit_requests er
      INNER JOIN profiles ON profiles.id = er.user_id
      LEFT JOIN LATERAL (
        SELECT * FROM edit_jobs ej
        WHERE ej.edit_request_id = er.id
        ORDER BY ej.created_at DESC
        LIMIT 1
      ) lj ON true
      ${whereClause}
      ORDER BY er.created_at DESC
    `,
      params
    );
    return rows.map(mapRequest);
  }

  async listJobs(filters: AdminJobFilters): Promise<EditJobRecord[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    if (filters.status) {
      params.push(filters.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filters.editRequestId) {
      params.push(filters.editRequestId);
      conditions.push(`edit_request_id = $${params.length}`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await this.query(
      `
      SELECT * FROM edit_jobs
      ${whereClause}
      ORDER BY created_at DESC
    `,
      params
    );
    return rows.map(mapJob);
  }

  async getJobById(jobId: string): Promise<EditJobRecord | null> {
    const { rows } = await this.query(`SELECT * FROM edit_jobs WHERE id = $1 LIMIT 1`, [jobId]);
    return rows[0] ? mapJob(rows[0]) : null;
  }

  async updateJob(jobId: string, updates: Partial<EditJobRecord>): Promise<EditJobRecord> {
    const fields: string[] = [];
    const params: any[] = [];

    const setField = (column: string, value: any) => {
      params.push(value);
      fields.push(`${column} = $${params.length}`);
    };

    if (updates.status) setField('status', updates.status);
    if (updates.lovableProjectId !== undefined) setField('lovable_project_id', updates.lovableProjectId);
    if (updates.s3Key !== undefined) setField('s3_key', updates.s3Key);
    if (updates.previewUrl !== undefined) setField('preview_url', updates.previewUrl);
    if (updates.errorMessage !== undefined) setField('error_message', updates.errorMessage);

    if (!fields.length) {
      const existing = await this.getJobById(jobId);
      if (!existing) throw new Error('Job not found');
      return existing;
    }

    params.push(jobId);

    const { rows } = await this.query(
      `
      UPDATE edit_jobs
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length}
      RETURNING *
    `,
      params
    );
    if (!rows[0]) throw new Error('Job not found');
    return mapJob(rows[0]);
  }

  async updateEditRequestStatus(editRequestId: string, status: EditRequestStatus, latestJobId?: string) {
    const fields = ['status = $1'];
    const params: any[] = [status];
    if (latestJobId) {
      params.push(latestJobId);
      fields.push(`latest_job_id = $${params.length}`);
    }
    params.push(editRequestId);
    await this.query(
      `
      UPDATE edit_requests
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length}
    `,
      params
    );
  }

  async retryJob(jobId: string): Promise<EditJobRecord> {
    const existing = await this.getJobById(jobId);
    if (!existing) throw new Error('Job not found');
    if (existing.status !== 'failed') {
      const error = new Error('Job is not in a retryable state');
      // @ts-expect-error attach http status
      error.statusCode = 400;
      throw error;
    }
    return this.createJobForRequest(existing.editRequestId);
  }

  async recordTemplateUpload(params: {
    templateId: string;
    fileName: string;
    s3Key: string;
    uploadedBy: string;
  }): Promise<TemplateUploadRecord> {
    const { rows } = await this.query(
      `
      INSERT INTO templates (template_id, file_name, s3_key, uploaded_by)
      VALUES ($1,$2,$3,$4)
      RETURNING template_id, file_name, s3_key, uploaded_at, uploaded_by
    `,
      [params.templateId, params.fileName, params.s3Key, params.uploadedBy]
    );
    if (!rows[0]) {
      throw new Error('Failed to record template upload');
    }
    const row = rows[0];
    return {
      templateId: row.template_id,
      fileName: row.file_name,
      s3Key: row.s3_key,
      uploadedAt: row.uploaded_at?.toISOString?.() ?? row.uploaded_at,
      uploadedBy: row.uploaded_by,
    };
  }

  async createSiteGenerationRequest(params: {
    requestId: string;
    accountId?: string | null;
    userId?: string | null;
    sourceUrl?: string | null;
    description?: string;
    slug?: string;
    prefix?: string;
    bucket?: string | null;
    businessDetails?: BusinessDetailsInput;
  }): Promise<SiteGenerationRecord> {
    const { rows } = await this.query(
      `
      INSERT INTO site_generations (
        request_id,
        account_id,
        user_id,
        source_url,
        description,
        slug,
        prefix,
        business_name,
        business_type,
        business_phone,
        business_address,
        additional_details,
        status,
        bucket
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'queued',$13)
      RETURNING *
    `,
      [
        params.requestId,
        params.accountId ?? null,
        params.userId ?? null,
        params.sourceUrl ?? null,
        params.description ?? null,
        params.slug ?? null,
        params.prefix ?? null,
        params.businessDetails?.businessName ?? null,
        params.businessDetails?.businessType ?? null,
        params.businessDetails?.phone ?? null,
        params.businessDetails?.address ?? null,
        params.businessDetails?.additionalDetails ?? null,
        params.bucket ?? null,
      ]
    );
    if (!rows[0]) {
      throw new Error('Failed to create site generation request');
    }
    const record = mapSiteGeneration(rows[0]);
    await this.recordAccountSite(record.accountId ?? null, record.slug ?? null, record.createdAt);
    return record;
  }

  async updateSiteGeneration(requestId: string, updates: Partial<SiteGenerationRecord>): Promise<void> {
    const fields: string[] = [];
    const params: any[] = [];

    const setField = (column: string, value: any) => {
      params.push(value);
      fields.push(`${column} = $${params.length}`);
    };

    if (updates.status) setField('status', updates.status);
    if (updates.slug !== undefined) setField('slug', updates.slug);
    if (updates.prefix !== undefined) setField('prefix', updates.prefix);
    if (updates.bucket !== undefined) setField('bucket', updates.bucket);
    if (updates.publicUrl !== undefined) setField('public_url', updates.publicUrl);
    if (updates.errorMessage !== undefined) setField('error_message', updates.errorMessage);

    if (!fields.length) return;
    params.push(requestId);
    await this.query(
      `
      UPDATE site_generations
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE request_id = $${params.length}
    `,
      params
    );
  }

  async touchSiteGenerationStage(requestId: string, stage: SiteGenerationRecord['status']) {
    await this.updateSiteGeneration(requestId, { status: stage });
  }

  async getSiteGenerationByRequestId(requestId: string, accountId?: string): Promise<SiteGenerationRecord | null> {
    const params: any[] = [requestId];
    let where = 'request_id = $1';
    if (accountId) {
      params.push(accountId);
      where += ` AND account_id = $${params.length}`;
    }
    const { rows } = await this.query(`SELECT * FROM site_generations WHERE ${where} LIMIT 1`, params);
    return rows[0] ? mapSiteGeneration(rows[0]) : null;
  }

  async listSiteGenerations(accountId: string): Promise<SiteGenerationRecord[]> {
    const { rows } = await this.query(
      `
      SELECT * FROM site_generations
      WHERE account_id = $1
      ORDER BY created_at DESC
    `,
      [accountId]
    );
    return rows.map(mapSiteGeneration);
  }

  async listSiteGenerationsPage(
    accountId: string,
    options: { limit?: number; cursor?: { createdAt: string; requestId: string } } = {}
  ): Promise<{ items: SiteGenerationRecord[]; nextCursor: { createdAt: string; requestId: string } | null }> {
    const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
    const values: any[] = [accountId];
    const conditions: string[] = ['account_id = $1'];
    let nextParamIndex = 2;
    if (options.cursor?.createdAt && options.cursor?.requestId) {
      conditions.push(
        `(created_at < $${nextParamIndex} OR (created_at = $${nextParamIndex} AND request_id < $${nextParamIndex + 1}))`
      );
      values.push(options.cursor.createdAt, options.cursor.requestId);
      nextParamIndex += 2;
    }
    values.push(limit + 1);
    const limitParamIndex = nextParamIndex;
    const sql = `
      SELECT *
      FROM site_generations
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC, request_id DESC
      LIMIT $${limitParamIndex}
    `;
    const { rows } = await this.query(sql, values);
    const items = rows.slice(0, limit).map(mapSiteGeneration);
    if (rows.length > limit) {
      const last = items[items.length - 1];
      if (last) {
        return {
          items,
          nextCursor: {
            createdAt: last.createdAt,
            requestId: last.requestId,
          },
        };
      }
    }
    return { items, nextCursor: null };
  }

  async listAccountSlugs(accountId: string): Promise<string[]> {
    if (!accountId) return [];
    const { rows } = await this.query(
      `
      SELECT slug
      FROM account_sites
      WHERE account_id = $1
      ORDER BY created_at DESC
    `,
      [accountId]
    );
    return rows.map((row) => row.slug).filter(Boolean);
  }

  async listAccountsAdmin(): Promise<AccountSummary[]> {
    const { rows } = await this.query(
      `
      SELECT
        p.account_id,
        MIN(p.created_at) AS created_at,
        MIN(p.email) FILTER (WHERE p.email IS NOT NULL) AS primary_email,
        COUNT(DISTINCT p.id) AS user_count,
        COUNT(DISTINCT sg.request_id) AS site_count,
        MAX(sg.created_at) AS last_site_at
      FROM profiles p
      LEFT JOIN site_generations sg ON sg.account_id = p.account_id
      GROUP BY p.account_id
      ORDER BY MAX(sg.created_at) DESC NULLS LAST, MIN(p.created_at) DESC
    `
    );
    return rows.map((row) => ({
      accountId: row.account_id,
      primaryEmail: row.primary_email ?? null,
      userCount: Number(row.user_count ?? 0),
      siteCount: Number(row.site_count ?? 0),
      createdAt: toIsoString(row.created_at),
      lastSiteAt: toIsoString(row.last_site_at),
    }));
  }

  async getAccountWithUsers(accountId: string): Promise<AccountWithUsers | null> {
    const { rows } = await this.query(
      `
      SELECT
        p.account_id,
        MIN(p.created_at) AS created_at,
        MIN(p.email) FILTER (WHERE p.email IS NOT NULL) AS primary_email,
        COUNT(DISTINCT p.id) AS user_count,
        COUNT(DISTINCT sg.request_id) AS site_count,
        MAX(sg.created_at) AS last_site_at
      FROM profiles p
      LEFT JOIN site_generations sg ON sg.account_id = p.account_id
      WHERE p.account_id = $1
      GROUP BY p.account_id
      LIMIT 1
    `,
      [accountId]
    );
    const summaryRow = rows[0];
    if (!summaryRow) return null;
    const summary: AccountSummary = {
      accountId: summaryRow.account_id,
      primaryEmail: summaryRow.primary_email ?? null,
      userCount: Number(summaryRow.user_count ?? 0),
      siteCount: Number(summaryRow.site_count ?? 0),
      createdAt: toIsoString(summaryRow.created_at),
      lastSiteAt: toIsoString(summaryRow.last_site_at),
    };
    const users = await this.listUsersAdmin({ accountId });
    return { ...summary, users };
  }

  async listSiteGenerationsAdmin(filters: {
    accountId?: string;
    status?: SiteGenerationRecord['status'];
    limit?: number;
  }): Promise<SiteGenerationRecord[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    if (filters.accountId) {
      params.push(filters.accountId);
      conditions.push(`account_id = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      conditions.push(`status = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit && Number.isFinite(filters.limit) ? Math.min(filters.limit, 200) : 100;
    const { rows } = await this.query(
      `
      SELECT * FROM site_generations
      ${where}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `,
      params
    );
    return rows.map(mapSiteGeneration);
  }

  async upsertSubscriptionFromStripe(params: {
    accountId: string;
    planKey: string;
    status: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    currentPeriodStart?: number | string | null;
    currentPeriodEnd?: number | string | null;
  }) {
    const { accountId, planKey, status, stripeCustomerId, stripeSubscriptionId } = params;
    const currentPeriodStart = params.currentPeriodStart
      ? new Date(params.currentPeriodStart).toISOString()
      : null;
    const currentPeriodEnd = params.currentPeriodEnd
      ? new Date(params.currentPeriodEnd).toISOString()
      : null;

    await this.query(
      `
      INSERT INTO subscriptions (
        account_id,
        plan_key,
        status,
        stripe_customer_id,
        stripe_subscription_id,
        current_period_start,
        current_period_end
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (account_id) DO UPDATE
      SET
        plan_key = EXCLUDED.plan_key,
        status = EXCLUDED.status,
        stripe_customer_id = EXCLUDED.stripe_customer_id,
        stripe_subscription_id = EXCLUDED.stripe_subscription_id,
        current_period_start = EXCLUDED.current_period_start,
        current_period_end = EXCLUDED.current_period_end,
        updated_at = NOW()
    `,
      [
        accountId,
        planKey,
        status,
        stripeCustomerId,
        stripeSubscriptionId,
        currentPeriodStart,
        currentPeriodEnd,
      ]
    );
  }

  async createDomainOrder(params: {
    accountId?: string | null;
    slug?: string | null;
    domain: string;
    status: string;
    providerOrderId?: string | null;
    priceCents?: number | null;
    currency?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<DomainOrderRecord> {
    const { rows } = await this.query(
      `
      INSERT INTO domain_orders (
        account_id,
        slug,
        domain,
        status,
        provider_order_id,
        price_cents,
        currency,
        metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `,
      [
        params.accountId ?? null,
        params.slug ?? null,
        params.domain,
        params.status,
        params.providerOrderId ?? null,
        params.priceCents ?? null,
        params.currency ?? null,
        params.metadata ?? null,
      ]
    );
    if (!rows[0]) throw new Error('Failed to record domain order');
    return mapDomainOrder(rows[0]);
  }

  async listDomainsForSlug(slug: string): Promise<DomainRecord[]> {
    const { rows } = await this.query(
      `
      SELECT * FROM site_domains
      WHERE slug = $1
      ORDER BY created_at DESC
    `,
      [slug]
    );
    return rows.map(mapDomainRecord);
  }

  async listDomainsForAccount(accountId: string): Promise<DomainRecord[]> {
    const { rows } = await this.query(
      `
      SELECT * FROM site_domains
      WHERE account_id = $1
      ORDER BY created_at DESC
    `,
      [accountId]
    );
    return rows.map(mapDomainRecord);
  }

  async countDomainsForAccount(accountId: string): Promise<number> {
    const { rows } = await this.query(
      `
      SELECT COUNT(*) AS count
      FROM site_domains
      WHERE account_id = $1
    `,
      [accountId]
    );
    return Number(rows?.[0]?.count ?? 0);
  }

  async acquireDomainJobLock(): Promise<(() => Promise<void>) | null> {
    const client = await pool.connect();
    try {
      const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [
        DOMAIN_JOB_LOCK_KEY,
      ]);
      if (!rows?.[0]?.locked) {
        client.release();
        return null;
      }
      return async () => {
        try {
          await client.query('SELECT pg_advisory_unlock($1)', [DOMAIN_JOB_LOCK_KEY]);
        } finally {
          client.release();
        }
      };
    } catch (error) {
      client.release();
      throw error;
    }
  }

  async listDomainsNeedingHttpsRefresh(limit = 25): Promise<DomainRecord[]> {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 25, 500));
    const { rows } = await this.query(
      `
      SELECT *
      FROM site_domains
      WHERE
        https_status IS NULL
        OR https_status IN ('pending','validating','provisioning')
        OR routing_error IS NOT NULL
        OR https_checked_at IS NULL
        OR https_checked_at < NOW() - INTERVAL '10 minutes'
      ORDER BY https_checked_at NULLS FIRST, updated_at ASC
      LIMIT $1
    `,
      [safeLimit]
    );
    return rows.map(mapDomainRecord);
  }

  async getDomainOrderById(id: string): Promise<DomainOrderRecord | null> {
    const { rows } = await this.query(`SELECT * FROM domain_orders WHERE id = $1 LIMIT 1`, [id]);
    return rows[0] ? mapDomainOrder(rows[0]) : null;
  }

  async getDomainOrdersByIds(ids: string[]): Promise<DomainOrderRecord[]> {
    if (!ids.length) return [];
    const params = ids.map((_id, index) => `$${index + 1}`).join(',');
    const { rows } = await this.query(
      `SELECT * FROM domain_orders WHERE id IN (${params})`,
      ids
    );
    return rows.map(mapDomainOrder);
  }

  async updateDomainOrder(
    id: string,
    updates: {
      status?: string;
      providerOrderId?: string | null;
      metadata?: Record<string, unknown> | null;
    }
  ): Promise<DomainOrderRecord | null> {
    const fields: string[] = [];
    const values: any[] = [];
    const setField = (column: string, value: any) => {
      values.push(value);
      fields.push(`${column} = $${values.length}`);
    };
    if (updates.status) setField('status', updates.status);
    if (updates.providerOrderId !== undefined) setField('provider_order_id', updates.providerOrderId);
    if (updates.metadata !== undefined) setField('metadata', updates.metadata);
    if (!fields.length) {
      return this.getDomainOrderById(id);
    }
    values.push(id);
    const { rows } = await this.query(
      `
      UPDATE domain_orders
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *
    `,
      values
    );
    return rows[0] ? mapDomainOrder(rows[0]) : null;
  }

  async getPendingLaunchReservationTotal(accountId: string): Promise<number> {
    const { rows } = await this.query(
      `
      SELECT COALESCE(SUM(cost), 0) AS total
      FROM launch_reservations
      WHERE account_id = $1 AND status = 'pending'
    `,
      [accountId]
    );
    return Number(rows[0]?.total ?? 0);
  }

  async createLaunchReservation(params: {
    accountId: string;
    requestId: string;
    cost: number;
    limitSnapshot?: number | null;
  }): Promise<void> {
    await this.query(
      `
      INSERT INTO launch_reservations (account_id, request_id, cost, limit_snapshot, status)
      VALUES ($1,$2,$3,$4,'pending')
      ON CONFLICT (request_id) DO NOTHING
    `,
      [params.accountId, params.requestId, params.cost, params.limitSnapshot ?? null]
    );
  }

  async releaseLaunchReservation(requestId: string, reason?: string): Promise<boolean> {
    const result = await this.query(
      `
      UPDATE launch_reservations
      SET status = 'released',
          reason = COALESCE($2, reason),
          released_at = NOW(),
          updated_at = NOW()
      WHERE request_id = $1 AND status = 'pending'
    `,
      [requestId, reason ?? null]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async consumeLaunchReservation(
    requestId: string
  ): Promise<{ accountId: string; cost: number; limitSnapshot: number | null } | null> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `
        SELECT *
        FROM launch_reservations
        WHERE request_id = $1
        LIMIT 1
        FOR UPDATE
      `,
        [requestId]
      );
      const row = existing.rows[0];
      if (!row || row.status !== 'pending') {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query(
        `
        UPDATE launch_reservations
        SET status = 'consumed',
            consumed_at = NOW(),
            updated_at = NOW()
        WHERE request_id = $1
      `,
        [requestId]
      );
      await client.query('COMMIT');
      return {
        accountId: row.account_id,
        cost: Number(row.cost ?? 1),
        limitSnapshot: row.limit_snapshot ?? null,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async enqueueDomainJob(params: {
    domain: string;
    slug?: string | null;
    type: DomainJobType;
    payload?: Record<string, unknown> | null;
    scheduleAt?: Date | string | null;
  }): Promise<DomainJobRecord> {
    const scheduled =
      params.scheduleAt instanceof Date
        ? params.scheduleAt.toISOString()
        : params.scheduleAt ?? new Date().toISOString();
    const { rows } = await this.query(
      `
      INSERT INTO domain_jobs (domain, slug, job_type, status, payload, scheduled_at)
      VALUES ($1,$2,$3,'pending',$4,$5)
      RETURNING *
    `,
      [params.domain, params.slug ?? null, params.type, params.payload ?? null, scheduled]
    );
    return mapDomainJob(rows[0]);
  }

  async claimDomainJobs(limit = 10): Promise<DomainJobRecord[]> {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const selectable = await client.query(
        `
        SELECT *
        FROM domain_jobs
        WHERE status IN ('pending','retry') AND scheduled_at <= NOW()
        ORDER BY scheduled_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      `,
        [safeLimit]
      );
      if (!selectable.rows.length) {
        await client.query('COMMIT');
        return [];
      }
      const claimed: DomainJobRecord[] = [];
      for (const row of selectable.rows) {
        const updated = await client.query(
          `
          UPDATE domain_jobs
          SET status = 'running',
              started_at = NOW(),
              attempts = COALESCE(attempts, 0) + 1,
              last_error = NULL,
              updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
          [row.id]
        );
        if (updated.rows[0]) {
          claimed.push(mapDomainJob(updated.rows[0]));
        }
      }
      await client.query('COMMIT');
      return claimed;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async completeDomainJob(id: string, status: DomainJobStatus = 'completed'): Promise<DomainJobRecord | null> {
    const { rows } = await this.query(
      `
      UPDATE domain_jobs
      SET status = $2,
          completed_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
      [id, status]
    );
    return rows[0] ? mapDomainJob(rows[0]) : null;
  }

  async retryDomainJob(
    id: string,
    options: { delayMs?: number; error?: string; status?: DomainJobStatus }
  ): Promise<DomainJobRecord | null> {
    const delay = Math.max(1000, options.delayMs ?? 60_000);
    const { rows } = await this.query(
      `
      UPDATE domain_jobs
      SET status = $2,
          last_error = $3,
          scheduled_at = NOW() + ($4::bigint || ' milliseconds')::interval,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
      [id, options.status ?? 'retry', options.error ?? null, delay]
    );
    return rows[0] ? mapDomainJob(rows[0]) : null;
  }

  async failDomainJob(id: string, error?: string): Promise<DomainJobRecord | null> {
    const { rows } = await this.query(
      `
      UPDATE domain_jobs
      SET status = 'failed',
          last_error = $2,
          completed_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
      [id, error ?? null]
    );
    return rows[0] ? mapDomainJob(rows[0]) : null;
  }

  async recordDomainEvent(params: {
    domain: string;
    slug?: string | null;
    type: string;
    status?: string | null;
    description?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<DomainEventRecord> {
    const { rows } = await this.query(
      `
      INSERT INTO domain_events (domain, slug, event_type, status, description, metadata)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
    `,
      [
        params.domain,
        params.slug ?? null,
        params.type,
        params.status ?? null,
        params.description ?? null,
        params.metadata ?? null,
      ]
    );
    return mapDomainEvent(rows[0]);
  }

  async upsertSiteDomain(params: {
    accountId?: string | null;
    slug: string;
    domain: string;
    type: string;
    provider?: string | null;
    status?: string;
    verificationToken?: string | null;
    dnsSettings?: Record<string, unknown> | null;
  }): Promise<DomainRecord> {
    const { rows } = await this.query(
      `
      INSERT INTO site_domains (
        account_id,
        slug,
        domain,
        type,
        provider,
        status,
        verification_token,
        dns_settings
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (domain) DO UPDATE
      SET
        slug = EXCLUDED.slug,
        account_id = COALESCE(EXCLUDED.account_id, site_domains.account_id),
        type = EXCLUDED.type,
        provider = EXCLUDED.provider,
        status = EXCLUDED.status,
        verification_token = EXCLUDED.verification_token,
        dns_settings = EXCLUDED.dns_settings,
        updated_at = NOW()
      RETURNING *
    `,
      [
        params.accountId ?? null,
        params.slug,
        params.domain,
        params.type,
        params.provider ?? null,
        params.status ?? 'pending',
        params.verificationToken ?? null,
        params.dnsSettings ?? null,
      ]
    );
    return mapDomainRecord(rows[0]);
  }

  async updateSiteDomain(domain: string, updates: Partial<DomainRecord>): Promise<DomainRecord | null> {
    const fields: string[] = [];
    const params: any[] = [];
    const setField = (column: string, value: any) => {
      params.push(value);
      fields.push(`${column} = $${params.length}`);
    };
    if (updates.status) setField('status', updates.status);
    if (updates.isPrimary !== undefined) setField('is_primary', updates.isPrimary);
    if (updates.verificationToken !== undefined) setField('verification_token', updates.verificationToken);
    if (updates.dnsSettings !== undefined) setField('dns_settings', updates.dnsSettings);
    if (updates.provider !== undefined) setField('provider', updates.provider);
    if (updates.type) setField('type', updates.type);
    if (updates.accountId !== undefined) setField('account_id', updates.accountId);
    if (updates.slug) setField('slug', updates.slug);
    if (updates.verifiedAt) setField('verified_at', updates.verifiedAt);
    if (updates.lastCheckedAt) setField('last_checked_at', updates.lastCheckedAt);
    if (updates.httpsStatus) setField('https_status', updates.httpsStatus);
    if (updates.httpsReadyAt) setField('https_ready_at', updates.httpsReadyAt);
    if (updates.httpsCheckedAt) setField('https_checked_at', updates.httpsCheckedAt);
    if (updates.certificateArn !== undefined) setField('certificate_arn', updates.certificateArn);
    if (updates.certificateStatus) setField('certificate_status', updates.certificateStatus);
    if (updates.certificateStatusAt) setField('certificate_status_at', updates.certificateStatusAt);
    if (updates.certificateValidation !== undefined)
      setField('certificate_validation', updates.certificateValidation);
    if (updates.edgeDomain !== undefined) setField('edge_domain', updates.edgeDomain);
    if (updates.edgeDistributionId !== undefined)
      setField('edge_distribution_id', updates.edgeDistributionId);
    if (updates.edgeStatus) setField('edge_status', updates.edgeStatus);
    if (updates.edgeStatusAt) setField('edge_status_at', updates.edgeStatusAt);
    if (updates.edgeFunctionName !== undefined) setField('edge_function_name', updates.edgeFunctionName);
    if (updates.edgeFunctionArn !== undefined) setField('edge_function_arn', updates.edgeFunctionArn);
    if (updates.canonicalHost !== undefined) setField('canonical_host', updates.canonicalHost);
    if (updates.canonicalMode !== undefined) setField('canonical_mode', updates.canonicalMode);
    if (updates.routingError !== undefined) setField('routing_error', updates.routingError);
    if (!fields.length) {
      return this.getDomainByName(domain);
    }
    params.push(domain);
    const { rows } = await this.query(
      `
      UPDATE site_domains
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE domain = $${params.length}
      RETURNING *
    `,
      params
    );
    return rows[0] ? mapDomainRecord(rows[0]) : null;
  }

  async getDomainByName(domain: string): Promise<DomainRecord | null> {
    const { rows } = await this.query(`SELECT * FROM site_domains WHERE domain = $1 LIMIT 1`, [domain]);
    return rows[0] ? mapDomainRecord(rows[0]) : null;
  }

  async deleteSiteDomain(domain: string, slug?: string): Promise<void> {
    const params: any[] = [domain];
    let where = 'domain = $1';
    if (slug) {
      params.push(slug);
      where += ` AND slug = $${params.length}`;
    }
    await this.query(`DELETE FROM site_domains WHERE ${where}`, params);
  }

  async setPrimaryDomainForSlug(slug: string, domain: string): Promise<void> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE site_domains SET is_primary = false WHERE slug = $1`, [slug]);
      await client.query(
        `UPDATE site_domains SET is_primary = true WHERE slug = $1 AND domain = $2`,
        [slug, domain]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createDeployment(params: {
    slug: string;
    accountId?: string | null;
    target: string;
    status: string;
    bucket?: string | null;
    prefix?: string | null;
    publicUrl?: string | null;
    requestedBy?: string | null;
    errorMessage?: string | null;
  }): Promise<DeploymentRecord> {
    const { rows } = await this.query(
      `
      INSERT INTO site_deployments (
        slug,
        account_id,
        target,
        status,
        bucket,
        prefix,
        public_url,
        requested_by,
        error_message
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `,
      [
        params.slug,
        params.accountId ?? null,
        params.target,
        params.status,
        params.bucket ?? null,
        params.prefix ?? null,
        params.publicUrl ?? null,
        params.requestedBy ?? null,
        params.errorMessage ?? null,
      ]
    );
    return mapDeploymentRecord(rows[0]);
  }

  async updateDeployment(
    deploymentId: string,
    updates: Partial<DeploymentRecord>
  ): Promise<DeploymentRecord | null> {
    const fields: string[] = [];
    const params: any[] = [];
    const setField = (column: string, value: any) => {
      params.push(value);
      fields.push(`${column} = $${params.length}`);
    };
    if (updates.status) setField('status', updates.status);
    if (updates.bucket !== undefined) setField('bucket', updates.bucket);
    if (updates.prefix !== undefined) setField('prefix', updates.prefix);
    if (updates.publicUrl !== undefined) setField('public_url', updates.publicUrl);
    if (updates.errorMessage !== undefined) setField('error_message', updates.errorMessage);
    if (updates.completedAt) setField('completed_at', updates.completedAt);
    if (!fields.length) {
      return this.getDeploymentById(deploymentId);
    }
    params.push(deploymentId);
    const { rows } = await this.query(
      `
      UPDATE site_deployments
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length}
      RETURNING *
    `,
      params
    );
    return rows[0] ? mapDeploymentRecord(rows[0]) : null;
  }

  async listDeployments(slug: string, limit = 50): Promise<DeploymentRecord[]> {
    const { rows } = await this.query(
      `
      SELECT * FROM site_deployments
      WHERE slug = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
      [slug, Math.min(Math.max(limit, 1), 200)]
    );
    return rows.map(mapDeploymentRecord);
  }

  async getDeploymentById(deploymentId: string): Promise<DeploymentRecord | null> {
    const { rows } = await this.query(
      `
      SELECT * FROM site_deployments
      WHERE id = $1
      LIMIT 1
    `,
      [deploymentId]
    );
    return rows[0] ? mapDeploymentRecord(rows[0]) : null;
  }

  buildUsageLimits(subscription: SubscriptionDetails | null, fallbackLimit: number): UsageLimits {
    const planKey = (subscription?.planKey ?? 'trial').toLowerCase();
    const planName = subscription?.planName ?? 'Trial';
    const monthlyEditLimit = subscription?.monthlyEditLimit ?? fallbackLimit;
    const isPaid = Boolean(subscription && subscription.status === 'active');
    if (planKey === 'infinite') {
      return {
        planKey,
        planName,
        monthlyEditLimit: monthlyEditLimit ?? 1000000,
        freeSiteLimit: 100000,
        dailyRebuildLimit: 100,
        allowCustomDomains: true,
        allowLivePublishing: true,
        allowAiImages: true,
        allowSeoTools: true,
        allowOverage: true,
        coupons: [],
      };
    }
    const freeSiteLimit =
      planKey === 'scale' ? 10 : planKey === 'growth' ? 5 : 1; // starter/trial: 1 site; growth/scale: multiple
    return {
      planKey,
      planName,
      monthlyEditLimit,
      freeSiteLimit,
      dailyRebuildLimit: isPaid ? 20 : 3,
      allowCustomDomains: isPaid,
      allowLivePublishing: isPaid,
      allowAiImages: isPaid,
      allowSeoTools: isPaid,
      allowOverage: false,
      coupons: [],
    };
  }

  async recordSiteMetric(slug: string, event: 'view' | 'cta'): Promise<void> {
    const client = await this.getAnalyticsClient();
    try {
      await client.query('BEGIN');
      const column = event === 'cta' ? 'cta_clicks' : 'views';
      await client.query(
        `
        INSERT INTO site_metrics (slug, event_date, ${column})
        VALUES ($1, CURRENT_DATE, 1)
        ON CONFLICT (slug, event_date)
        DO UPDATE SET ${column} = site_metrics.${column} + 1, updated_at = NOW()
      `,
        [slug]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getSiteMetrics(slug: string, days = 30): Promise<{ views: number; ctaClicks: number }> {
    const daily = await this.analyticsQuery(
      `
      SELECT
        COALESCE(SUM(views), 0) AS views,
        COALESCE(SUM(cta_clicks), 0) AS cta_clicks
      FROM site_metrics_daily
      WHERE slug = $1
        AND stat_date >= (CURRENT_DATE - ($2 || ' days')::interval)
    `,
      [slug, days]
    );
    const viewValue = daily.rows[0]?.views;
    const ctaValue = daily.rows[0]?.cta_clicks;
    if (viewValue !== null && ctaValue !== null) {
      return {
        views: Number(viewValue ?? 0),
        ctaClicks: Number(ctaValue ?? 0),
      };
    }
    const fallback = await this.analyticsQuery(
      `
      SELECT
        COALESCE(SUM(views), 0) AS views,
        COALESCE(SUM(cta_clicks), 0) AS cta_clicks
      FROM site_metrics
      WHERE slug = $1
        AND event_date >= (CURRENT_DATE - ($2 || ' days')::interval)
    `,
      [slug, days]
    );
    return {
      views: Number(fallback.rows[0]?.views ?? 0),
      ctaClicks: Number(fallback.rows[0]?.cta_clicks ?? 0),
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
