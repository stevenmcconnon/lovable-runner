#!/usr/bin/env node

const { Pool } = require('pg');
const crypto = require('node:crypto');

const buildConnectionString = () => {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (
    process.env.DB_HOST &&
    process.env.DB_USERNAME &&
    process.env.DB_PASSWORD &&
    process.env.DB_NAME
  ) {
    const port = process.env.DB_PORT || '5432';
    return `postgresql://${encodeURIComponent(process.env.DB_USERNAME)}:${encodeURIComponent(
      process.env.DB_PASSWORD
    )}@${process.env.DB_HOST}:${port}/${process.env.DB_NAME}`;
  }
  return null;
};

const connectionString = buildConnectionString();
if (!connectionString) {
  console.error('Set DATABASE_URL or DB_HOST/DB_USERNAME/DB_PASSWORD/DB_NAME before running.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl:
    process.env.NODE_ENV === 'production' || process.env.PGSSLMODE === 'require'
      ? { rejectUnauthorized: false }
      : undefined,
});

const query = (text, params = []) => pool.query(text, params);

const recordJobEvent = async (event) => {
  await query(
    `
    INSERT INTO job_events (type, slug, account_id, request_id, action, status, description, metadata, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT DO NOTHING
  `,
    [
      event.type,
      event.slug ?? null,
      event.accountId ?? null,
      event.requestId ?? null,
      event.action,
      event.status,
      event.description ?? null,
      event.metadata ? JSON.stringify(event.metadata) : null,
      event.createdAt ?? new Date().toISOString(),
    ]
  );
};

const main = async () => {
  console.log('[job-events] backfill started');
  const { rows } = await query(
    `
    SELECT request_id, account_id, slug, status, created_at, updated_at, error_message
    FROM site_generations
    WHERE request_id IS NOT NULL
  `
  );
  let count = 0;
  for (const row of rows) {
    const baseEvent = {
      type: 'site_generation',
      slug: row.slug,
      accountId: row.account_id,
      requestId: row.request_id,
    };
    await recordJobEvent({
      ...baseEvent,
      action: 'CREATE',
      status: 'queued',
      createdAt: row.created_at,
    });
    await recordJobEvent({
      ...baseEvent,
      action: 'COMPLETE',
      status: row.status || 'unknown',
      description: row.error_message || null,
      createdAt: row.updated_at,
    });
    count += 2;
    if (count % 500 === 0) {
      console.log(`[job-events] processed ${count} records`);
    }
  }
  console.log(`[job-events] backfill complete (${count} inserts)`);
};

main()
  .catch((error) => {
    console.error('[job-events] Failed to backfill', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
