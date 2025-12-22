import path from 'node:path';
import { config } from './env';

const resolveRootModule = (relativePath: string) => {
  try {
    return require(path.join(process.cwd(), relativePath));
  } catch (error) {
    // Fallback to resolving relative to the compiled file location (useful in tests)
    return require(path.join(__dirname, '..', relativePath));
  }
};

type RunLaunch = (params: {
  url?: string;
  description?: string;
  businessDetails?: BusinessDetailsInput;
  requestId?: string;
  testMode?: boolean;
  onProgress?: (stage: string) => Promise<void> | void;
  slug?: string;
  prefix?: string;
  bucket?: string;
}) => Promise<{
  slug: string;
  bucket: string;
  prefix: string;
  publicUrl: string;
  builtFromProject?: boolean;
  gitArchive?: {
    repoUrl: string;
    branch: string;
    path: string;
    commit?: string;
    committed: boolean;
    commitMessage: string;
  } | null;
  requestId?: string;
}>;

type RecordStatus = (args: { requestId: string; status: string; result?: any; error?: any }) => Promise<void>;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runLaunch }: { runLaunch: RunLaunch } = resolveRootModule('src/launch');
const { updateSite }: { updateSite: UpdateSiteFn } = resolveRootModule('src/site-edit');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { recordLaunchStatus }: { recordLaunchStatus: RecordStatus } = resolveRootModule('src/launch-tracker');
import { DatabaseService } from './services/database';
import { DomainEdgeService } from './services/domain-edge';
import { DomainManager } from './services/domain-manager';
import { domainHelpers } from './services/domain';
import { BusinessDetailsInput, DomainRecord } from './types';
import { NotificationService } from './services/notifications';
import { DomainJobService } from './services/domain-job';
import { DomainJobRunner } from './services/domain-job-runner';
import { DomainJobDispatcher } from './services/domain-job-dispatcher';

const db = new DatabaseService();
const domainEdge = new DomainEdgeService({
  certificateRegion: config.domains.edge.certificateRegion,
  canonicalDefault: config.domains.edge.canonicalDefault,
  distributionId: config.domains.edge.distributionId,
});
const notificationService = new NotificationService({ db });
const domainManager = new DomainManager({ db, edge: domainEdge, notifications: notificationService });
const domainJobDispatcher =
  config.queues.domainJobs || config.queues.domainJobTopicArn
    ? new DomainJobDispatcher({
        queueUrl: config.queues.domainJobs || undefined,
        topicArn: config.queues.domainJobTopicArn || undefined,
        region: config.awsRegion,
      })
    : undefined;
const domainJobs = new DomainJobService(db, { dispatcher: domainJobDispatcher });
const domainJobRunner = new DomainJobRunner({ db, manager: domainManager, jobs: domainJobs });
const defaultRefreshLimit = Number(process.env.DOMAIN_REFRESH_LIMIT || 25);
const defaultRateLimitRetentionMinutes = Number(process.env.RATE_LIMIT_RETENTION_MINUTES || 1440);
const defaultAuditLogRetentionDays = Number(process.env.AUDIT_LOG_RETENTION_DAYS || 30);
const { runNotificationBatch, runNotificationJob } = resolveRootModule('src/notification-worker.js') as {
  runNotificationBatch: (params: { limit?: number; dryRun?: boolean; logger?: Console }) => Promise<any>;
  runNotificationJob: (params: { jobId: string; dryRun?: boolean; logger?: Console }) => Promise<any>;
};
const {
  rollupForDate,
  rollupDateRange,
  rollupPreviousDay,
} = resolveRootModule('src/analytics-rollup.js');
const { ingestAnalyticsEvent } = resolveRootModule('src/analytics.js') as {
  ingestAnalyticsEvent: (params: { slug: string; type: string; metadata?: Record<string, any> }) => Promise<void>;
};

const defaultUsageLimit = () => config.limits.trialEditLimit + config.limits.signedInBonusEdits;

const resolveUsageLimit = async (accountId?: string | null) => {
  if (!accountId) return defaultUsageLimit();
  const subscription = await db.getSubscription(accountId);
  return subscription?.monthlyEditLimit ?? defaultUsageLimit();
};

