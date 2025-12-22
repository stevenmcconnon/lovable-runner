#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { query, closePool } = require('../src/pg-client');

const migrationsDir = path.join(__dirname, '..', 'infra', 'db', 'migrations');

const loadMigrations = () =>
  fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();

const ensureSchemaTable = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
};

const hasRun = async (version) => {
  const result = await query(
    `
    SELECT 1 FROM schema_migrations
    WHERE version = $1
    LIMIT 1
  `,
    [version]
  );
  return result.rowCount > 0;
};

const applyMigration = async (version, sql) => {
  console.log(`[migrate] Applying ${version}`);
  await query('BEGIN');
  try {
    await query(sql);
    await query(
      `
      INSERT INTO schema_migrations (version)
      VALUES ($1)
    `,
      [version]
    );
    await query('COMMIT');
  } catch (error) {
    await query('ROLLBACK').catch(() => {});
    throw error;
  }
};

const run = async () => {
  await ensureSchemaTable();
  const migrations = loadMigrations();
  for (const file of migrations) {
    const version = path.basename(file, '.sql');
    // eslint-disable-next-line no-await-in-loop
    const alreadyRun = await hasRun(version);
    if (alreadyRun) {
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    if (!sql.trim()) {
      console.log(`[migrate] Skipping empty migration ${file}`);
      // eslint-disable-next-line no-await-in-loop
      await query(
        `
        INSERT INTO schema_migrations (version)
        VALUES ($1)
      `,
        [version]
      );
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await applyMigration(version, sql);
  }
  console.log('[migrate] Done');
};

run()
  .catch((error) => {
    console.error('[migrate] Failed', error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
