import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from '../env';
import {
  AdminEditRequestFilters,
  AdminJobFilters,
  BusinessDetailsInput,
  EditJobRecord,
  EditRequestRecord,
  EditRequestStatus,
  ProfileRecord,
  SubscriptionDetails,
  SubscriptionPlan,
  TemplateUploadRecord,
  UsageDetails,
  UserRole,
} from '../types';

const pool = new Pool({
  connectionString: config.database.url,
  ssl: config.nodeEnv === 'production' ? { rejectUnauthorized: false } : undefined,
});

const mapProfile = (row: any): ProfileRecord => ({
  id: row.id,
  accountId: row.account_id,
  email: row.email,
  fullName: row.full_name,
  cognitoSub: row.cognito_sub,
  hasUsedTrial: Boolean(row.has_used_trial),
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

export class DatabaseService {
  private pool: Pool;

  constructor(poolInstance: Pool = pool) {
    this.pool = poolInstance;
  }

  private async query<T extends QueryResultRow = QueryResultRow>(text: string, params: any[] = []) {
    return this.pool.query<T>(text, params);
  }

  private async getClient(): Promise<PoolClient> {
    return this.pool.connect();
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

  async getRolesForUser(userId: string): Promise<UserRole[]> {
    const { rows } = await this.query<{ role: UserRole }>(
      `SELECT role FROM user_roles WHERE user_id = $1`,
      [userId]
    );
    return rows.map((row) => row.role);
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
}