type SiteLaunchEvent = {
  requestId: string;
  url?: string;
  description?: string;
  businessDetails?: BusinessDetailsInput;
  testMode?: boolean;
  slug?: string;
  prefix?: string;
  bucket?: string;
};

type UpdateSiteFn = (params: {
  slug: string;
  patch?: any;
  site?: any;
  regenerateImages?: boolean;
  requestId?: string;
  description?: string;
  sourceUrl?: string;
}) => Promise<{
  slug: string;
  bucket: string;
  prefix: string;
  publicUrl: string;
}>;

type SiteUpdateEvent = {
  requestId: string;
  slug: string;
  patch?: any;
  site?: any;
  regenerateImages?: boolean;
  description?: string;
  sourceUrl?: string;
};

type EditJobEvent = {
  jobId: string;
  editRequestId?: string;
  accountId?: string;
  description?: string;
  siteId?: string | null;
  businessDetails?: BusinessDetailsInput | null;
};

type DomainRefreshEvent = {
  limit?: number;
  domain?: string;
};

type NotificationJobEvent = {
  limit?: number;
  dryRun?: boolean;
};

type AnalyticsRollupEvent = {
  date?: string;
  start?: string;
  end?: string;
};

type DomainJobMessageEvent = {
  jobId?: string;
};

type AnalyticsIngestEvent = {
  slug: string;
  type: string;
  metadata?: Record<string, any>;
};

const updateStatus = async (requestId: string, status: string, extras: Record<string, unknown> = {}) => {
  await db.updateSiteGeneration(requestId, {
    status: status as any,
    ...extras,
  });
  await recordLaunchStatus({ requestId, status, result: extras });
};

const markEditJobRunning = async (params: { jobId: string; editRequestId?: string }) => {
  try {
    await db.updateJob(params.jobId, {
      status: 'running',
      errorMessage: null,
    });
    if (params.editRequestId) {
      await db.updateEditRequestStatus(params.editRequestId, 'in_progress', params.jobId);
    }
  } catch (error: any) {
    console.warn('[runner] Failed to mark edit job running', {
      jobId: params.jobId,
      err: error?.message,
    });
  }
};

const markEditJobCompleted = async (params: {
  jobId: string;
  editRequestId?: string;
  s3Key?: string | null;
  previewUrl?: string | null;
  lovableProjectId?: string | null;
}) => {
  try {
    await db.updateJob(params.jobId, {
      status: 'completed',
      s3Key: params.s3Key ?? undefined,
      previewUrl: params.previewUrl ?? undefined,
      lovableProjectId: params.lovableProjectId ?? undefined,
    });
    if (params.editRequestId) {
      await db.updateEditRequestStatus(params.editRequestId, 'completed', params.jobId);
    }
  } catch (error: any) {
    console.warn('[runner] Failed to mark edit job completed', {
      jobId: params.jobId,
      err: error?.message,
    });
  }
};

const markEditJobFailed = async (params: { jobId: string; editRequestId?: string; errorMessage?: string }) => {
  try {
    await db.updateJob(params.jobId, {
      status: 'failed',
      errorMessage: params.errorMessage ?? 'Generation failed',
    });
    if (params.editRequestId) {
      await db.updateEditRequestStatus(params.editRequestId, 'rejected', params.jobId);
    }
  } catch (error: any) {
    console.warn('[runner] Failed to mark edit job failed', {
      jobId: params.jobId,
      err: error?.message,
    });
  }
};

const summarizeDomain = (record: DomainRecord | null) => ({
  domain: record?.domain ?? null,
  httpsStatus: record?.httpsStatus ?? null,
  certificateStatus: record?.certificateStatus ?? null,
  edgeStatus: record?.edgeStatus ?? null,
  routingError: record?.routingError ?? null,
});

