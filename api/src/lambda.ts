import awsLambdaFastify from '@fastify/aws-lambda';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { buildServer } from './server';
import { handleSiteLaunchJob } from './worker';

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
  throw new Error(`Unsupported action: ${event?.action ?? 'unknown'}`);
};

export const handler = async (event: APIGatewayProxyEventV2 | any, context: Context) => {
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
