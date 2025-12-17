import { DomainJobRecord } from '../types';
import { DatabaseService } from './database';
import { DomainManager } from './domain-manager';
import { DomainJobService } from './domain-job';
import { CanonicalMode } from './domain-edge';

const DEFAULT_PROVISION_RETRY_MS = Number(process.env.DOMAIN_CERT_RETRY_MS || 5 * 60 * 1000);
const DEFAULT_EDGE_RETRY_MS = Number(process.env.DOMAIN_EDGE_RETRY_MS || 2 * 60 * 1000);
const DEFAULT_MAX_RUNTIME_MS = Math.max(
  1000,
  Number(process.env.DOMAIN_JOB_MAX_RUNTIME_MS || 60 * 1000)
);
const MAX_PROVISION_ATTEMPTS = Math.max(3, Number(process.env.DOMAIN_CERT_MAX_ATTEMPTS || 24));
const MAX_EDGE_ATTEMPTS = Math.max(3, Number(process.env.DOMAIN_EDGE_MAX_ATTEMPTS || 36));
const MAX_RETRY_DELAY_MS = Math.max(
  DEFAULT_PROVISION_RETRY_MS,
  Number(process.env.DOMAIN_JOB_MAX_RETRY_DELAY_MS || 30 * 60 * 1000)
);

export class DomainJobRunner {
  constructor(
    private readonly deps: {
      db: DatabaseService;
      manager: DomainManager;
      jobs: DomainJobService;
    }
  ) {}

  async runBatch(
    limit = 10,
    options: { maxRuntimeMs?: number } = {}
  ): Promise<{ processed: number; completed: number; retried: number }> {
    const releaseLock = await this.deps.db.acquireDomainJobLock();
    if (!releaseLock) {
      // eslint-disable-next-line no-console
      console.warn('[domain-jobs] another worker is already running; skipping this batch');
      return { processed: 0, completed: 0, retried: 0 };
    }
    try {
      const jobs = await this.deps.jobs.claimBatch(limit);
      let completed = 0;
      let retried = 0;
      let processed = 0;
      const startedAt = Date.now();
      const maxRuntimeMs = Math.max(1000, Number(options.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS));
      for (const job of jobs) {
        const elapsed = Date.now() - startedAt;
        if (elapsed >= maxRuntimeMs) {
          // eslint-disable-next-line no-await-in-loop
          await this.deferJob(job);
          retried += 1;
          processed += 1;
          continue;
        }
        try {
          // eslint-disable-next-line no-await-in-loop
          const outcome = await this.processJob(job);
          if (outcome === 'completed') completed += 1;
          if (outcome === 'retry') retried += 1;
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('[domain-jobs] job.failed', {
            jobId: job.id,
            domain: job.domain,
            type: job.type,
            err: (error as Error)?.message,
          });
          // eslint-disable-next-line no-await-in-loop
          await this.deps.jobs
            .markFailed(job.id, (error as Error)?.message)
            .catch(() => undefined);
        } finally {
          processed += 1;
        }
      }
      return { processed, completed, retried };
    } finally {
      await releaseLock().catch(() => undefined);
    }
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
    if (job.attempts >= MAX_PROVISION_ATTEMPTS) {
      await this.failDomainLifecycle(job.domain, 'Certificate validation timed out');
      await this.deps.jobs.markFailed(job.id, 'Certificate validation timed out');
      return 'completed';
    }
    await this.deps.jobs.scheduleRetry(job.id, {
      delayMs: this.computeBackoff(job, DEFAULT_PROVISION_RETRY_MS),
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
    if (job.attempts >= MAX_EDGE_ATTEMPTS) {
      const reason =
        finalRecord.routingError ||
        `HTTPS provisioning still ${httpsStatus} after ${job.attempts} attempts`;
      await this.failDomainLifecycle(job.domain, reason);
      await this.deps.jobs.markFailed(job.id, reason);
      return 'completed';
    }
    await this.deps.jobs.scheduleRetry(job.id, {
      delayMs: this.computeBackoff(job, DEFAULT_EDGE_RETRY_MS),
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

  private async deferJob(job: DomainJobRecord): Promise<void> {
    try {
      await this.deps.jobs.scheduleRetry(job.id, {
        delayMs: DEFAULT_EDGE_RETRY_MS,
        error: 'Domain job runner exceeded max runtime window',
        status: 'retry',
      });
    } catch (error) {
      await this.deps.jobs
        .markFailed(
          job.id,
          `Unable to reschedule domain job after runtime cap: ${(error as Error)?.message ?? 'unknown'}`
        )
        .catch(() => undefined);
    }
  }

  private computeBackoff(job: DomainJobRecord, baseDelay: number): number {
    const attemptIndex = Math.max(0, (job.attempts || 1) - 1);
    const multiplier = Math.pow(2, Math.min(attemptIndex, 4));
    const delay = baseDelay * multiplier;
    return Math.min(delay, MAX_RETRY_DELAY_MS);
  }

  private async failDomainLifecycle(domain: string, reason: string): Promise<void> {
    const now = new Date().toISOString();
    // eslint-disable-next-line no-console
    console.error('[domain-jobs] domain.lifecycle.failed', {
      domain,
      reason,
    });
    await this.deps.db
      .updateSiteDomain(domain, {
        status: 'failed',
        routingError: reason,
        lastCheckedAt: now,
      })
      .catch(() => undefined);
    await this.deps.jobs
      .recordEvent({
        domain,
        type: 'domain.job.failed',
        status: 'failed',
        description: reason,
      })
      .catch(() => undefined);
  }
}
