/* eslint-disable import/no-extraneous-dependencies */
const { test } = require('node:test');
const assert = require('node:assert');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'test';
process.env.COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || 'pool';
process.env.COGNITO_USER_POOL_REGION = process.env.COGNITO_USER_POOL_REGION || 'us-east-1';
process.env.COGNITO_APP_CLIENT_ID = process.env.COGNITO_APP_CLIENT_ID || 'client';
process.env.COGNITO_DOMAIN = process.env.COGNITO_DOMAIN || 'example.auth.us-east-1.amazoncognito.com';
process.env.TEMPLATE_UPLOAD_BUCKET = process.env.TEMPLATE_UPLOAD_BUCKET || 'templates';
process.env.LOVABLE_DEPLOY_BUCKET = process.env.LOVABLE_DEPLOY_BUCKET || 'preview-bucket';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.PREVIEW_DOMAIN = process.env.PREVIEW_DOMAIN || 'preview.ai-sitemaker.com';

const {
  loadAllowedSlugs,
  ensureAnySiteAccess,
  ensureSlugAccess,
  resolveSlugOrDefault,
} = require('../../dist/services/site-access');

const buildReplyStub = () => {
  const reply = {
    status: null,
    payload: null,
    code(statusCode) {
      this.status = statusCode;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    },
  };
  return reply;
};

const buildRequest = (accountId, slugs) => ({
  auth: {
    profile: {
      accountId,
    },
  },
  _testSlugs: slugs,
});

const buildDb = () => ({
  listAccountSlugs: async (accountId) => {
    if (accountId === 'acct-empty') return [];
    if (accountId === 'acct-two') return ['alpha', 'bravo'];
    return ['only'];
  },
});

test('loadAllowedSlugs caches results per request', async () => {
  const request = buildRequest('acct-two');
  const db = buildDb();
  const first = await loadAllowedSlugs(request, db);
  assert.deepStrictEqual(first, ['alpha', 'bravo']);
  request._testMarker = 'cached';
  const second = await loadAllowedSlugs(request, {
    listAccountSlugs: async () => {
      throw new Error('should not be called after cache');
    },
  });
  assert.deepStrictEqual(second, ['alpha', 'bravo']);
});

test('ensureAnySiteAccess rejects when no slugs are assigned', async () => {
  const request = buildRequest('acct-empty');
  const reply = buildReplyStub();
  const db = buildDb();
  const result = await ensureAnySiteAccess(request, reply, db);
  assert.strictEqual(result, null);
  assert.strictEqual(reply.status, 403);
  assert.deepStrictEqual(reply.payload, { error: 'No sites assigned to this account yet.' });
});

test('ensureSlugAccess enforces membership and required slug', async () => {
  const db = buildDb();
  const request = buildRequest('acct-two');
  const reply = buildReplyStub();
  const result = await ensureSlugAccess(request, reply, db, 'bravo');
  assert.strictEqual(result, 'bravo');
  const replyForbidden = buildReplyStub();
  const forbidden = await ensureSlugAccess(request, replyForbidden, db, 'charlie');
  assert.strictEqual(forbidden, null);
  assert.strictEqual(replyForbidden.status, 403);
});

test('resolveSlugOrDefault returns first slug when none specified', async () => {
  const db = buildDb();
  const request = buildRequest('acct-two');
  const reply = buildReplyStub();
  const slug = await resolveSlugOrDefault(request, reply, db, undefined);
  assert.strictEqual(slug, 'alpha');
});
