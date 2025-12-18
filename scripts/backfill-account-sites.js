#!/usr/bin/env node

const { Pool } = require('pg');

const connectionString =
  process.env.DATABASE_URL ||
  process.env.DB_URL ||
  (process.env.DB_HOST
    ? `postgresql://${process.env.DB_USERNAME || process.env.DB_USER || 'postgres'}:${encodeURIComponent(
        process.env.DB_PASSWORD || ''
      )}@${process.env.DB_HOST}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'postgres'}`
    : null);

if (!connectionString) {
  console.error('DATABASE_URL or DB_HOST/DB_USERNAME/DB_PASSWORD must be set.');
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

const upsertAccountSite = async (record) => {
  await query(
    `
    INSERT INTO account_sites (account_id, slug, created_at)
    VALUES ($1,$2,$3)
    ON CONFLICT (account_id, slug)
    DO UPDATE SET created_at = LEAST(account_sites.created_at, EXCLUDED.created_at)
  `,
    [record.account_id, record.slug, record.created_at]
  );
};

const main = async () => {
  console.log('[backfill] Loading site generations...');
  const { rows } = await query(
    `
    SELECT account_id, slug, MIN(created_at) AS created_at
    FROM site_generations
    WHERE account_id IS NOT NULL
      AND slug IS NOT NULL
    GROUP BY account_id, slug
    ORDER BY MIN(created_at)
  `
  );
  console.log(`[backfill] Found ${rows.length} account/site pairs to process`);
  let processed = 0;
  for (const row of rows) {
    await upsertAccountSite(row);
    processed += 1;
    if (processed % 200 === 0) {
      console.log(`[backfill] Processed ${processed}/${rows.length}`);
    }
  }
  console.log(`[backfill] Completed ${processed} inserts/updates`);
};

main()
  .catch((error) => {
    console.error('[backfill] Failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
