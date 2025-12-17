#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const AWS = require('aws-sdk');
const { Client: PgClient } = require('pg');

const baseUrl = (process.env.TEST_API_BASE || 'https://api.ai-sitemaker.com').replace(/\/+$/, '');

const tokens = {
  customer: process.env.TEST_CUSTOMER_TOKEN,
  admin: process.env.TEST_ADMIN_TOKEN,
  machine: process.env.TEST_MACHINE_TOKEN,
};

const integrationState = {
  editRequest: null,
  job: null,
};

const disableStackLookup = process.env.TEST_DISABLE_STACK_LOOKUP === '1';

const bootstrapConfig = {
  enabled:
    process.env.TEST_BOOTSTRAP_USER === '1' ||
    (!process.env.TEST_BOOTSTRAP_USER && !tokens.customer && !tokens.admin),
  databaseUrl: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
  userPoolId: process.env.TEST_USER_POOL_ID || process.env.COGNITO_USER_POOL_ID,
  appClientId: process.env.TEST_APP_CLIENT_ID || process.env.COGNITO_APP_CLIENT_ID,
  region:
    process.env.TEST_AWS_REGION ||
    process.env.COGNITO_USER_POOL_REGION ||
    process.env.AWS_REGION ||
    'us-east-1',
  stackName: process.env.TEST_STACK_NAME || process.env.AWS_STACK_NAME || 'lovable-runner-api',
};

const schemaPath = path.resolve(__dirname, '..', 'infra', 'db', 'schema.sql');
let cachedStackOutputs = null;

if (process.env.TEST_LOG_BOOTSTRAP === '1') {
  // eslint-disable-next-line no-console
  console.log('Bootstrap config', JSON.stringify(bootstrapConfig, null, 2));
}

const shouldUseDbSSL = (url) =>
  process.env.TEST_DB_SSL === '1' || /amazonaws\.com/.test(url || '');

const createDbClient = (connectionString) =>
  new PgClient({
    connectionString,
    ssl: shouldUseDbSSL(connectionString) ? { rejectUnauthorized: false } : undefined,
  });

const ensureAwsRegion = () => {
  if (!AWS.config.region) {
    AWS.config.update({ region: bootstrapConfig.region });
  }
};

const mapOutputs = (outputs = []) =>
  outputs.reduce((acc, curr) => ({ ...acc, [curr.OutputKey]: curr.OutputValue }), {});

const ensureStackOutputs = async () => {
  if (disableStackLookup) return null;
  if (cachedStackOutputs) return cachedStackOutputs;
  const stackName = bootstrapConfig.stackName;
  if (!stackName) return null;
  ensureAwsRegion();
  const cfn = new AWS.CloudFormation();
  const { Stacks } = await cfn.describeStacks({ StackName: stackName }).promise();
  const stack = Stacks?.[0];
  cachedStackOutputs = stack ? mapOutputs(stack.Outputs || []) : null;
  return cachedStackOutputs;
};

const ensureDatabaseUrl = async () => {
  if (bootstrapConfig.databaseUrl) return bootstrapConfig.databaseUrl;
  const outputs = await ensureStackOutputs();
  if (!outputs) return null;
  const endpoint = outputs.DatabaseEndpoint;
  const secretArn = outputs.DatabaseCredentialsSecretArn;
  const dbName = outputs.DatabaseName;
  if (!endpoint || !secretArn) return null;
  const secrets = new AWS.SecretsManager();
  const secretValue = await secrets.getSecretValue({ SecretId: secretArn }).promise();
  const secret = secretValue.SecretString ? JSON.parse(secretValue.SecretString) : {};
  if (!secret.username || !secret.password) return null;
  const connectionString = `postgresql://${encodeURIComponent(secret.username)}:${encodeURIComponent(
    secret.password
  )}@${endpoint}:5432/${secret.database || dbName}`;
  bootstrapConfig.databaseUrl = connectionString;
  return connectionString;
};

