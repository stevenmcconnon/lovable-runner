#!/usr/bin/env node
/* eslint-disable no-console */
const AWS = require('aws-sdk');

const rootRequire = (relativePath) =>
  // eslint-disable-next-line global-require, import/no-dynamic-require
  require(require('node:path').join(__dirname, '..', relativePath));

const { saveIntegrationToken } = rootRequire('src/integration-store.js');
const { patchAppointmentSettings } = rootRequire('src/appointments.js');
const { closePool } = rootRequire('src/pg-client.js');

const resolveTableName = () =>
  process.env.APPOINTMENT_SETTINGS_TABLE ||
  process.env.SITE_APPOINTMENT_SETTINGS_TABLE ||
  process.env.LOVABLE_APPOINTMENT_SETTINGS_TABLE ||
  null;

const tableName = resolveTableName();
if (!tableName) {
  console.error(
    '[integrations] APPOINTMENT_SETTINGS_TABLE (or SITE_APPOINTMENT_SETTINGS_TABLE) must be set.'
  );
  process.exit(1);
}

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    slugs: new Set(),
    limit: null,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: npm run integrations:migrate [--dry-run] [--slug my-site] [--limit 10]'
      );
      process.exit(0);
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if ((arg === '--slug' || arg === '-s') && args[i + 1]) {
      options.slugs.add(args[i + 1]);
      i += 1;
      continue;
    }
    if ((arg === '--limit' || arg === '-l') && args[i + 1]) {
      const parsed = Number(args[i + 1]);
      if (!Number.isNaN(parsed) && parsed > 0) {
        options.limit = parsed;
      }
      i += 1;
      continue;
    }
  }
  return {
    ...options,
    slugs: options.slugs.size ? Array.from(options.slugs) : null,
  };
};

if (!AWS.config.region && process.env.AWS_REGION) {
  AWS.config.update({ region: process.env.AWS_REGION });
}

const docClient = new AWS.DynamoDB.DocumentClient();

const scanSettings = async ({ slugs, limit }) => {
  let exclusiveStartKey;
  const results = [];
  do {
    const page = await docClient
      .scan({
        TableName: tableName,
        ExclusiveStartKey: exclusiveStartKey,
      })
      .promise();
    const items = page.Items || [];
    items.forEach((item) => {
      if (!item || !item.slug) return;
      if (slugs && !slugs.includes(item.slug)) return;
      if (!item.calendarProvider || !item.calendarToken) return;
      results.push(item);
    });
    exclusiveStartKey = page.LastEvaluatedKey;
    if (limit && results.length >= limit) break;
  } while (exclusiveStartKey);

  return limit ? results.slice(0, limit) : results;
};

const migrateRecord = async (record, { dryRun }) => {
  const slug = record.slug;
  const provider = record.calendarProvider;
  const accessToken = record.calendarToken;
  const refreshToken = record.calendarRefreshToken || null;
  const expiresAt = record.calendarExpiresAt || null;
  const metadata = {
    accountEmail: record.calendarAccountEmail || null,
    migratedAt: new Date().toISOString(),
    migratedFrom: 'appointment_settings',
  };
  console.log(`[integrations] Migrating ${provider} token for ${slug}${dryRun ? ' [dry-run]' : ''}`);
  if (dryRun) {
    return { slug, provider, migrated: false };
  }
  await saveIntegrationToken({
    slug,
    provider,
    accountId: record.accountId || null,
    scopes: record.calendarScopes || null,
    accessToken,
    refreshToken,
    expiresAt,
    providerUserId: record.calendarAccountEmail || null,
    metadata,
  });
  await patchAppointmentSettings({
    slug,
    updates: {
      calendarToken: null,
      calendarRefreshToken: null,
      calendarExpiresAt: null,
    },
  });
  return { slug, provider, migrated: true };
};

const run = async () => {
  const options = parseArgs();
  console.log(
    `[integrations] Scanning ${tableName} for stored calendar tokens${
      options.dryRun ? ' (dry run)' : ''
    }...`
  );
  const records = await scanSettings({ slugs: options.slugs, limit: options.limit });
  if (!records.length) {
    console.log('[integrations] No records require migration.');
    return;
  }
  let migrated = 0;
  for (const record of records) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await migrateRecord(record, options);
      if (result.migrated) migrated += 1;
    } catch (error) {
      console.error(
        `[integrations] Failed to migrate ${record.slug} (${record.calendarProvider})`,
        error.message
      );
    }
  }
  console.log(
    `[integrations] Migration complete. ${migrated} of ${records.length} record(s) migrated.`
  );
};

run()
  .catch((error) => {
    console.error('[integrations] Migration failed', error);
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => undefined));
