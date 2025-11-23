import { PostgrestError, SupabaseClient, createClient } from '@supabase/supabase-js';
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

const buildSupabaseClient = (): SupabaseClient =>
  createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false },
  });

const mapProfile = (row: any): ProfileRecord => ({
  id: row.id,
  accountId: row.account_id,
  email: row.email,
  fullName: row.full_name,
  cognitoSub: row.cognito_sub,
  hasUsedTrial: Boolean(row.has_used_trial),
});

const mapSubscription = (row: any): SubscriptionDetails => ({
  planKey: row.plan_key,
  planName: row.subscription_plans?.plan_name ?? row.plan_name ?? row.plan_key,
  priceMonthly: Number(row.subscription_plans?.price_monthly ?? row.price_monthly ?? 0),
  status: row.status,
  currentPeriodStart: row.current_period_start,
  currentPeriodEnd: row.current_period_end,
  stripeCustomerId: row.stripe_customer_id,
  stripeSubscriptionId: row.stripe_subscription_id,
  monthlyEditLimit: row.subscription_plans?.monthly_edit_limit ?? row.monthly_edit_limit ?? null,
});

const mapUsage = (row: any, fallbackLimit: number): UsageDetails => {
  const limit = Number(row?.monthly_edit_limit ?? fallbackLimit ?? 0);
  const used = Number(row?.edits_used ?? row?.edits_used_this_period ?? 0);
  return {
    monthlyEditLimit: limit,
    editsUsedThisPeriod: used,
    remainingEdits: Math.max(limit - used, 0),
    periodStart: row?.period_start ?? null,
    periodEnd: row?.period_end ?? null,
  };
};

