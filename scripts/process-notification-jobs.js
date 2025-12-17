#!/usr/bin/env node
/* eslint-disable no-console */
const { runNotificationBatch } = require('../src/notification-worker');

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    limit: Number(process.env.NOTIFICATION_BATCH_LIMIT || 25),
    dryRun: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: npm run notifications:work [--limit N] [--dry-run]');
      process.exit(0);
    }
    if ((arg === '--limit' || arg === '-l') && args[i + 1]) {
      options.limit = Number(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
    }
  }
  if (!Number.isFinite(options.limit) || options.limit <= 0) {
    options.limit = 25;
  }
  return options;
};

const main = async () => {
  const options = parseArgs();
  const result = await runNotificationBatch({
    limit: options.limit,
    dryRun: options.dryRun,
  });
  console.log(
    `[notifications] Completed batch. Claimed=${result.claimed} Sent=${result.sent} Failed=${result.failed}`
  );
};

main()
  .catch((error) => {
    console.error('Notification worker failed', error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