const ensureBootstrapReadiness = async () => {
  if (!bootstrapConfig.enabled) return false;
  await ensureDatabaseUrl();
  const outputs = await ensureStackOutputs();
  if (outputs) {
    bootstrapConfig.userPoolId ||= outputs.UserPoolId;
    bootstrapConfig.appClientId ||= outputs.UserPoolClientId;
    process.env.COGNITO_USER_POOL_ID ||= outputs.UserPoolId;
    process.env.COGNITO_APP_CLIENT_ID ||= outputs.UserPoolClientId;
  }
  const ready =
    Boolean(bootstrapConfig.databaseUrl) &&
    Boolean(bootstrapConfig.userPoolId) &&
    Boolean(bootstrapConfig.appClientId);
  if (!ready) {
    console.warn(
      'Auto-bootstrapping requested but required configuration is missing. ' +
        'Provide DATABASE_URL (or TEST_STACK_NAME) and Cognito identifiers, or set TEST_BOOTSTRAP_USER=0.'
    );
  }
  return ready;
};

const applyDatabaseSchema = async () => {
  if (!bootstrapConfig.databaseUrl) return;
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const client = createDbClient(bootstrapConfig.databaseUrl);
  await client.connect();
  await client.query(sql);
  await client.end();
};

const fetchJson = async (path, options = {}) => {
  const url = path.startsWith('http') ? path : `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, options);
  const text = await res.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!res.ok) {
    const error = new Error(`Request to ${url} failed with ${res.status}`);
    error.response = payload;
    throw error;
  }
  return payload;
};

const withAuth = (token, extraOptions = {}) => {
  if (!token) throw new Error('Missing token');
  const headers = {
    ...(extraOptions.headers || {}),
    Authorization: `Bearer ${token}`,
  };
  return {
    ...extraOptions,
    headers,
  };
};

const getMachineToken = async () => {
  if (tokens.machine) return tokens.machine;
  const domain = process.env.COGNITO_DOMAIN;
  const clientId = process.env.COGNITO_M2M_CLIENT_ID;
  const clientSecret = process.env.COGNITO_M2M_CLIENT_SECRET;
  if (!domain || !clientId || !clientSecret) return null;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'lovable-backend/internal',
  });
  const response = await fetch(`https://${domain}/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch machine token: ${response.status} ${text}`);
  }
  const json = await response.json();
  tokens.machine = json.access_token;
  return tokens.machine;
};

