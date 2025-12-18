import { DatabaseService } from './database';
import { DomainJobRecord, DomainJobType } from '../types';
import { jobEvents } from './job-events';

type EnqueueParams = {
  domain: string;
  slug?: string | null;
  canonicalMode?: string | null;
  canonicalHost?: string | null;
  delayMs?: number;
};

export class DomainJobService {
  constructor(private readonly db: DatabaseService) {}

  async enqueueProvisionJob(params: EnqueueParams): Promise<DomainJobRecord> {
    const job = await this.db.enqueueDomainJob({
      domain: params.domain,
      slug: params.slug ?? null,
      type: 'provision_certificate',
      payload: {
        canonicalMode: params.canonicalMode ?? null,
        canonicalHost: params.canonicalHost ?? null,
      },
      scheduleAt: params.delayMs ? new Date(Date.now() + params.delayMs) : undefined,
    });
    jobEvents
      .record({
        type: 'domain_job',
        slug: params.slug ?? null,
        action: 'ENQUEUED',
        status: 'pending',
        jobId: job.id,
        metadata: {
          domain: params.domain,
          jobType: 'provision_certificate',
        },
      })
      .catch(() => undefined);
    return job;
  }

  async enqueueEdgeSyncJob(params: EnqueueParams): Promise<DomainJobRecord> {
    const job = await this.db.enqueueDomainJob({
      domain: params.domain,
      slug: params.slug ?? null,
      type: 'sync_edge',
      payload: {},
      scheduleAt: params.delayMs ? new Date(Date.now() + params.delayMs) : undefined,
    });
    jobEvents
      .record({
        type: 'domain_job',
        slug: params.slug ?? null,
        action: 'ENQUEUED',
        status: 'pending',
        jobId: job.id,
        metadata: {
          domain: params.domain,
          jobType: 'sync_edge',
        },
      })
      .catch(() => undefined);
    return job;
  }

  async claimBatch(limit = 10): Promise<DomainJobRecord[]> {
    return this.db.claimDomainJobs(limit);
  }

  async markCompleted(jobId: string): Promise<DomainJobRecord | null> {
    return this.db.completeDomainJob(jobId);
  }

  async scheduleRetry(
    jobId: string,
    options: { delayMs?: number; error?: string; status?: 'retry' | 'pending'; terminal?: boolean }
  ): Promise<DomainJobRecord | null> {
    if (options.terminal) {
      return this.db.failDomainJob(jobId, options.error);
    }
    return this.db.retryDomainJob(jobId, {
      delayMs: options.delayMs,
      error: options.error,
      status: options.status,
    });
  }

  async markFailed(jobId: string, error?: string): Promise<DomainJobRecord | null> {
    return this.db.failDomainJob(jobId, error);
  }

  async recordEvent(params: {
    domain: string;
    slug?: string | null;
    type: string;
    status?: string | null;
    description?: string | null;
    metadata?: Record<string, unknown> | null;
  }) {
    await this.db.recordDomainEvent(params);
  }
}
