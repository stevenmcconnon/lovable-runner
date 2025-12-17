const { Pool } = require('pg');

let pool = null;

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
    throw new Error('DATABASE_URL or DB_HOST/DB_PORT/DB_NAME/DB_USERNAME/DB_PASSWORD must be set for Postgres access.');
  }
  return {
    host,
    port: port ? Number(port) : 5432,
    database,
    user,
    password,
  };
};

const getPool = () => {
  if (pool) return pool;
  const options = buildConnectionOptions();
  pool = new Pool({
    ...options,
    max: Number(process.env.PG_POOL_MAX || 5),
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  });
  pool.on('error', (error) => {
    console.error('[pg-client] Idle client error', error);
  });
  return pool;
};

const query = (text, params) => getPool().query(text, params);

const closePool = async () => {
  if (!pool) return;
  await pool.end();
  pool = null;
};

module.exports = { getPool, query, closePool };