const bootstrapTestUser = async () => {
  ensureAwsRegion();
  if (!bootstrapConfig.databaseUrl) {
    throw new Error('Bootstrap configuration is incomplete (missing database URL).');
  }
  const cognito = new AWS.CognitoIdentityServiceProvider();
  const emailDomain = process.env.TEST_USER_EMAIL_DOMAIN || 'example.com';
  const username = `api-test+${Date.now()}@${emailDomain}`;
  const password = `Test!${randomUUID().slice(0, 8)}`;
  const fullName = process.env.TEST_USER_FULL_NAME || 'API Test User';

  await cognito
    .adminCreateUser({
      UserPoolId: bootstrapConfig.userPoolId,
      Username: username,
      TemporaryPassword: password,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: username },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'name', Value: fullName },
      ],
    })
    .promise()
    .catch((error) => {
      if (error.code !== 'UsernameExistsException') throw error;
    });

  await cognito
    .adminSetUserPassword({
      UserPoolId: bootstrapConfig.userPoolId,
      Username: username,
      Password: password,
      Permanent: true,
    })
    .promise();

  const user = await cognito
    .adminGetUser({
      UserPoolId: bootstrapConfig.userPoolId,
      Username: username,
    })
    .promise();
  const sub =
    user.UserAttributes?.find((attr) => attr.Name === 'sub')?.Value ||
    (() => {
      throw new Error('Created user missing Cognito sub attribute');
    })();

  const db = createDbClient(bootstrapConfig.databaseUrl);
  await db.connect();
  const accountId = randomUUID();
  const profileId = randomUUID();
  await db.query(
    `
      INSERT INTO profiles (id, account_id, email, full_name, cognito_sub, has_used_trial)
      VALUES ($1,$2,$3,$4,$5,false)
      ON CONFLICT (cognito_sub) DO UPDATE SET email = EXCLUDED.email
    `,
    [profileId, accountId, username, fullName, sub]
  );
  const roles = (process.env.TEST_BOOTSTRAP_ROLES || 'customer,admin,super-admin')
    .split(',')
    .map((role) => role.trim())
    .filter(Boolean);
  for (const role of roles) {
    await db.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1,$2) ON CONFLICT (user_id, role) DO NOTHING`,
      [profileId, role]
    );
  }
  await db.end();

  console.log(`Inserted test profile ${profileId} for ${username}`);

  const auth = await cognito
    .initiateAuth({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: bootstrapConfig.appClientId,
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password,
      },
    })
    .promise();

  const accessToken = auth.AuthenticationResult?.AccessToken;
  if (!accessToken) throw new Error('Unable to retrieve access token for test user.');

  return {
    username,
    sub,
    profileId,
    accessToken,
    cognito,
  };
};

const cleanupBootstrapUser = async (context) => {
  const errors = [];
  if (context?.cognito) {
    try {
      await context.cognito
        .adminDeleteUser({
          UserPoolId: bootstrapConfig.userPoolId,
          Username: context.username,
        })
        .promise();
    } catch (error) {
      errors.push(`Failed to delete Cognito user: ${error.message}`);
    }
  }
  if (context?.profileId && bootstrapConfig.databaseUrl) {
    const db = createDbClient(bootstrapConfig.databaseUrl);
    try {
      await db.connect();
      await db.query(`DELETE FROM profiles WHERE id = $1`, [context.profileId]);
    } catch (error) {
      errors.push(`Failed to delete profile ${context.profileId}: ${error.message}`);
    } finally {
      await db.end().catch(() => {});
    }
  }
  if (errors.length) {
    console.warn(errors.join('\n'));
  }
};

const tests = [
  {
    name: 'GET /health',
    required: [],
    run: async () => {
      const json = await fetchJson('/health');
      if (!json || json.status !== 'ok') throw new Error('Unexpected health payload');
    },
  },
  {
    name: 'GET /me',
    required: ['customer'],
    run: async () => {
      const body = await fetchJson('/me', withAuth(tokens.customer));
      if (!body?.userId || !body?.email) throw new Error('Missing user fields');
    },
  },
  {
    name: 'GET /customer/subscription',
    required: ['customer'],
    run: async () => {
      const result = await fetchJson('/customer/subscription', withAuth(tokens.customer));
      if (!result || typeof result !== 'object') throw new Error('Unexpected subscription payload');
    },
  },
  {
    name: 'GET /customer/usage',
    required: ['customer'],
    run: async () => {
      const usage = await fetchJson('/customer/usage', withAuth(tokens.customer));
      if (!usage || typeof usage.remainingEdits !== 'number') {
        throw new Error('Usage response missing counters');
      }
    },
  },
  {
    name: 'GET /usage',
    required: ['customer'],
    run: async () => {
      const result = await fetchJson('/usage', withAuth(tokens.customer));
      if (!result?.usage || !result?.limits) {
        throw new Error('Usage payload missing usage or limits');
      }
      if (!result.metrics || typeof result.metrics.views !== 'number') {
        throw new Error('Usage metrics missing aggregate counters');
      }
    },
  },
  {
    name: 'GET /usage/limits',
    required: ['customer'],
    run: async () => {
      const limits = await fetchJson('/usage/limits', withAuth(tokens.customer));
      if (!limits || typeof limits.monthlyEditLimit !== 'number') {
        throw new Error('Usage limits missing monthlyEditLimit');
      }
    },
  },
  {
    name: 'GET /billing/plans',
    required: [],
    run: async () => {
      const plans = await fetchJson('/billing/plans');
      if (!plans || !Array.isArray(plans.items)) {
        throw new Error('Billing plans response missing items array');
      }
    },
  },
  {
    name: 'GET /billing/subscription-status',
    required: ['customer'],
    run: async () => {
      const status = await fetchJson('/billing/subscription-status', withAuth(tokens.customer));
      if (!status?.subscription || !status?.limits) {
        throw new Error('Subscription status payload missing subscription or limits');
      }
      if (!status.usage || typeof status.usage.remainingEdits !== 'number') {
        throw new Error('Subscription status missing usage counters');
      }
    },
  },
  {
    name: 'POST /customer/edit-requests',
    required: ['customer'],
    run: async () => {
      const payload = {
        description: `Integration test request ${new Date().toISOString()}`,
        business: {
          businessName: 'API Test Co.',
          phone: '+1-555-0000',
        },
      };
      const result = await fetchJson(
        '/customer/edit-requests',
        withAuth(tokens.customer, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      );
      if (!result?.id) throw new Error('Edit request missing id');
      integrationState.editRequest = result;
      integrationState.job = result.latestJob ?? null;
    },
  },
  {
    name: 'GET /customer/edit-requests',
    required: ['customer'],
    needs: ['editRequest'],
    run: async () => {
      const requests = await fetchJson('/customer/edit-requests', withAuth(tokens.customer));
      if (!Array.isArray(requests) || !requests.length) {
        throw new Error('Expected at least one edit request');
      }
    },
  },
  {
    name: 'GET /admin/edit-requests',
    required: ['admin'],
    run: async () => {
      const items = await fetchJson('/admin/edit-requests', withAuth(tokens.admin));
      if (!Array.isArray(items)) throw new Error('Expected list of edit requests');
    },
  },
  {
    name: 'GET /admin/edit-requests/:id',
    required: ['admin'],
    needs: ['editRequest'],
    run: async () => {
      const detail = await fetchJson(
        `/admin/edit-requests/${integrationState.editRequest.id}`,
        withAuth(tokens.admin)
      );
      if (!detail || detail.id !== integrationState.editRequest.id) {
        throw new Error('Failed to fetch edit request details');
      }
    },
  },
  {
    name: 'GET /admin/jobs',
    required: ['admin'],
    needs: ['job'],
    run: async () => {
      const jobs = await fetchJson(
        `/admin/jobs?editRequestId=${integrationState.editRequest.id}`,
        withAuth(tokens.admin)
      );
      if (!Array.isArray(jobs) || !jobs.length) throw new Error('Expected at least one job entry');
    },
  },
  {
    name: 'POST /internal/jobs/{jobId}/fail',
    required: ['machine'],
    run: async () => {
      if (!tokens.machine) {
        await getMachineToken();
      }
      if (!tokens.machine) {
        throw new Error('Machine token unavailable');
      }
      try {
        await fetchJson(
          '/internal/jobs/test-job/fail',
          withAuth(tokens.machine, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${tokens.machine}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ errorMessage: 'integration test' }),
          })
        );
        throw new Error('Expected 4xx for invalid job id');
      } catch (error) {
        if (!error.response || !error.response.message) {
          throw new Error('Unexpected response from internal job fail endpoint');
        }
      }
    },
  },
];

const runSuite = async () => {
  let passed = 0;
  for (const test of tests) {
    const missingToken = test.required.find((key) => !tokens[key]);
    if (missingToken) {
      console.log(`- SKIP ${test.name} (set TEST_${missingToken.toUpperCase()}_TOKEN or enable bootstrapping)`);
      continue;
    }
    if (test.needs) {
      const unmet = test.needs.find((key) => !integrationState[key]);
      if (unmet) {
        console.log(`- SKIP ${test.name} (missing prerequisite data: ${unmet})`);
        continue;
      }
    }
    try {
      await test.run();
      console.log(`- PASS ${test.name}`);
      passed += 1;
    } catch (error) {
      console.error(`- FAIL ${test.name}`);
      if (error.response) console.error('  Response:', error.response);
      console.error('  ', error.message);
      process.exitCode = 1;
    }
  }

  if (passed === 0) {
    console.warn('No tests executed. Provide tokens or enable automatic bootstrapping via TEST_BOOTSTRAP_USER=1.');
    process.exitCode = 1;
  } else if (!process.exitCode) {
    console.log(`All ${passed} executed tests passed.`);
  }
};

const main = async () => {
  const cleanupCallbacks = [];
  let bootstrapContext = null;
  try {
    if (!tokens.customer || !tokens.admin) {
      const ready = await ensureBootstrapReadiness();
      if (ready) {
        await applyDatabaseSchema();
        console.log('Bootstrapping temporary Cognito user for integration tests...');
        bootstrapContext = await bootstrapTestUser();
        tokens.customer = bootstrapContext.accessToken;
        tokens.admin = bootstrapContext.accessToken;
        cleanupCallbacks.push(() => cleanupBootstrapUser(bootstrapContext));
      }
    }

    await runSuite();
  } finally {
    const skipCleanup = process.env.TEST_SKIP_CLEANUP === '1';
    if (skipCleanup) {
      console.warn('TEST_SKIP_CLEANUP=1 set; leaving temporary Cognito user/profile in place.');
      return;
    }
    for (const cleanup of cleanupCallbacks.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        console.warn('Cleanup warning:', error.message);
      }
    }
  }
};

main().catch((error) => {
  console.error('Unexpected test failure:', error);
  process.exit(1);
});
