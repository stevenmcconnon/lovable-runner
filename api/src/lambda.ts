import awsLambdaFastify from '@fastify/aws-lambda';
import { APIGatewayProxyEventV2, Context, SQSEvent } from 'aws-lambda';
import { buildServer } from './server';
import {
  handleDomainRefreshJob,
  handleEditRequestJob,
  handleNotificationJobBatch,
  handleNotificationJob,
  handleSiteLaunchJob,
  handleSiteUpdateJob,
  handleAnalyticsRollupJob,
  handleDomainJobBatch,
  handleDomainJobMessage,
  handleAnalyticsIngest,
  handleAccountSitesBackfill,
  handleJobEventsBackfill,
  handleRateLimitCleanup,
  handleAuditLogCleanup,
} from './worker';
import { recordWorkerMetric } from './services/metrics';

let proxy: ReturnType<typeof awsLambdaFastify>;

const stripStageFromPath = (evt: APIGatewayProxyEventV2) => {
  const stage = evt?.requestContext?.stage;
  if (!stage || stage === '$default') return;
  const prefix = `/${stage}`;
  const normalizePath = (value?: string | null) => {
    if (!value || value === '/') return value;
    if (value.startsWith(prefix)) {
      const trimmed = value.slice(prefix.length);
      return trimmed ? trimmed : '/';
    }
    return value;
  };

  if (evt.rawPath) {
    evt.rawPath = normalizePath(evt.rawPath) || '/';
  }
  if (evt.requestContext?.http?.path) {
    evt.requestContext.http.path = normalizePath(evt.requestContext.http.path) || '/';
  }
};

