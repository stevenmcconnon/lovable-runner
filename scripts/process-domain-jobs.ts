#!/usr/bin/env ts-node
/* eslint-disable no-console */
import { config } from '../api/src/env';
import { DatabaseService } from '../api/src/services/database';
import { DomainEdgeService } from '../api/src/services/domain-edge';
import { DomainManager } from '../api/src/services/domain-manager';
import { DomainJobService } from '../api/src/services/domain-job';
import { DomainJobRunner } from '../api/src/services/domain-job-runner';
import { DomainJobDispatcher } from '../api/src/services/domain-job-dispatcher';

const parseLimit = () => {
  const argIndex = process.argv.findIndex((arg) => arg === '--limit' || arg === '-l');
  if (argIndex !== -1 && process.argv[argIndex + 1]) {
    const value = Number(process.argv[argIndex + 1]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return config.domains.jobs.batchLimit;
};

const main = async () => {
  const limit = parseLimit();
  const db = new DatabaseService();
  const edge = new DomainEdgeService({
    certificateRegion: config.domains.edge.certificateRegion,
    canonicalDefault: config.domains.edge.canonicalDefault,
    distributionId: config.domains.edge.distributionId,
  });
  const dispatcher = config.queues.domainJobs
    ? new DomainJobDispatcher(config.queues.domainJobs, config.awsRegion)
    : undefined;
  const jobs = new DomainJobService(db, { dispatcher });
  const manager = new DomainManager({ db, edge });
  const runner = new DomainJobRunner({ db, jobs, manager });
  try {
    const result = await runner.runBatch(limit, {
      maxRuntimeMs: config.domains.jobs.maxRuntimeMs,
    });
    console.log(
      `Processed ${result.processed} domain job(s): completed=${result.completed}, retried=${result.retried}`
    );
  } finally {
    await db.close().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error('Domain job processing failed:', error);
  process.exitCode = 1;
});
