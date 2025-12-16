#!/usr/bin/env ts-node
/* eslint-disable no-console */
import { config } from '../api/src/env';
import { DatabaseService } from '../api/src/services/database';
import { DomainEdgeService } from '../api/src/services/domain-edge';
import { DomainManager } from '../api/src/services/domain-manager';
import { domainHelpers } from '../api/src/services/domain';
import { DomainRecord } from '../api/src/types';

type RefreshOptions = {
  limit: number;
  domain?: string;
};

const parseArgs = (): RefreshOptions => {
  const args = process.argv.slice(2);
  const options: RefreshOptions = {
    limit: Number(process.env.HTTPS_REFRESH_LIMIT || 25),
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: npm run domains:refresh [--limit N] [--domain example.com]');
      process.exit(0);
    }
    if ((arg === '--limit' || arg === '-l') && args[i + 1]) {
      options.limit = Number(args[i + 1]);
      i += 1;
      continue;
    }
    if ((arg === '--domain' || arg === '-d') && args[i + 1]) {
      options.domain = args[i + 1];
      i += 1;
      continue;
    }
  }
  if (!Number.isFinite(options.limit) || options.limit <= 0) {
    options.limit = 25;
  }
  return options;
};

const logDomainStatus = (record: DomainRecord) => {
  const status = record.httpsStatus ?? 'pending';
  const cert = record.certificateStatus ?? 'unknown';
  const edge = record.edgeStatus ?? 'n/a';
  const edgeDomain = record.edgeDomain ?? '';
  const details = [
    `https=${status}`,
    `cert=${cert}`,
    `edge=${edge}`,
    edgeDomain ? `edgeDomain=${edgeDomain}` : null,
    record.routingError ? `error=${record.routingError}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  console.log(` - ${record.domain}: ${details}`);
};

const main = async () => {
  const options = parseArgs();
  const db = new DatabaseService();
  const edge = new DomainEdgeService({
    certificateRegion: config.domains.edge.certificateRegion,
    canonicalDefault: config.domains.edge.canonicalDefault,
    distributionId: config.domains.edge.distributionId,
  });
  const manager = new DomainManager({ db, edge });

  try {
    let targets: DomainRecord[] = [];
    if (options.domain) {
      const sanitized = domainHelpers.sanitizeDomainInput(options.domain);
      if (!sanitized) {
        throw new Error(`Invalid domain: ${options.domain}`);
      }
      const record = await db.getDomainByName(sanitized);
      if (!record) {
        console.log(`Domain ${sanitized} not found`);
        return;
      }
      targets = [record];
    } else {
      targets = await db.listDomainsNeedingHttpsRefresh(options.limit);
      if (!targets.length) {
        console.log('No domains need an HTTPS refresh.');
        return;
      }
    }

    console.log(`Refreshing HTTPS status for ${targets.length} domain(s)...`);
    let refreshed = 0;
    for (const record of targets) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const updated = await manager.refreshHttps(record);
        logDomainStatus(updated ?? record);
        refreshed += 1;
      } catch (error) {
        console.error(` - ${record.domain}: ${(error as Error).message}`);
      }
    }
    console.log(`Done. Updated ${refreshed}/${targets.length} domain(s).`);
  } finally {
    await db.close().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error('Domain HTTPS refresh failed:', error);
  process.exitCode = 1;
});
