#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Optional full-surface API test runner driven by the OpenAPI spec.
 * It is intended for occasional, manual runs (e.g., pre-release),
 * because many endpoints require real data/tokens.
 *
 * Usage:
 *   TEST_API_BASE=https://api.example.com \
 *   TEST_CUSTOMER_TOKEN=... \
 *   TEST_ADMIN_TOKEN=... \
 *   TEST_MACHINE_TOKEN=... \
 *   TEST_API_FIXTURES=openapi/test-fixtures.full.json \
 *   node scripts/test-openapi-full.js
 *
 * Fixtures:
 * - Provide per-operation payloads, params, and auth in JSON.
 * - Shape: { "<operationId>": { auth: "customer"|"admin"|"machine"|"none", pathParams: {}, query: {}, body: {}, expectedStatus: [200,201], skip: "reason" } }
 * - See openapi/test-fixtures.sample.json for a template.
 */

const fs = require('fs');
const path = require('path');
const AWS = require('aws-sdk');
const { Client: PgClient } = require('pg');
const { randomUUID } = require('node:crypto');

const baseUrl = (process.env.TEST_API_BASE || '').replace(/\/+$/, '');
if (!baseUrl) {
  console.error('TEST_API_BASE is required.');
  process.exit(1);
}

const specPath = path.resolve(__dirname, '..', 'openapi', 'openapi.json');
if (!fs.existsSync(specPath)) {
  console.error(`OpenAPI file not found at ${specPath}`);
  process.exit(1);
}

const fixturesPath =
  process.env.TEST_API_FIXTURES ||
  path.resolve(__dirname, '..', 'openapi', 'test-fixtures.full.json');
const fixtures = fs.existsSync(fixturesPath)
  ? JSON.parse(fs.readFileSync(fixturesPath, 'utf8'))
  : {};

const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

const operations = [];
Object.entries(spec.paths || {}).forEach(([rawPath, methods]) => {
  Object.entries(methods || {}).forEach(([method, details]) => {
    if (!details || typeof details !== 'object') return;
    operations.push({
      path: rawPath,
      method: method.toUpperCase(),
      operationId: details.operationId || `${method.toUpperCase()} ${rawPath}`,
    });
  });
});

const results = [];

const tokens = {
  customer: process.env.TEST_CUSTOMER_TOKEN || null,
  admin: process.env.TEST_ADMIN_TOKEN || null,
  machine: process.env.TEST_MACHINE_TOKEN || null,
};

const randomEmail = () => `openapi-full+${Date.now()}@example.com`;

const fetchJson = async (url, options = {}) => {
  const res = await fetch(url, options);
  const text = await res.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!res.ok) {
    const err = new Error(`Request failed with ${res.status}`);
    err.status = res.status;
    err.body = payload;
    throw err;
  }
  return payload;
};

