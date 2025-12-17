#!/usr/bin/env node
/* eslint-disable no-console */
const path = require('node:path');

const rootRequire = (relativePath) =>
  // eslint-disable-next-line global-require, import/no-dynamic-require
  require(path.join(__dirname, '..', relativePath));

const { rollupForDate, rollupDateRange, rollupPreviousDay } = rootRequire('src/analytics-rollup.js');
const { closePool } = rootRequire('src/pg-client.js');

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: npm run analytics:rollup [--date YYYY-MM-DD] [--start YYYY-MM-DD --end YYYY-MM-DD]');
      process.exit(0);
    }
    if ((arg === '--date' || arg === '-d') && args[i + 1]) {
      options.date = args[i + 1];
      i += 1;
      continue;
    }
    if ((arg === '--start' || arg === '-s') && args[i + 1]) {
      options.start = args[i + 1];
      i += 1;
      continue;
    }
    if ((arg === '--end' || arg === '-e') && args[i + 1]) {
      options.end = args[i + 1];
      i += 1;
      continue;
    }
  }
  return options;
};

const main = async () => {
  const options = parseArgs();
  if (options.start || options.end) {
    if (!options.start || !options.end) {
      throw new Error('--start and --end must be used together');
    }
    const results = await rollupDateRange({
      startDate: options.start,
      endDate: options.end,
    });
    console.log(
      `[analytics] Rolled up ${results.length} day(s).`,
      results.map((entry) => `${entry.statDate}:${entry.processed}`).join(', ')
    );
    return;
  }
  if (options.date) {
    const result = await rollupForDate(options.date);
    console.log(`[analytics] Rolled up ${result.statDate} (${result.processed} row(s))`);
    return;
  }
  const result = await rollupPreviousDay();
  console.log(`[analytics] Rolled up ${result.statDate} (${result.processed} row(s))`);
};

main()
  .catch((error) => {
    console.error('[analytics] Rollup failed', error);
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => undefined));
