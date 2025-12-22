const { Pool } = require('pg');

let primaryPool = null;
let analyticsPool = null;

const buildConnectionOptions = () => {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  const host = process.env.DB_HOST;
  const port = process.env.DB_PORT;
  const database = process.env.DB_NAME;
  const user = process.env.DB_USERNAME;
  const password = process.env.DB_PASSWORD;
  if (!host || !database || !user || !password) {
    throw new Error(
      'DATABASE_URL or DB_HOST/DB_PORT/DB_NAME/DB_USERNAME/DB_PASSWORD must be set for Postgres access.'
    );
  }
  return {
    host,
    port: port ? Number(port) : 5432,
    database,
    user,
    password,
  };
};

const buildAnalyticsConnectionOptions = () => {
  if (process.env.ANALYTICS_DATABASE_URL) {
    return { connectionString: process.env.ANALYTICS_DATABASE_URL };
  }
  return buildConnectionOptions();
};

const createPool = (options) => {
  const pool = new Pool({
    ...options,
    max: Number(process.env.PG_POOL_MAX || 5),
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  });
  pool.on('error', (error) => {
    console.error('[pg-client] Idle client error', error);
  });
  return pool;
};

const getPool = () => {
  if (primaryPool) return primaryPool;
  const options = buildConnectionOptions();
  primaryPool = createPool(options);
  return primaryPool;
};

const getAnalyticsPool = () => {
  const shouldFork =
    process.env.ANALYTICS_DATABASE_URL &&
    process.env.ANALYTICS_DATABASE_URL !== process.env.DATABASE_URL;
  if (!shouldFork) {
    return getPool();
  }
  if (analyticsPool) return analyticsPool;
  analyticsPool = createPool(buildAnalyticsConnectionOptions());
  return analyticsPool;
};

const query = (text, params) => getPool().query(text, params);
const analyticsQuery = (text, params) => getAnalyticsPool().query(text, params);

const closePool = async () => {
  const pools = [primaryPool, analyticsPool];
  primaryPool = null;
  analyticsPool = null;
  await Promise.all(
    pools
      .filter(Boolean)
      .map((pool) =>
        pool
          .end()
          .catch((error) => console.error('[pg-client] Failed to close pool', error))
      )
  );
};

module.exports = { getPool, query, closePool, analyticsQuery };