const autoBootstrapCustomerToken = async () => {
  const allowAuto = process.env.TEST_AUTO_SIGNUP !== '0';
  if (!allowAuto || tokens.customer) return;
  const email = process.env.TEST_SIGNUP_EMAIL || randomEmail();
  const password = process.env.TEST_SIGNUP_PASSWORD || 'Test!12345';
  try {
    await fetchJson(`${baseUrl}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, fullName: 'OpenAPI Full Test' }),
    }).catch(() => null); // ignore duplicate/validation; we'll try login next
    const login = await fetchJson(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const token = login.idToken || login.accessToken || login.id_token || login.access_token;
    if (token) {
      tokens.customer = token;
      if (!tokens.admin) tokens.admin = token; // fallback so we run more surface
      if (!tokens.machine) tokens.machine = token;
      console.log(`Auto-bootstrapped customer token via signup/login (${email})`);
    } else {
      console.warn('Login succeeded but no token fields found; leaving tokens unset.');
    }
  } catch (error) {
    console.warn(`Auto signup/login failed: ${error.message}`);
  }
};

const stackName =
  process.env.TEST_STACK_NAME || process.env.AWS_STACK_NAME || 'lovable-runner-api';
let bootstrapContext = null;

const ensureAwsRegion = () => {
  if (!AWS.config.region) {
    AWS.config.update({
      region:
        process.env.TEST_AWS_REGION ||
        process.env.COGNITO_USER_POOL_REGION ||
        process.env.AWS_REGION ||
        'us-east-1',
    });
  }
};

const mapOutputs = (outputs = []) =>
  outputs.reduce((acc, curr) => ({ ...acc, [curr.OutputKey]: curr.OutputValue }), {});

const fetchStackOutputs = async () => {
  ensureAwsRegion();
  const cfn = new AWS.CloudFormation();
  const { Stacks } = await cfn.describeStacks({ StackName: stackName }).promise();
  return mapOutputs(Stacks?.[0]?.Outputs || []);
};

const resolveDatabaseUrl = async (outputs) => {
  const endpoint = outputs.DatabaseEndpoint;
  const secretArn = outputs.DatabaseCredentialsSecretArn;
  const dbName = outputs.DatabaseName;
  if (!endpoint || !secretArn) return null;
  const secrets = new AWS.SecretsManager();
  const secretValue = await secrets.getSecretValue({ SecretId: secretArn }).promise();
  const secret = secretValue.SecretString ? JSON.parse(secretValue.SecretString) : {};
  if (!secret.username || !secret.password) return null;
  return `postgresql://${encodeURIComponent(secret.username)}:${encodeURIComponent(
    secret.password
  )}@${endpoint}:5432/${secret.database || dbName}`;
};

const bootstrapViaCognito = async () => {
  try {
    const outputs = await fetchStackOutputs();
    const dbUrl = await resolveDatabaseUrl(outputs);
    if (!outputs.UserPoolId || !outputs.UserPoolClientId || !dbUrl) {
      console.warn('Stack outputs incomplete; skipping Cognito bootstrap.');
      return;
    }
    const cognito = new AWS.CognitoIdentityServiceProvider();
    const email = randomEmail();
    const password = 'Test!12345';
    await cognito
      .adminCreateUser({
        UserPoolId: outputs.UserPoolId,
        Username: email,
        TemporaryPassword: password,
        MessageAction: 'SUPPRESS',
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'name', Value: 'OpenAPI Full Test' },
        ],
      })
      .promise()
      .catch((err) => {
        if (err.code !== 'UsernameExistsException') throw err;
      });

    await cognito
      .adminSetUserPassword({
        UserPoolId: outputs.UserPoolId,
        Username: email,
        Password: password,
        Permanent: true,
      })
      .promise();

    const user = await cognito
      .adminGetUser({
        UserPoolId: outputs.UserPoolId,
        Username: email,
      })
      .promise();
    const sub =
      user.UserAttributes?.find((attr) => attr.Name === 'sub')?.Value ||
      (() => {
        throw new Error('Missing sub on Cognito user');
      })();

    const db = new PgClient({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
    });
    await db.connect();
    const accountId = randomUUID();
    const profileId = randomUUID();
    await db.query(
      `INSERT INTO profiles (id, account_id, email, full_name, cognito_sub, has_used_trial)
       VALUES ($1,$2,$3,$4,$5,false)
       ON CONFLICT (cognito_sub) DO UPDATE SET email = EXCLUDED.email`,
      [profileId, accountId, email, 'OpenAPI Full Test', sub]
    );
    const roles = ['customer', 'admin', 'super-admin'];
    for (const role of roles) {
      await db.query(
        `INSERT INTO user_roles (user_id, role) VALUES ($1,$2) ON CONFLICT (user_id, role) DO NOTHING`,
        [profileId, role]
      );
    }
    await db.end();

    const auth = await cognito
      .initiateAuth({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: outputs.UserPoolClientId,
        AuthParameters: {
          USERNAME: email,
          PASSWORD: password,
        },
      })
      .promise();
    const accessToken = auth.AuthenticationResult?.AccessToken;
    if (accessToken) {
      tokens.customer = accessToken;
      tokens.admin = accessToken;
      tokens.machine = accessToken;
      bootstrapContext = {
        accountId,
        profileId,
        dbUrl,
        sub,
      };
      console.log(`Bootstrapped Cognito user ${email} and obtained access token.`);
    } else {
      console.warn('Cognito bootstrap succeeded but no access token found.');
    }
  } catch (error) {
    console.warn(`Cognito/DB bootstrap failed: ${error.message}`);
  }
};

const buildUrl = (template, pathParams = {}, query = {}) => {
  let resolved = template;
  Object.entries(pathParams || {}).forEach(([key, value]) => {
    resolved = resolved.replace(`{${key}}`, encodeURIComponent(String(value)));
  });
  const url = new URL(`${baseUrl}${resolved.startsWith('/') ? '' : '/'}${resolved}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
};

