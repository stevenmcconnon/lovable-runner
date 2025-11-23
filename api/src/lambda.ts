import awsLambdaFastify from '@fastify/aws-lambda';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { buildServer } from './server';

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

export const handler = async (event: APIGatewayProxyEventV2, context: Context) => {
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
