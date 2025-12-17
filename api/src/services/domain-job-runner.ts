import { DomainJobRecord } from '../types';
import { DatabaseService } from './database';
import { DomainManager } from './domain-manager';
import { DomainJobService } from './domain-job';
import { CanonicalMode } from './domain-edge';

const DEFAULT_PROVISION_RETRY_MS = Number(process.env.DOMAIN_CERT_RETRY_MS || 5 * 60 * 1000);
const DEFAULT_EDGE_RETRY_MS = Number(process.env.DOMAIN_EDGE_RETRY_MS || 2 * 60 * 1000);

export class DomainJobRunner {
  constructor(
    private readonly deps: {
      db: DatabaseService;
      manager: DomainManager;
      jobs: DomainJobService;
    }
  ) {}

  async runBatch(limit = 10): Promise<{ processed: number; completed: number; retried: number }> {
    const jobs = await this.deps.jobs.claimBatch(limit);
    let completed = 0;
    let retried = 0;
    for (const job of jobs) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const outcome = await this.processJob(job);
        if (outcome === 'completed') completed += 1;
        if (outcome === 'retry') retried += 1;
      } catch (error) {
        // eslint-disable-next-line no-await-in-loop
        await this.deps.jobs
          .markFailed(job.id, (error as Error)?.message)
          .catch(() => undefined);
      }
    }
    return { processed: jobs.length, completed, retried };
  }

  private async processJob(job: DomainJobRecord): Promise<'completed' | 'retry'> {
    switch (job.type) {
      case 'provision_certificate':
        return this.handleProvisionJob(job);
      case 'sync_edge':
        return this.handleEdgeJob(job);
      default:
        await this.deps.jobs.markFailed(job.id, `Unsupported domain job type: ${job.type}`);
        return 'retry';
    }
  }

  private async handleProvisionJob(job: DomainJobRecord): Promise<'completed' | 'retry'> {
    const payload = (job.payload || {}) as { canonicalMode?: string | null; canonicalHost?: string | null };
    const canonicalMode = this.normalizeCanonicalMode(payload.canonicalMode);
    const result = await this.deps.manager.ensureCertificateForDomain({
      domain: job.domain,
      canonicalMode,
      canonicalHost: payload.canonicalHost || undefined,
    });
    await this.deps.jobs.recordEvent({
      domain: job.domain,
      slug: job.slug ?? null,
      type: 'domain.job.provision_certificate',
      status: result.certificate?.status ?? 'unknown',
      description: `Certificate status for ${job.domain} is ${result.certificate?.status ?? 'unknown'}`,
    });
    if (result.certificate?.status === 'ISSUED') {
      await this.deps.jobs.enqueueEdgeSyncJob({
        domain: job.domain,
        slug: job.slug ?? null,
      });
      await this.deps.jobs.markCompleted(job.id);
      return 'completed';
    }
    await this.deps.jobs.scheduleRetry(job.id, {
      delayMs: DEFAULT_PROVISION_RETRY_MS,
      error: 'Certificate pending validation',
    });
    return 'retry';
  }

  private async handleEdgeJob(job: DomainJobRecord): Promise<'completed' | 'retry'> {
    const record = await this.deps.db.getDomainByName(job.domain);
    if (!record) {
      await this.deps.jobs.markFailed(job.id, 'Domain record not found');
      return 'retry';
    }
    const updated = await this.deps.manager.refreshHttps(record);
    const finalRecord = updated ?? record;
    const httpsStatus = finalRecord.httpsStatus ?? 'pending';
    await this.deps.jobs.recordEvent({
      domain: job.domain,
      slug: job.slug ?? null,
      type: 'domain.job.sync_edge',
      status: httpsStatus,
      description: `HTTPS status for ${job.domain} is ${httpsStatus}`,
    });
    if (httpsStatus === 'live') {
      await this.deps.jobs.markCompleted(job.id);
      return 'completed';
    }
    await this.deps.jobs.scheduleRetry(job.id, {
      delayMs: DEFAULT_EDGE_RETRY_MS,
      error: `HTTPS status ${httpsStatus}`,
    });
    return 'retry';
  }

  private normalizeCanonicalMode(value?: string | null): CanonicalMode | undefined {
    if (!value) return undefined;
    if (value.toLowerCase() === 'www') return 'www';
    if (value.toLowerCase() === 'apex') return 'apex';
    return undefined;
  }
}
