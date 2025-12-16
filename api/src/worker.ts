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

const db = new DatabaseService();
const domainEdge = new DomainEdgeService({
  certificateRegion: config.domains.edge.certificateRegion,
  canonicalDefault: config.domains.edge.canonicalDefault,
  distributionId: config.domains.edge.distributionId,
});
const domainManager = new DomainManager({ db, edge: domainEdge });
const defaultRefreshLimit = Number(process.env.DOMAIN_REFRESH_LIMIT || 25);

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
    return {
      requestId,
      ...result,
      status: 'completed',
    };
  } catch (error: any) {
    await updateStatus(requestId, 'failed', {
      errorMessage: error?.message || 'Generation failed',
    });
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
    throw error;
  }
};
