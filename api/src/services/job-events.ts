import path from 'node:path';

const rootRequire = (relativePath: string): any => {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(path.join(process.cwd(), relativePath));
  } catch {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(path.join(__dirname, '..', '..', relativePath));
  }
};

const { recordJobEvent } = rootRequire('src/audit-log.js') as {
  recordJobEvent: (params: {
    type: string;
    slug?: string | null;
    accountId?: string | null;
    requestId?: string | null;
    jobId?: string | null;
    action: string;
    status: string;
    description?: string | null;
    metadata?: Record<string, unknown> | null;
    createdAt?: string | null;
  }) => Promise<void>;
};

type JobEventPayload = {
  type: string;
  slug?: string | null;
  accountId?: string | null;
  requestId?: string | null;
  jobId?: string | null;
  action: string;
  status: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string | Date | null;
};

export const jobEvents = {
  async record(event: JobEventPayload): Promise<void> {
    try {
      await recordJobEvent({
        ...event,
        createdAt:
          event.createdAt instanceof Date
            ? event.createdAt.toISOString()
            : event.createdAt ?? new Date().toISOString(),
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[job-events] record.failed', {
        type: event.type,
        action: event.action,
        slug: event.slug,
        err: (error as Error)?.message,
      });
      throw error;
    }
  },
};
