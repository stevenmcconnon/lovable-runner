/* eslint-disable import/no-extraneous-dependencies */
const { test } = require('node:test');
const assert = require('node:assert');
const fastify = require('fastify');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'test';
process.env.COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || 'pool';
process.env.COGNITO_USER_POOL_REGION = process.env.COGNITO_USER_POOL_REGION || 'us-east-1';
process.env.COGNITO_APP_CLIENT_ID = process.env.COGNITO_APP_CLIENT_ID || 'client';
process.env.COGNITO_DOMAIN = process.env.COGNITO_DOMAIN || 'example.auth.us-east-1.amazoncognito.com';
process.env.TEMPLATE_UPLOAD_BUCKET = process.env.TEMPLATE_UPLOAD_BUCKET || 'templates';
process.env.LOVABLE_DEPLOY_BUCKET = process.env.LOVABLE_DEPLOY_BUCKET || 'preview-bucket';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.PREVIEW_DOMAIN = process.env.PREVIEW_DOMAIN || 'preview.ai-sitemaker.com';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/lovable_runner_test';

const { registerDomainRoutes } = require('../../dist/routes/domains');

const buildMockDeps = () => {
  const noop = async () => ({});
  const db = {
    listDomainsForAccount: async () => [],
    getDomainByName: async () => null,
    createDomainOrder: noop,
    updateDomainOrder: noop,
    upsertSiteDomain: noop,
    updateSiteDomain: noop,
    listSiteGenerations: async () => [],
    listSiteGenerationsAdmin: async () => [],
    listDomainsForSlug: async () => [],
  };
  const domainService = {
    search: async () => [],
    supportsManagedRegistrar: () => false,
    lookupBasePrice: async () => 1500,
    purchaseDomain: noop,
    buildDnsConfig: () => ({ domain: 'example.com', slug: 'example', verificationToken: 'token', records: [] }),
    wireDomain: noop,
    getProviderCode: () => 'test',
  };
  const domainManager = {
    prepareDnsConfig: async (params) => ({ dnsConfig: params.dnsConfig, metadata: { canonicalMode: 'apex', canonicalHost: params.domain, certificate: { arn: 'arn', status: 'PENDING_VALIDATION', validationRecords: [] } } }),
    persistEdgeMetadata: noop,
    refreshHttps: async () => null,
  };
  const domainOrderService = {
    createPendingOrder: async (params) => ({ id: 'order', ...params }),
    attachStripeSession: noop,
    fulfillOrders: noop,
  };
  const stripe = {
    createDomainCheckoutSession: async () => ({ checkoutUrl: 'https://example.com', sessionId: 'sess' }),
  };
  return { db, domainService, domainOrderService, domainManager, stripe };
};

const buildServer = () => {
  const app = fastify();
  app.decorate('authenticateUser', async (request) => {
    if (request.headers.authorization === 'Machine') {
      request.auth = { type: 'machine', roles: ['super-admin'] };
      return;
    }
    if (request.headers.authorization) {
      request.auth = {
        type: 'user',
        roles: ['customer'],
        profile: { accountId: 'acct-user', id: 'user-1', email: 'user@example.com' },
      };
      return;
    }
    const error = new Error('Unauthorized');
    // @ts-ignore
    error.statusCode = 401;
    throw error;
  });
  app.decorate('authenticateMachine', async () => {
    const error = new Error('Unauthorized');
    // @ts-ignore
    error.statusCode = 401;
    throw error;
  });
  app.decorate('requireRoles', async () => {});
  registerDomainRoutes(app, { ...buildMockDeps(), notifications: undefined });
  return app;
};

test('direct domain purchase is forbidden for customers', async () => {
  const app = buildServer();
  const response = await app.inject({
    method: 'POST',
    url: '/domains/purchase',
    headers: { authorization: 'Bearer token' },
    payload: {
      domain: 'example.com',
      slug: 'site',
      contact: { email: 'user@example.com', phone: '+123456789', address1: '123 St', city: 'City', state: 'CA', postalCode: '94000', country: 'US' },
    },
  });
  assert.strictEqual(response.statusCode, 403);
  await app.close();
});

test('direct domain purchase endpoint is disabled even for machine callers', async () => {
  const app = buildServer();
  const response = await app.inject({
    method: 'POST',
    url: '/domains/purchase',
    headers: { authorization: 'Machine' },
    payload: {
      domain: 'example.com',
      slug: 'site',
      contact: { email: 'user@example.com', phone: '+123456789', address1: '123 St', city: 'City', state: 'CA', postalCode: '94000', country: 'US' },
    },
  });
  assert.strictEqual(response.statusCode, 410);
  await app.close();
});
