import { EditJobRecord, SiteGenerationRecord } from '../types';

const RECENT_MS = 10 * 60 * 1000; // 10 minutes

const isRecent = (timestamp?: string | null) => {
  if (!timestamp) return false;
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed < RECENT_MS;
};

type LaunchGuard =
  | { skip: true; response: Record<string, unknown> }
  | { skip: false; response?: undefined };

type JobGuard =
  | { skip: true; response: Record<string, unknown> }
  | { skip: false; response?: undefined };

export const resolveLaunchIdempotency = (record?: SiteGenerationRecord | null): LaunchGuard => {
  if (!record) return { skip: false };
  const status = (record.status || '').toLowerCase();
  if (status === 'completed') {
    return {
      skip: true,
      response: {
        requestId: record.requestId,
        status: record.status,
        slug: record.slug,
        bucket: record.bucket,
        prefix: record.prefix,
        publicUrl: record.publicUrl,
      },
    };
  }
  if (status === 'failed') {
    return {
      skip: true,
      response: {
        requestId: record.requestId,
        status: record.status,
        errorMessage: record.errorMessage || null,
      },
    };
  }
  if (status === 'running' && isRecent(record.updatedAt)) {
    return {
      skip: true,
      response: {
        requestId: record.requestId,
        status: record.status,
        slug: record.slug,
        publicUrl: record.publicUrl,
      },
    };
  }
  return { skip: false };
};

export const resolveEditJobIdempotency = (record?: EditJobRecord | null): JobGuard => {
  if (!record) return { skip: false };
  const status = (record.status || '').toLowerCase();
  if (status === 'completed') {
    return {
      skip: true,
      response: {
        jobId: record.id,
        status: record.status,
        previewUrl: record.previewUrl,
        lovableProjectId: record.lovableProjectId,
        s3Key: record.s3Key,
      },
    };
  }
  if (status === 'failed') {
    return {
      skip: true,
      response: {
        jobId: record.id,
        status: record.status,
        errorMessage: record.errorMessage || null,
      },
    };
  }
  if (status === 'running' && isRecent(record.updatedAt)) {
    return {
      skip: true,
      response: {
        jobId: record.id,
        status: record.status,
      },
    };
  }
  return { skip: false };
};
