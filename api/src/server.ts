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
import { registerDomainRoutes } from './routes/domains';
import { DomainService } from './services/domain';
import { registerPublishingRoutes } from './routes/publishing';
import { registerUsageRoutes } from './routes/usage';
import { registerTrackingRoutes } from './routes/tracking';
import { DomainOrderService } from './services/domain-order';
import { DomainEdgeService } from './services/domain-edge';
import { DomainManager } from './services/domain-manager';
import { registerSeoRoutes } from './routes/seo';
import { SiteSeoService } from './services/site-seo';
import { NotificationService } from './services/notifications';
import { registerAnalyticsRoutes } from './routes/analytics';
import { DomainJobService } from './services/domain-job';
import { DomainJobDispatcher } from './services/domain-job-dispatcher';
import { registerCoreRoutes } from './routes/core';
import { registerTemplateRoutes } from './routes/templates';
import { registerAccountRoutes } from './routes/accounts';
import { randomUUID } from 'node:crypto';
import { recordApiRequestMetric } from './services/metrics';
import { TelemetryService } from './services/telemetry';

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

  app.addHook('onRequest', async (request) => {
    if (!request.id) {
      request.id = randomUUID();
    }
    (request as any).startTimeNs = process.hrtime.bigint();
    request.log.info(
      {
        requestId: request.id,
        method: request.method,
        url: request.url,
      },
      'request received'
    );
  });

  app.addHook('onResponse', async (request, reply) => {
    const start = (request as any).startTimeNs;
    const durationMs = start ? Number(process.hrtime.bigint() - start) / 1_000_000 : undefined;
    request.log.info(
      {
        requestId: request.id,
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        durationMs,
      },
      'request completed'
    );
    try {
      const slugCandidate =
        (request.params as any)?.slug ||
        (request.query as any)?.slug ||
        (request.body as any)?.slug ||
        null;
      recordApiRequestMetric({
        route:
          (request.routerPath as string | undefined) ||
          (request.routeOptions as any)?.url ||
          request.url,
        method: request.method,
        statusCode: reply.statusCode,
        durationMs,
        accountId: request.auth?.profile?.accountId ?? null,
        slug: typeof slugCandidate === 'string' ? slugCandidate : null,
      });
    } catch (error) {
      request.log.warn({ err: error }, 'failed to emit request metric');
    }
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
  const domainService = new DomainService({
    namecheap: config.domainRegistrar?.namecheap ?? null,
    pricing: {
      defaultBasePriceCents: config.domains?.defaultBasePriceCents,
    },
  });
  const domainEdgeService = new DomainEdgeService({
    certificateRegion: config.domains.edge.certificateRegion,
    canonicalDefault: config.domains.edge.canonicalDefault,
    distributionId: config.domains.edge.distributionId,
  });
  const notificationService = new NotificationService({ db: database });
  const telemetryService = new TelemetryService({ db: database });
  const domainJobDispatcher =
    config.queues.domainJobs || config.queues.domainJobTopicArn
      ? new DomainJobDispatcher({
          queueUrl: config.queues.domainJobs || undefined,
          topicArn: config.queues.domainJobTopicArn || undefined,
          region: config.awsRegion,
        })
      : undefined;
  const domainJobService = new DomainJobService(database, {
    dispatcher: domainJobDispatcher,
  });
  const domainManager = new DomainManager({
    db: database,
    edge: domainEdgeService,
    notifications: notificationService,
  });
  const domainOrderService = new DomainOrderService({
    db: database,
    domainService,
    domainJobs: domainJobService,
  });
  const siteSeoService = new SiteSeoService({ db: database });

  app.register(buildAuthPlugin(database));
  app.register(async (instance) => {
    registerCustomerRoutes(instance, { db: database, runner });
    registerAdminRoutes(instance, { db: database, runner, telemetry: telemetryService });
    registerBillingRoutes(instance, { db: database, stripe });
    registerDomainRoutes(instance, {
      db: database,
      domainService,
      domainOrderService,
      domainManager,
      stripe,
      notifications: notificationService,
      runner,
      domainJobs: domainJobService,
    });
    registerPublishingRoutes(instance, { db: database, notifications: notificationService });
    registerUsageRoutes(instance, { db: database });
    registerAnalyticsRoutes(instance, { db: database });
    registerWebhookRoutes(instance, { db: database, stripe, domainOrderService });
    registerInternalRoutes(instance, { db: database, domainManager });
    registerLaunchRoutes(instance, { db: database, runner });
    registerAuthRoutes(instance, { db: database });
    registerSiteBuilderRoutes(instance, { db: database, runner });
    registerTrackingRoutes(instance);
    registerSeoRoutes(instance, { db: database, seo: siteSeoService });
    registerCoreRoutes(instance, { db: database });
    registerTemplateRoutes(instance);
    registerAccountRoutes(instance, { db: database });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
};