const handleActionEvent = async (event: any) => {
  const runWithMetrics = async <T>(action: string, fn: () => Promise<T>): Promise<T> => {
    const start = Date.now();
    try {
      const result = await fn();
      recordWorkerMetric({
        action,
        durationMs: Date.now() - start,
        success: true,
      });
      return result;
    } catch (error: any) {
      recordWorkerMetric({
        action,
        durationMs: Date.now() - start,
        success: false,
        errorType: error?.name || 'Error',
      });
      throw error;
    }
  };
  if (event?.action === 'RUN_SITE_LAUNCH') {
    return runWithMetrics('RUN_SITE_LAUNCH', async () => {
      const result = await handleSiteLaunchJob({
        requestId: event.requestId,
        url: event.url,
        description: event.description,
        businessDetails: event.businessDetails,
        testMode: event.testMode,
      });
      return {
        statusCode: 200,
        body: JSON.stringify(result),
      };
    });
  }
  if (event?.action === 'RUN_SITE_UPDATE') {
    return runWithMetrics('RUN_SITE_UPDATE', async () => {
      const result = await handleSiteUpdateJob({
        requestId: event.requestId,
        slug: event.slug,
        patch: event.patch,
        site: event.site,
        regenerateImages: event.regenerateImages,
        description: event.description,
        sourceUrl: event.sourceUrl,
      });
      return {
        statusCode: 200,
        body: JSON.stringify(result),
      };
    });
  }
  if (event?.action === 'RUN_EDIT_REQUEST') {
    return runWithMetrics('RUN_EDIT_REQUEST', async () => {
      const result = await handleEditRequestJob({
        jobId: event.jobId,
        editRequestId: event.editRequestId,
        accountId: event.accountId,
        description: event.description,
        siteId: event.siteId,
        businessDetails: event.businessDetails,
      });
      return {
        statusCode: 200,
        body: JSON.stringify(result),
      };
    });
  }
  if (event?.action === 'RUN_DOMAIN_HTTPS_REFRESH') {
    return runWithMetrics('RUN_DOMAIN_HTTPS_REFRESH', async () => {
      const result = await handleDomainRefreshJob({
        limit: event.limit,
        domain: event.domain,
      });
      return {
        statusCode: 200,
        body: JSON.stringify(result),
      };
    });
  }
  if (event?.action === 'RUN_NOTIFICATION_JOBS') {
    return runWithMetrics('RUN_NOTIFICATION_JOBS', async () => {
      const result = await handleNotificationJobBatch({
        limit: event.limit,
        dryRun: event.dryRun,
      });
      return {
        statusCode: 200,
        body: JSON.stringify(result),
      };
    });
  }
  if (event?.action === 'RUN_NOTIFICATION_JOB') {
    return runWithMetrics('RUN_NOTIFICATION_JOB', async () => {
      const result = await handleNotificationJob({
        jobId: event.jobId,
        dryRun: event.dryRun,
      });
      return {
        statusCode: 200,
        body: JSON.stringify(result),
      };
    });
  }
  if (event?.action === 'RUN_ANALYTICS_ROLLUP') {
    return runWithMetrics('RUN_ANALYTICS_ROLLUP', async () => {
      const result = await handleAnalyticsRollupJob({
        date: event.date,
        start: event.start,
        end: event.end,
      });
      return {
        statusCode: 200,
        body: JSON.stringify(result),
      };
    });
  }
  if (event?.action === 'RUN_DOMAIN_JOBS') {
    return runWithMetrics('RUN_DOMAIN_JOBS', async () => {
      const result = await handleDomainJobBatch({
        limit: event.limit,
      });
      return {
        statusCode: 200,
        body: JSON.stringify(result),
      };
    });
  }
  if (event?.action === 'RUN_DOMAIN_JOB') {
    return runWithMetrics('RUN_DOMAIN_JOB', async () => {
      const result = await handleDomainJobMessage({
        jobId: event.jobId,
      });
      return {
        statusCode: 200,
        body: JSON.stringify(result),
      };
    });
  }
  if (event?.action === 'RUN_RATE_LIMIT_PURGE') {
    return runWithMetrics('RUN_RATE_LIMIT_PURGE', async () => {
      const result = await handleRateLimitCleanup({
        maxAgeMinutes: event.maxAgeMinutes,
      });
      return {
        statusCode: 200,
        body: JSON.stringify(result),
      };
    });
  }
  if (event?.action === 'RUN_AUDIT_LOG_CLEANUP') {
    return runWithMetrics('RUN_AUDIT_LOG_CLEANUP', async () => {
      const result = await handleAuditLogCleanup({
        retentionDays: event.retentionDays,
      });
      return {
        statusCode: 200,
        body: JSON.stringify(result),
      };
    });
  }
  if (event?.action === 'RUN_ACCOUNT_SITES_BACKFILL') {
    return runWithMetrics('RUN_ACCOUNT_SITES_BACKFILL', async () => {
      const result = await handleAccountSitesBackfill();
      return {
        statusCode: 200,
        body: JSON.stringify(result),
      };
    });
  }
  if (event?.action === 'RUN_JOB_EVENTS_BACKFILL') {
    return runWithMetrics('RUN_JOB_EVENTS_BACKFILL', async () => {
      const result = await handleJobEventsBackfill();
      return {
        statusCode: 200,
        body: JSON.stringify(result),
      };
    });
  }
  if (event?.action === 'PROCESS_ANALYTICS_EVENT') {
    return runWithMetrics('PROCESS_ANALYTICS_EVENT', async () => {
      const payload = event.payload ?? {
        slug: event.slug,
        type: event.type,
        metadata: event.metadata,
      };
      await handleAnalyticsIngest(payload);
      return {
        statusCode: 200,
        body: JSON.stringify({ status: 'ok' }),
      };
    });
  }
  throw new Error(`Unsupported action: ${event?.action ?? 'unknown'}`);
};

const isSqsEvent = (event: any): event is SQSEvent =>
  Array.isArray(event?.Records) &&
  event.Records.every(
    (record: { eventSource?: string | null; eventSourceARN?: string | null }) =>
      record.eventSource?.includes('sqs') || record.eventSourceARN?.includes('sqs')
  );

export const handler = async (event: APIGatewayProxyEventV2 | any, context: Context) => {
  if (isSqsEvent(event)) {
    const sqsRecords: SQSEvent['Records'] = event.Records ?? [];
    for (const record of sqsRecords) {
      if (!record?.body) continue;
      let payload: any;
      try {
        payload = JSON.parse(record.body);
      } catch (error) {
        console.error('[lambda] Failed to parse SQS payload', { err: (error as Error)?.message });
        throw error;
      }
      await handleActionEvent(payload);
    }
    return;
  }
  if (event && typeof event === 'object' && 'action' in event) {
    return handleActionEvent(event);
  }
  if (!proxy) {
    const app = buildServer();
    proxy = awsLambdaFastify(app);
    await app.ready();
  }
  stripStageFromPath(event);
  // eslint-disable-next-line no-console
  console.log(
    'API request',
    JSON.stringify({
      method: event.requestContext?.http?.method,
      rawPath: event.rawPath,
      httpPath: event.requestContext?.http?.path,
      stage: event.requestContext?.stage,
      rawQueryString: event.rawQueryString,
    })
  );
  return (proxy as any)(event, context);
};