export const handleSiteLaunchJob = async (event: SiteLaunchEvent) => {
  if (!event?.requestId) throw new Error('requestId is required');
  const requestId = event.requestId;
  const referenceUrl = event.url;
  const businessDetails = event.businessDetails;
  const description = event.description || '';
  const testMode = Boolean(event.testMode);
  const reportStage = async (stage: string) => {
    await updateStatus(requestId, stage);
  };
  await reportStage('running');
  try {
    const result = await runLaunch({
      url: referenceUrl,
      description,
      businessDetails,
      requestId,
      testMode,
      onProgress: reportStage,
      slug: event.slug,
      prefix: event.prefix,
      bucket: event.bucket,
    });
    await updateStatus(requestId, 'completed', {
      bucket: result.bucket,
      prefix: result.prefix,
      slug: result.slug,
      publicUrl: result.publicUrl,
      builtFromProject: result.builtFromProject,
      gitArchive: result.gitArchive,
    });
    const reservation = await db.consumeLaunchReservation(requestId);
    if (reservation) {
      const limit = reservation.limitSnapshot ?? (await resolveUsageLimit(reservation.accountId));
      await db.incrementUsage(reservation.accountId, limit, reservation.cost).catch((error) =>
        console.warn('[worker] Failed to consume launch reservation', {
          requestId,
          err: error?.message,
        })
      );
    }
    return {
      requestId,
      ...result,
      status: 'completed',
    };
  } catch (error: any) {
    await updateStatus(requestId, 'failed', {
      errorMessage: error?.message || 'Generation failed',
    });
    await db.releaseLaunchReservation(requestId, error?.message).catch((releaseError) =>
      console.warn('[worker] Failed to release launch reservation', {
        requestId,
        err: (releaseError as any)?.message,
      })
    );
    throw error;
  }
};

export const handleDomainRefreshJob = async (event: DomainRefreshEvent = {}) => {
  const limit = Math.max(1, Math.min(Number(event.limit) || defaultRefreshLimit, 500));
  let targets: DomainRecord[] = [];
  if (event.domain) {
    const sanitized = domainHelpers.sanitizeDomainInput(event.domain);
    if (!sanitized) {
      throw new Error('Invalid domain for HTTPS refresh');
    }
    const record = await db.getDomainByName(sanitized);
    if (!record) {
      return { processed: 0, refreshed: 0, domains: [], detail: `Domain ${sanitized} not found` };
    }
    targets = [record];
  } else {
    targets = await db.listDomainsNeedingHttpsRefresh(limit);
  }
  if (!targets.length) {
    return { processed: 0, refreshed: 0, domains: [] };
  }
  const rows: Array<
    ReturnType<typeof summarizeDomain> & {
      refreshed: boolean;
    }
  > = [];
  let refreshedCount = 0;
  for (const record of targets) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const updated = await domainManager.refreshHttps(record);
      if (updated) {
        refreshedCount += 1;
      }
      rows.push({
        ...summarizeDomain(updated ?? record),
        refreshed: Boolean(updated),
      });
    } catch (error: any) {
      rows.push({
        ...summarizeDomain(record),
        routingError: error?.message || 'refresh_failed',
        refreshed: false,
      });
    }
  }
  return {
    processed: targets.length,
    refreshed: refreshedCount,
    domains: rows,
  };
};

export const handleNotificationJobBatch = async (event: NotificationJobEvent = {}) => {
  const limit = Math.max(1, Number(event.limit) || Number(process.env.NOTIFICATION_BATCH_LIMIT || 25));
  const result = await runNotificationBatch({
    limit,
    dryRun: Boolean(event.dryRun),
    logger: console,
  });
  return result;
};

export const handleNotificationJob = async (event: NotificationJobEvent & { jobId?: string }) => {
  if (!event?.jobId) throw new Error('jobId is required for notification job processing');
  const result = await runNotificationJob({
    jobId: event.jobId,
    dryRun: Boolean(event.dryRun),
  });
  return result;
};

export const handleAnalyticsRollupJob = async (event: AnalyticsRollupEvent = {}) => {
  if (event.start || event.end) {
    if (!event.start || !event.end) {
      throw new Error('Both start and end must be provided to roll up a date range.');
    }
    const results = await rollupDateRange({
      startDate: event.start,
      endDate: event.end,
    });
    return { days: results.length, results };
  }
  if (event.date) {
    return rollupForDate(event.date);
  }
  return rollupPreviousDay();
};

