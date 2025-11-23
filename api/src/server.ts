import fastify, { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyRawBody from 'fastify-raw-body';
import { buildAuthPlugin } from './auth';
import { registerAdminRoutes } from './routes/admin';
import { registerBillingRoutes } from './routes/billing';
import { registerCustomerRoutes } from './routes/customer';
import { registerInternalRoutes } from './routes/internal';
import { registerWebhookRoutes } from './routes/webhooks';
import { RunnerService } from './services/runner';
import { StripeService } from './services/stripe';
import { DatabaseService } from './services/database';

export const buildServer = (): FastifyInstance => {
  const app = fastify({
    logger: true,
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
  });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
};
