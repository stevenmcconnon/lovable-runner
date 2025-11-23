import awsLambdaFastify from '@fastify/aws-lambda';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { buildServer } from './server';

let proxy: ReturnType<typeof awsLambdaFastify>;

export const handler = async (event: APIGatewayProxyEventV2, context: Context) => {
  if (!proxy) {
    const app = buildServer();
    await app.ready();
    proxy = awsLambdaFastify(app);
  }
  return (proxy as any)(event, context);
};