const mapJob = (row: any): EditJobRecord => ({
  id: row.id,
  editRequestId: row.edit_request_id,
  status: row.status,
  lovableProjectId: row.lovable_project_id,
  s3Key: row.s3_key,
  previewUrl: row.preview_url,
  errorMessage: row.error_message,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapEditRequest = (row: any): EditRequestRecord => {
  let latestJob: EditJobRecord | null = null;
  if (row.edit_jobs && row.edit_jobs.length) {
    const sorted = [...row.edit_jobs].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    latestJob = mapJob(sorted[0]);
  }
  return {
    id: row.id,
    accountId: row.account_id,
    userId: row.user_id,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    siteId: row.site_id,
    latestJob,
  };
};

const raise = (error: PostgrestError | null, fallback: string) => {
  if (!error) return;
  const err = new Error(error.message || fallback);
  // @ts-expect-error augment error
  err.details = error.details;
  throw err;
};

export class SupabaseService {
  private client: SupabaseClient;

  constructor(client: SupabaseClient = buildSupabaseClient()) {
    this.client = client;
  }

  async getProfileByCognitoSub(cognitoSub: string): Promise<ProfileRecord | null> {
    const { data, error } = await this.client
      .from('profiles')
      .select('id, account_id, email, full_name, cognito_sub, has_used_trial')
      .eq('cognito_sub', cognitoSub)
      .maybeSingle();
    raise(error, 'Failed to load profile');
    return data ? mapProfile(data) : null;
  }

  async getRolesForUser(userId: string): Promise<UserRole[]> {
    const { data, error } = await this.client
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);
    raise(error, 'Failed to load roles');
    return (data ?? []).map((row) => row.role);
  }

  async getSubscription(accountId: string): Promise<SubscriptionDetails | null> {
    const { data, error } = await this.client
      .from('subscriptions')
      .select(
        `
        plan_key,
        status,
        current_period_start,
        current_period_end,
        stripe_customer_id,
        stripe_subscription_id,
        subscription_plans (
          plan_key,
          plan_name,
          price_monthly,
          monthly_edit_limit,
          stripe_price_id
        )
      `.trim()
      )
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    raise(error, 'Failed to load subscription');
    return data ? mapSubscription(data) : null;
  }

  async getSubscriptionPlan(planKey: string): Promise<SubscriptionPlan | null> {
    const { data, error } = await this.client
      .from('subscription_plans')
      .select('plan_key, plan_name, price_monthly, monthly_edit_limit, stripe_price_id')
      .eq('plan_key', planKey)
      .maybeSingle();
    raise(error, 'Failed to load plan');
    if (!data) return null;
    return {
      planKey: data.plan_key,
      planName: data.plan_name,
      priceMonthly: Number(data.price_monthly ?? 0),
      monthlyEditLimit: data.monthly_edit_limit ?? null,
      stripePriceId: data.stripe_price_id ?? null,
    };
  }

  async getUsage(accountId: string, fallbackLimit: number): Promise<UsageDetails> {
    const { data, error } = await this.client
      .from('edit_usage')
      .select('monthly_edit_limit, edits_used, edits_used_this_period, period_start, period_end')
      .eq('account_id', accountId)
      .order('period_start', { ascending: false })
      .limit(1)
      .maybeSingle();
    raise(error, 'Failed to load usage');
    return mapUsage(data, fallbackLimit);
  }

  async listCustomerEditRequests(accountId: string): Promise<EditRequestRecord[]> {
    const { data, error } = await this.client
      .from('edit_requests')
      .select(
        `
        id,
        account_id,
        user_id,
        description,
        status,
        site_id,
        created_at,
        updated_at,
        edit_jobs (
          id,
          edit_request_id,
          status,
          lovable_project_id,
          s3_key,
          preview_url,
          error_message,
          created_at,
          updated_at
        )
      `.trim()
      )
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });
    raise(error, 'Failed to list edit requests');
    return (data ?? []).map(mapEditRequest);
  }

  async createEditRequest(params: {
    accountId: string;
    userId: string;
    description: string;
    siteId?: string | null;
    businessDetails?: BusinessDetailsInput;
  }): Promise<EditRequestRecord> {
    const payload: Record<string, any> = {
      account_id: params.accountId,
      user_id: params.userId,
      description: params.description,
      status: 'pending',
      site_id: params.siteId ?? null,
      business_name: params.businessDetails?.businessName ?? null,
      business_type: params.businessDetails?.businessType ?? null,
      business_phone: params.businessDetails?.phone ?? null,
      business_address: params.businessDetails?.address ?? null,
      additional_details: params.businessDetails?.additionalDetails ?? null,
    };

    const { data, error } = await this.client
      .from('edit_requests')
      .insert(payload)
      .select(
        'id, account_id, user_id, description, status, site_id, created_at, updated_at'
      )
      .single();
    raise(error, 'Failed to create edit request');
    return mapEditRequest({ ...data, edit_jobs: [] });
  }

  async markTrialUsed(profileId: string): Promise<void> {
    const { error } = await this.client
      .from('profiles')
      .update({ has_used_trial: true })
      .eq('id', profileId);
    raise(error, 'Failed to update trial flag');
  }

  async createJobForRequest(editRequestId: string): Promise<EditJobRecord> {
    const { data, error } = await this.client
      .from('edit_jobs')
      .insert({
        edit_request_id: editRequestId,
        status: 'queued',
      })
      .select(
        'id, edit_request_id, status, lovable_project_id, s3_key, preview_url, error_message, created_at, updated_at'
      )
      .single();
    raise(error, 'Failed to create job');
    if (!data) {
      throw new Error('Failed to create job');
    }
    await this.client.from('edit_requests').update({ latest_job_id: data.id }).eq('id', editRequestId);
    return mapJob(data);
  }

  async getEditRequestById(id: string): Promise<EditRequestRecord | null> {
    const { data, error } = await this.client
      .from('edit_requests')
      .select(
        `
        id,
        account_id,
        user_id,
        description,
        status,
        site_id,
        created_at,
        updated_at,
        edit_jobs (
          id,
          edit_request_id,
          status,
          lovable_project_id,
          s3_key,
          preview_url,
          error_message,
          created_at,
          updated_at
        )
      `.trim()
      )
      .eq('id', id)
      .maybeSingle();
    raise(error, 'Failed to load edit request');
    return data ? mapEditRequest(data) : null;
  }

  async listAdminEditRequests(filters: AdminEditRequestFilters): Promise<EditRequestRecord[]> {
    let query = this.client
      .from('edit_requests')
      .select(
        `
        id,
        account_id,
        user_id,
        description,
        status,
        site_id,
        created_at,
        updated_at,
        edit_jobs (
          id,
          edit_request_id,
          status,
          lovable_project_id,
          s3_key,
          preview_url,
          error_message,
          created_at,
          updated_at
        ),
        profiles!inner(email)
      `.trim()
      )
      .order('created_at', { ascending: false });

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.accountId) query = query.eq('account_id', filters.accountId);
    if (filters.email) query = query.ilike('profiles.email', `%${filters.email}%`);

    const { data, error } = await query;
    raise(error, 'Failed to list admin edit requests');
    return (data ?? []).map(mapEditRequest);
  }

  async listJobs(filters: AdminJobFilters): Promise<EditJobRecord[]> {
    let query = this.client
      .from('edit_jobs')
      .select(
        'id, edit_request_id, status, lovable_project_id, s3_key, preview_url, error_message, created_at, updated_at'
      )
      .order('created_at', { ascending: false });

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.editRequestId) query = query.eq('edit_request_id', filters.editRequestId);

    const { data, error } = await query;
    raise(error, 'Failed to list jobs');
    return (data ?? []).map(mapJob);
  }

  async getJobById(jobId: string): Promise<EditJobRecord | null> {
    const { data, error } = await this.client
      .from('edit_jobs')
      .select(
        'id, edit_request_id, status, lovable_project_id, s3_key, preview_url, error_message, created_at, updated_at'
      )
      .eq('id', jobId)
      .maybeSingle();
    raise(error, 'Failed to load job');
    return data ? mapJob(data) : null;
  }

  async updateJob(jobId: string, updates: Partial<EditJobRecord>): Promise<EditJobRecord> {
    const payload: Record<string, any> = {};
    if (updates.status) payload.status = updates.status;
    if (updates.lovableProjectId !== undefined) payload.lovable_project_id = updates.lovableProjectId;
    if (updates.s3Key !== undefined) payload.s3_key = updates.s3Key;
    if (updates.previewUrl !== undefined) payload.preview_url = updates.previewUrl;
    if (updates.errorMessage !== undefined) payload.error_message = updates.errorMessage;

    const { data, error } = await this.client
      .from('edit_jobs')
      .update(payload)
      .eq('id', jobId)
      .select(
        'id, edit_request_id, status, lovable_project_id, s3_key, preview_url, error_message, created_at, updated_at'
      )
      .single();
    raise(error, 'Failed to update job');
    if (!data) {
      throw new Error('Job not found');
    }
    return mapJob(data);
  }

  async updateEditRequestStatus(editRequestId: string, status: EditRequestStatus, latestJobId?: string) {
    const payload: Record<string, any> = { status };
    if (latestJobId) payload.latest_job_id = latestJobId;
    const { error } = await this.client.from('edit_requests').update(payload).eq('id', editRequestId);
    raise(error, 'Failed to update edit request');
  }

  async retryJob(jobId: string): Promise<EditJobRecord> {
    const existing = await this.getJobById(jobId);
    if (!existing) throw new Error('Job not found');
    if (existing.status !== 'failed') {
      const err = new Error('Job is not in a retryable state');
      // @ts-expect-error attach status
      err.statusCode = 400;
      throw err;
    }
    return this.createJobForRequest(existing.editRequestId);
  }

  async recordTemplateUpload(params: {
    templateId: string;
    fileName: string;
    s3Key: string;
    uploadedBy: string;
  }): Promise<TemplateUploadRecord> {
    const { data, error } = await this.client
      .from('templates')
      .insert({
        template_id: params.templateId,
        file_name: params.fileName,
        s3_key: params.s3Key,
        uploaded_by: params.uploadedBy,
      })
      .select('template_id, file_name, s3_key, uploaded_at, uploaded_by')
      .single();
    raise(error, 'Failed to record template upload');
    if (!data) {
      throw new Error('Failed to record template upload');
    }
    return {
      templateId: data.template_id,
      fileName: data.file_name,
      s3Key: data.s3_key,
      uploadedAt: data.uploaded_at ?? new Date().toISOString(),
      uploadedBy: data.uploaded_by,
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
    const payload = {
      account_id: params.accountId,
      plan_key: params.planKey,
      status: params.status,
      stripe_customer_id: params.stripeCustomerId,
      stripe_subscription_id: params.stripeSubscriptionId,
      current_period_start: params.currentPeriodStart
        ? new Date(params.currentPeriodStart).toISOString()
        : null,
      current_period_end: params.currentPeriodEnd
        ? new Date(params.currentPeriodEnd).toISOString()
        : null,
    };
    const { error } = await this.client
      .from('subscriptions')
      .upsert(payload, { onConflict: 'account_id' });
    raise(error, 'Failed to update subscription');
  }
}
