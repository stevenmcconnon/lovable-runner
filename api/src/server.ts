import fastify, { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyRawBody from 'fastify-raw-body';
import { buildAuthPlugin } from './auth';
import { registerAdminRoutes } from './routes/admin';
import { registerAuthRoutes } from './routes/auth';
import { registerBillingRoutes } from './routes/billing';
import { registerCustomerRoutes } from './routes/customer';
import { registerInternalRoutes } from './routes/internal';
import { registerLaunchRoutes } from './routes/launch';
import { registerWebhookRoutes } from './routes/webhooks';
import { RunnerService } from './services/runner';
import { StripeService } from './services/stripe';
import { DatabaseService } from './services/database';
import { config } from './env';
import { registerSiteBuilderRoutes } from './routes/site-builder';

export const buildServer = (): FastifyInstance => {
  const app = fastify({
    logger: true,
  });

  const allowedMethods = 'GET,POST,PUT,DELETE,OPTIONS';
  const allowedHeaders = 'Content-Type, Authorization, Stripe-Signature';
  const defaultOrigin = config.frontend.origin;

  app.addHook('onSend', async (request, reply, payload) => {
    const origin = defaultOrigin || request.headers.origin;
    if (origin) {
      reply.header('Access-Control-Allow-Origin', origin);
      const existingVary = reply.getHeader('Vary');
      reply.header('Vary', existingVary ? `${existingVary}, Origin` : 'Origin');
      reply.header('Access-Control-Allow-Credentials', 'true');
    }
    reply.header(
      'Access-Control-Allow-Headers',
      request.headers['access-control-request-headers'] || allowedHeaders
    );
    reply.header('Access-Control-Allow-Methods', allowedMethods);
    return payload;
  });

  app.options('*', async (request, reply) => {
    reply.header('Access-Control-Max-Age', '86400');
    reply.code(204).send();
  });

  app.register(multipart);
  app.register(fastifyRawBody, {
    field: 'rawBody',
    global: false,
    routes: ['/webhooks/stripe'],
  });

  const database = new DatabaseService();
  const stripe = new StripeService();
  const runner = new RunnerService();

  app.register(buildAuthPlugin(database));
  app.register(async (instance) => {
    registerCustomerRoutes(instance, { db: database, runner });
    registerAdminRoutes(instance, { db: database, runner });
    registerBillingRoutes(instance, { db: database, stripe });
    registerWebhookRoutes(instance, { db: database, stripe });
    registerInternalRoutes(instance, { db: database });
    registerLaunchRoutes(instance, { db: database, runner });
    registerAuthRoutes(instance);
    registerSiteBuilderRoutes(instance, { db: database, runner });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
};
