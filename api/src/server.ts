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
import { SupabaseService } from './services/supabase';

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

  const supabase = new SupabaseService();
  const stripe = new StripeService();
  const runner = new RunnerService();

  app.register(buildAuthPlugin(supabase));

  registerCustomerRoutes(app, { supabase, runner });
  registerAdminRoutes(app, { supabase, runner });
  registerBillingRoutes(app, { supabase, stripe });
  registerWebhookRoutes(app, { supabase, stripe });
  registerInternalRoutes(app, { supabase });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
};