export const handleSiteUpdateJob = async (event: SiteUpdateEvent) => {
  if (!event?.requestId || !event.slug) throw new Error('requestId and slug are required');
  const requestId = event.requestId;
  await updateStatus(requestId, 'running');
  try {
    const result = await updateSite({
      slug: event.slug,
      patch: event.patch,
      site: event.site,
      regenerateImages: event.regenerateImages,
      requestId,
      description: event.description,
      sourceUrl: event.sourceUrl,
    });
    await updateStatus(requestId, 'completed', {
      bucket: result.bucket,
      prefix: result.prefix,
      slug: result.slug,
      publicUrl: result.publicUrl,
    });
    return {
      requestId,
      ...result,
      status: 'completed',
    };
  } catch (error: any) {
    await updateStatus(requestId, 'failed', {
      errorMessage: error?.message || 'Update failed',
    });
    throw error;
  }
};

export const handleDomainJobMessage = async (event: DomainJobMessageEvent) => {
  if (!event?.jobId) throw new Error('jobId is required for domain job processing');
  const job = await domainJobs.claimJobById(event.jobId);
  if (!job) {
    return { status: 'skipped' };
  }
  const outcome = await domainJobRunner.runJob(job);
  return { status: outcome, jobId: job.id };
};

export const handleRateLimitCleanup = async (event: { maxAgeMinutes?: number } = {}) => {
  const minutes = Math.max(
    1,
    Number(event.maxAgeMinutes) || defaultRateLimitRetentionMinutes
  );
  const deleted = await db.purgeRateLimitCounters(minutes);
  return { deleted, minutes };
};

export const handleAuditLogCleanup = async (event: { retentionDays?: number } = {}) => {
  const days = Math.max(1, Number(event.retentionDays) || defaultAuditLogRetentionDays);
  const deleted = await db.purgeAuditLogs(days);
  return { deleted, days };
};

export const handleAnalyticsIngest = async (event: AnalyticsIngestEvent) => {
  if (!event?.slug || !event?.type) {
    throw new Error('slug and type are required for analytics ingestion');
  }
  await ingestAnalyticsEvent({
    slug: event.slug,
    type: event.type,
    metadata: event.metadata ?? {},
  });
  return { status: 'ok' };
};

export const handleEditRequestJob = async (event: EditJobEvent) => {
  if (!event?.jobId) throw new Error('jobId is required');
  const jobId = event.jobId;
  const referenceUrl = event.siteId && /^https?:/i.test(event.siteId) ? event.siteId : event.siteId || undefined;
  const description = event.description || '';
  const businessDetails = event.businessDetails ?? undefined;
  await markEditJobRunning({
    jobId,
    editRequestId: event.editRequestId,
  });
  try {
    const result = await runLaunch({
      url: referenceUrl,
      description,
      businessDetails,
      requestId: jobId,
    });
    const s3Key = result.prefix ? `${result.prefix}/` : null;
    await markEditJobCompleted({
      jobId,
      editRequestId: event.editRequestId,
      s3Key,
      previewUrl: result.publicUrl,
      lovableProjectId: (result as any).lovableProjectId ?? null,
    });
    const reservation = await db.consumeLaunchReservation(jobId);
    if (reservation) {
      const limit = reservation.limitSnapshot ?? (await resolveUsageLimit(reservation.accountId));
      await db.incrementUsage(reservation.accountId, limit, reservation.cost).catch((error) =>
        console.warn('[worker] Failed to consume edit reservation', {
          jobId,
          err: error?.message,
        })
      );
    }
    return {
      jobId,
      status: 'completed',
      ...result,
      s3Key,
      previewUrl: result.publicUrl,
    };
  } catch (error: any) {
    await markEditJobFailed({
      jobId,
      editRequestId: event.editRequestId,
      errorMessage: error?.message || 'Generation failed',
    });
    await db.releaseLaunchReservation(jobId, error?.message).catch((releaseError) =>
      console.warn('[worker] Failed to release edit reservation', {
        jobId,
        err: (releaseError as any)?.message,
      })
    );
    throw error;
  }
};

export const handleAccountSitesBackfill = async () => {
  console.log('[backfill] account_sites started');
  const processed = await db.backfillAccountSitesFromGenerations();
  console.log('[backfill] account_sites completed', { processed });
  return { processed };
};

export const handleJobEventsBackfill = async () => {
  console.log('[backfill] job_events started');
  const inserted = await db.backfillJobEventsFromGenerations();
  console.log('[backfill] job_events completed', { inserted });
  return { inserted };
};
