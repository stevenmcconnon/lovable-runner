/* eslint-disable import/no-extraneous-dependencies */
// Integration-ish tests for /launch quota + slug behavior using Fastify inject.
const { test } = require('node:test');
const assert = require('node:assert');
const fastify = require('fastify');
const { S3Client } = require('@aws-sdk/client-s3');

// Provide the env required by api/src/env.ts before importing route logic.
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'test';
process.env.COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || 'pool';
process.env.COGNITO_USER_POOL_REGION = process.env.COGNITO_USER_POOL_REGION || 'us-east-1';
process.env.COGNITO_APP_CLIENT_ID = process.env.COGNITO_APP_CLIENT_ID || 'client';
process.env.COGNITO_DOMAIN = process.env.COGNITO_DOMAIN || 'example.auth.us-east-1.amazoncognito.com';
process.env.TEMPLATE_UPLOAD_BUCKET = process.env.TEMPLATE_UPLOAD_BUCKET || 'templates';
process.env.LOVABLE_DEPLOY_BUCKET = process.env.LOVABLE_DEPLOY_BUCKET || 'preview-bucket';
process.env.DEFAULT_TRIAL_EDIT_LIMIT = process.env.DEFAULT_TRIAL_EDIT_LIMIT || '1';
process.env.SIGNED_IN_BONUS_EDITS = process.env.SIGNED_IN_BONUS_EDITS || '1';
process.env.ANONYMOUS_LAUNCH_LIMIT = process.env.ANONYMOUS_LAUNCH_LIMIT || '1';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.PREVIEW_DOMAIN = process.env.PREVIEW_DOMAIN || 'preview.ai-sitemaker.com';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/lovable_runner_test';
process.env.LAUNCH_RATE_LIMIT_DISABLED = 'true';

// Prevent real AWS calls from the S3 client used in ensureUniqueSlug.
S3Client.prototype.send = async () => ({ Contents: [] });

const { registerLaunchRoutes } = require('../../dist/routes/launch');

const buildMockServer = (dbImpl) => {
  const app = fastify();
  // Auth stubs: simulate optional user auth and anonymous fallback.
  app.decorate('authenticateUser', async (request) => {
    const token = request.headers.authorization;
    if (token) {
      request.auth = {
        type: 'user',
        roles: ['customer'],
        profile: { accountId: 'acct-user', id: 'user-1' },
      };
      return;
    }
    const error = new Error('unauthorized');
    // @ts-ignore
    error.statusCode = 401;
    throw error;
  });
  app.decorate('authenticateMachine', async () => {
    const error = new Error('unauthorized');
    // @ts-ignore
    error.statusCode = 401;
    throw error;
  });
  app.decorate('requireRoles', async (request, _reply, roles) => {
    if (!request.auth?.roles?.some((role) => roles.includes(role))) {
      const error = new Error('Forbidden');
      // @ts-ignore
      error.statusCode = 403;
      throw error;
    }
  });

  registerLaunchRoutes(app, {
    db: dbImpl,
    runner: {
      runLaunchDirect: async (params) => {
        app.log.info({ params }, 'mock runner called');
        return { status: 'queued', requestId: params.requestId };
      },
    },
  });
  return app;
};

test('accepts signed-in launch with quota remaining and returns slug', async () => {
  const state = {
    usage: { monthlyEditLimit: 1, editsUsedThisPeriod: 0, remainingEdits: 1 },
    incremented: false,
    recorded: null,
  };
  const db = {
    getSubscription: async () => null,
    getUsage: async () => state.usage,
    buildUsageLimits: () => ({ planKey: 'trial', monthlyEditLimit: 1, freeSiteLimit: 1 }),
    listSiteGenerations: async () => [],
    createSiteGenerationRequest: async (payload) => {
      state.recorded = payload;
      return payload;
    },
    touchSiteGenerationStage: async () => {},
    updateSiteGeneration: async () => {},
    incrementUsage: async () => {
      state.incremented = true;
    },
  };
  const app = buildMockServer(db);
  const response = await app.inject({
    method: 'POST',
    url: '/launch',
    payload: { url: 'https://example.com' },
    headers: { authorization: 'Bearer token' },
  });
  assert.strictEqual(response.statusCode, 202);
  const body = response.json();
  assert.ok(body.slug, 'slug should be present');
  assert.ok(body.publicUrl?.startsWith('https://preview.ai-sitemaker.com/'));
  assert.ok(state.incremented, 'usage should be incremented for anon launch');
  await app.close();
});

test('rejects cross-tenant launch attempts', async () => {
  const db = {
    getSubscription: async () => ({ status: 'active', monthlyEditLimit: 5 }),
    getUsage: async () => ({ monthlyEditLimit: 5, editsUsedThisPeriod: 0, remainingEdits: 5 }),
    buildUsageLimits: () => ({ planKey: 'trial', monthlyEditLimit: 5, freeSiteLimit: 10 }),
    listSiteGenerations: async () => [],
    createSiteGenerationRequest: async () => {
      throw new Error('should not create when forbidden');
    },
    touchSiteGenerationStage: async () => {},
    updateSiteGeneration: async () => {},
    incrementUsage: async () => {},
  };
  const app = buildMockServer(db);
  const response = await app.inject({
    method: 'POST',
    url: '/launch',
    payload: {
      url: 'https://example.com/evil',
      accountId: '00000000-0000-4000-8000-000000000000',
    },
    headers: { authorization: 'Bearer token' },
  });
  assert.strictEqual(response.statusCode, 403);
  await app.close();
});

test('requires authentication for launch', async () => {
  const db = {
    getSubscription: async () => null,
    getUsage: async () => ({ monthlyEditLimit: 1, editsUsedThisPeriod: 0, remainingEdits: 1 }),
    buildUsageLimits: () => ({ planKey: 'trial', monthlyEditLimit: 1, freeSiteLimit: 10 }),
    listSiteGenerations: async () => [],
    createSiteGenerationRequest: async () => {
      throw new Error('unauthenticated users should not launch');
    },
    touchSiteGenerationStage: async () => {},
    updateSiteGeneration: async () => {},
    incrementUsage: async () => {},
  };
  const app = buildMockServer(db);
  const response = await app.inject({
    method: 'POST',
    url: '/launch',
    payload: { url: 'https://example.com/no-auth' },
  });
  assert.strictEqual(response.statusCode, 401);
  await app.close();
});

test('returns 402 when signed-in user exceeds quota', async () => {
  const db = {
    getSubscription: async () => ({ status: 'active', monthlyEditLimit: 1 }),
    getUsage: async () => ({ monthlyEditLimit: 1, editsUsedThisPeriod: 1, remainingEdits: 0 }),
    buildUsageLimits: () => ({ planKey: 'trial', monthlyEditLimit: 1, freeSiteLimit: 10 }),
    listSiteGenerations: async () => [],
    createSiteGenerationRequest: async () => {
      throw new Error('should not create when over limit');
    },
    touchSiteGenerationStage: async () => {},
    updateSiteGeneration: async () => {},
    incrementUsage: async () => {},
  };
  const app = buildMockServer(db);
  const response = await app.inject({
    method: 'POST',
    url: '/launch',
    payload: { url: 'https://example.com/over' },
    headers: { authorization: 'Bearer token' },
  });
  assert.strictEqual(response.statusCode, 402);
  const body = response.json();
  assert.strictEqual(body.code, 'LIMIT_EXCEEDED');
  await app.close();
});