const ensureRolesForSub = async () => {
  if (!bootstrapContext?.dbUrl || !bootstrapContext?.sub) return;
  const db = new PgClient({
    connectionString: bootstrapContext.dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  const { rows } = await db.query(
    `SELECT id FROM profiles WHERE cognito_sub = $1 LIMIT 1`,
    [bootstrapContext.sub]
  );
  let profileId = rows[0]?.id;
  let accountId = bootstrapContext.accountId;
  if (!profileId) {
    profileId = randomUUID();
    accountId = accountId || randomUUID();
    await db.query(
      `INSERT INTO profiles (id, account_id, email, full_name, cognito_sub, has_used_trial)
       VALUES ($1,$2,$3,$4,$5,false)
       ON CONFLICT (cognito_sub) DO NOTHING`,
      [profileId, accountId, `openapi+${bootstrapContext.sub}@example.com`, 'OpenAPI Full Test', bootstrapContext.sub]
    );
  }
  await db.query(
    `INSERT INTO user_roles (user_id, role)
     VALUES ($1,'customer'),($1,'admin'),($1,'super-admin')
     ON CONFLICT (user_id, role) DO NOTHING`,
    [profileId]
  );
  await db.end();
  bootstrapContext.profileId = profileId;
  bootstrapContext.accountId = accountId || bootstrapContext.accountId;
};

const seedTestEntities = async () => {
  if (!bootstrapContext?.dbUrl || !bootstrapContext?.accountId) return null;
  const db = new PgClient({
    connectionString: bootstrapContext.dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  const slug = `openapi-smoke-${Date.now()}`;
  const domain = `${slug}.example.com`;
  const deploymentId = randomUUID();
  const domainId = randomUUID();
  const requestId = randomUUID();

  await db.query(
    `INSERT INTO site_generations (request_id, account_id, user_id, slug, prefix, bucket, status, public_url)
     VALUES ($1,$2,$3,$4,$5,$6,'completed',$7)
     ON CONFLICT (request_id) DO NOTHING`,
    [requestId, bootstrapContext.accountId, bootstrapContext.profileId, slug, slug, null, null]
  );
  await db.query(
    `INSERT INTO site_deployments (id, slug, account_id, target, status, bucket, prefix, public_url)
     VALUES ($1,$2,$3,'preview','completed',NULL,$4,NULL)
     ON CONFLICT (id) DO NOTHING`,
    [deploymentId, slug, bootstrapContext.accountId, slug]
  );
  await db.query(
    `INSERT INTO site_domains (id, account_id, slug, domain, status, is_primary)
     VALUES ($1,$2,$3,$4,'verified',false)
     ON CONFLICT (id) DO NOTHING`,
    [domainId, bootstrapContext.accountId, slug, domain]
  );
  await db.end();
  return {
    slug,
    domainId,
    domain,
    deploymentId,
    accountId: bootstrapContext.accountId,
    profileId: bootstrapContext.profileId,
  };
};

const applyReplacements = (fixturesObj, replacements) => {
  const replaceValue = (val) => {
    if (typeof val !== 'string') return val;
    const lower = val.toLowerCase();
    if (lower.includes('replace-with-real-slug') && replacements.slug) return replacements.slug;
    if (lower.includes('replace-with-domain-id') && replacements.domainId) return replacements.domainId;
    if (lower.includes('replace-with-deployment-id') && replacements.deploymentId) return replacements.deploymentId;
    if (lower.includes('replace-with-account-id') && replacements.accountId) return replacements.accountId;
    if (lower.includes('replace-with-user-id') && replacements.profileId) return replacements.profileId;
    if (lower.includes('replace-with-existing-key') && replacements.assetKey) return replacements.assetKey;
    if (lower.includes('replace-with-domain') && replacements.domain) return replacements.domain;
    return val;
  };
  const walk = (obj) => {
    if (Array.isArray(obj)) return obj.map(walk);
    if (obj && typeof obj === 'object') {
      const out = {};
      Object.entries(obj).forEach(([k, v]) => {
        out[k] = walk(v);
      });
      return out;
    }
    return replaceValue(obj);
  };
  return walk(fixturesObj);
};

const run = async () => {
  await autoBootstrapCustomerToken();
  if (!tokens.customer) {
    await bootstrapViaCognito();
  }
  await ensureRolesForSub();

  const hasPlaceholder = (value) =>
    typeof value === 'string' && value.toLowerCase().includes('replace-with');

  const containsPlaceholder = (obj) => {
    if (!obj) return false;
    return Object.values(obj).some((v) => hasPlaceholder(v));
  };

  const seeded = (await seedTestEntities()) || {};
  const fixturesWithReplacements = applyReplacements(fixtures, {
    slug: seeded.slug,
    domainId: seeded.domainId,
    deploymentId: seeded.deploymentId,
    accountId: seeded.accountId,
    profileId: seeded.profileId,
    domain: seeded.domain,
    assetKey: 'missing.png',
  });

  for (const op of operations) {
    const fixture =
      fixturesWithReplacements[op.operationId] || fixturesWithReplacements[`${op.method} ${op.path}`];
    if (!fixture) {
      results.push({ op, status: 'skipped', reason: 'no fixture' });
      continue;
    }
    if (fixture.skip) {
      results.push({ op, status: 'skipped', reason: fixture.skip });
      continue;
    }
    if (containsPlaceholder(fixture.pathParams) || containsPlaceholder(fixture.query)) {
      results.push({ op, status: 'skipped', reason: 'placeholder path/query values' });
      continue;
    }
    if (containsPlaceholder(fixture.body)) {
      results.push({ op, status: 'skipped', reason: 'placeholder body values' });
      continue;
    }
    const url = buildUrl(op.path, fixture.pathParams, fixture.query);
    const headers = {
      ...(fixture.headers || {}),
    };
    const authMode = fixture.auth || 'none';
    if (authMode !== 'none') {
      const token = tokens[authMode];
      if (!token) {
        results.push({
          op,
          status: 'skipped',
          reason: `missing ${authMode} token`,
        });
        continue;
      }
      headers.Authorization = `Bearer ${token}`;
    }

    const body =
      fixture.body !== undefined
        ? JSON.stringify(fixture.body)
        : undefined;
    if (body !== undefined && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    try {
      const res = await fetch(url, {
        method: op.method,
        headers,
        body,
      });
      const expected =
        fixture.expectedStatus ||
        (['POST', 'PUT', 'PATCH', 'DELETE'].includes(op.method)
          ? [200, 201, 204]
          : [200]);
      const ok = expected.includes(res.status);
      const payload = await res.text();
      if (ok) {
        console.log(`PASS ${op.method} ${op.path} (${res.status})`);
        results.push({ op, status: 'passed', code: res.status });
      } else {
        console.error(`FAIL ${op.method} ${op.path} (${res.status}) -> ${payload}`);
        results.push({
          op,
          status: 'failed',
          code: res.status,
          body: payload,
        });
      }
    } catch (error) {
      console.error(`ERROR ${op.method} ${op.path}: ${error.message}`);
      results.push({ op, status: 'failed', error: error.message });
    }
  }

  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  console.log(`\nSummary: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (failed > 0) {
    process.exit(1);
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
