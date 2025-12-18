import awsLambdaFastify from '@fastify/aws-lambda';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { buildServer } from './server';
import {
  handleDomainRefreshJob,
  handleEditRequestJob,
  handleNotificationJobBatch,
  handleSiteLaunchJob,
  handleSiteUpdateJob,
  handleAnalyticsRollupJob,
  handleDomainJobBatch,
} from './worker';

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
  if (event?.action === 'RUN_SITE_LAUNCH') {
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
  }
  if (event?.action === 'RUN_SITE_UPDATE') {
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
  }
  if (event?.action === 'RUN_EDIT_REQUEST') {
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
  }
  if (event?.action === 'RUN_DOMAIN_HTTPS_REFRESH') {
    const result = await handleDomainRefreshJob({
      limit: event.limit,
      domain: event.domain,
    });
    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  }
  if (event?.action === 'RUN_NOTIFICATION_JOBS') {
    const result = await handleNotificationJobBatch({
      limit: event.limit,
      dryRun: event.dryRun,
    });
    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  }
  if (event?.action === 'RUN_ANALYTICS_ROLLUP') {
    const result = await handleAnalyticsRollupJob({
      date: event.date,
      start: event.start,
      end: event.end,
    });
    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  }
  if (event?.action === 'RUN_DOMAIN_JOBS') {
    const result = await handleDomainJobBatch({
      limit: event.limit,
    });
    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  }
  throw new Error(`Unsupported action: ${event?.action ?? 'unknown'}`);
};

const isSqsEvent = (event: any) => Array.isArray(event?.Records) && event.Records.every((record) => record.eventSource?.includes('sqs') || record.eventSourceARN?.includes('sqs'));

export const handler = async (event: APIGatewayProxyEventV2 | any, context: Context) => {
  if (isSqsEvent(event)) {
    for (const record of event.Records) {
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
