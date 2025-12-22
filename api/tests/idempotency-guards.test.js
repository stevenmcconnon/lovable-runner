/* eslint-disable import/no-extraneous-dependencies */
const { test } = require('node:test');
const assert = require('node:assert');

const {
  resolveLaunchIdempotency,
  resolveEditJobIdempotency,
} = require('../../dist/utils/idempotency');

test('resolveLaunchIdempotency skips completed launches', () => {
  const result = resolveLaunchIdempotency({
    requestId: 'req-1',
    status: 'completed',
    slug: 'demo',
    bucket: 'bucket',
    prefix: 'demo',
    publicUrl: 'https://example.com/demo',
  });
  assert.deepStrictEqual(result, {
    skip: true,
    response: {
      requestId: 'req-1',
      status: 'completed',
      slug: 'demo',
      bucket: 'bucket',
      prefix: 'demo',
      publicUrl: 'https://example.com/demo',
    },
  });
});

test('resolveLaunchIdempotency ignores stale running launches', () => {
  const result = resolveLaunchIdempotency({
    requestId: 'req-2',
    status: 'running',
    updatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  });
  assert.deepStrictEqual(result, { skip: false });
});

test('resolveEditJobIdempotency skips failed jobs', () => {
  const result = resolveEditJobIdempotency({
    id: 'job-1',
    status: 'failed',
    errorMessage: 'boom',
  });
  assert.deepStrictEqual(result, {
    skip: true,
    response: {
      jobId: 'job-1',
      status: 'failed',
      errorMessage: 'boom',
    },
  });
});

test('resolveEditJobIdempotency skips recent running jobs', () => {
  const result = resolveEditJobIdempotency({
    id: 'job-2',
    status: 'running',
    updatedAt: new Date().toISOString(),
  });
  assert.strictEqual(result.skip, true);
  assert.deepStrictEqual(result.response, {
    jobId: 'job-2',
    status: 'running',
  });
});
