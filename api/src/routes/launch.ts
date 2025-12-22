import { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { RunnerService } from '../services/runner';
import { DatabaseService } from '../services/database';
import { config } from '../env';

const rootRequire = (relativePath: string): any => {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(path.join(process.cwd(), relativePath));
};

const { ensurePreviewPlaceholder } = rootRequire('src/preview-placeholder.js') as {
  ensurePreviewPlaceholder: (params: {
    bucket?: string | null;
    prefix?: string | null;
    brandName?: string | null;
    requestId?: string;
  }) => Promise<boolean>;
};
const { enforceRateLimit, RateLimitError } = rootRequire('src/rate-limit.js') as {
  enforceRateLimit: (params: {
    slug?: string | null;
    action: string;
    identifier: string;
    limit: number;
    windowMs?: number;
  }) => Promise<void>;
  RateLimitError: new (message?: string) => Error & { statusCode?: number };
};

const launchPayload = z
  .object({
    url: z.string().url().optional(),
    description: z.string().min(1).optional(),
    accountId: z.string().uuid().optional(),
    testMode: z.boolean().optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
    businessDetails: z
      .object({
        businessName: z.string().optional(),
        businessType: z.string().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        additionalDetails: z.string().optional(),
      })
      .optional(),
  })
  .refine((data) => Boolean(data.url || data.description), {
    message: 'url or description is required',
    path: ['url'],
  });

const s3Client = new S3Client({ region: config.awsRegion });

const slugify = (input?: string | null) =>
  (input || '')
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

export const buildSlugCandidate = (params: {
  businessDetails?: { businessName?: string | null; businessType?: string | null; phone?: string | null };
  url?: string | null;
  description?: string | null;
  requestId?: string | null;
}) => {
  if (params.businessDetails?.businessName) return slugify(params.businessDetails.businessName);
  if (params.url) return slugify(params.url);
  if (params.description) return slugify(params.description.slice(0, 50));
  if (params.requestId) return slugify(params.requestId);
  return slugify(`site-${Date.now()}`);
};

const extractHostname = (value?: string | null) => {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }
};

const derivePlaceholderLabel = (params: {
  businessDetails?: { businessName?: string | null } | null;
  url?: string | null;
  fallback?: string;
}) =>
  params.businessDetails?.businessName || extractHostname(params.url) || params.fallback || 'Preview site';

export const ensureUniqueSlug = async ({
  bucket,
  basePrefix,
  slugCandidate,
}: {
  bucket: string;
  basePrefix: string;
  slugCandidate: string;
}) => {
  const sanitizedBase = slugCandidate && slugCandidate.length ? slugCandidate : 'site';
  let attempt = 0;

  const buildPrefixPath = (slugValue: string) => {
    if (!slugValue) return '';
    return basePrefix ? `${basePrefix.replace(/\/$/, '')}/${slugValue}` : slugValue;
  };

  while (attempt < 20) {
    const candidate = attempt === 0 ? sanitizedBase : `${sanitizedBase}-${attempt}`;
    const prefixPath = buildPrefixPath(candidate);
    const existing = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${prefixPath}/`,
        MaxKeys: 1,
      })
    );
    if (!existing.Contents || existing.Contents.length === 0) {
      return { slug: candidate, prefixPath };
    }
    attempt += 1;
  }

  const fallback = `${sanitizedBase}-${Date.now()}`;
  return { slug: fallback, prefixPath: buildPrefixPath(fallback) };
};

export const buildPublicUrl = ({ bucket, prefix }: { bucket: string; prefix: string }) => {
  const normalizedPrefix = prefix ? `${prefix.replace(/\/+$/, '')}/` : '';
  const previewDomain = (process.env.PREVIEW_DOMAIN || '').trim().replace(/\/+$/, '');
  if (previewDomain) return `https://${previewDomain}/${normalizedPrefix}`;
  return `https://${bucket}.s3.amazonaws.com/${normalizedPrefix}`;
};

const unauthorized = (message: string) => {
  const error = new Error(message);
  // @ts-expect-error statusCode
  error.statusCode = 401;
  return error;
};

const forbidden = (message: string) => {
  const error = new Error(message);
  // @ts-expect-error statusCode
  error.statusCode = 403;
  return error;
};

const badRequest = (message: string) => {
  const error = new Error(message);
  // @ts-expect-error statusCode
  error.statusCode = 400;
  return error;
};

const deriveRequesterIp = (request: FastifyRequest) => {
  const forwarded = (request.headers['x-forwarded-for'] as string | undefined)?.split(',')?.[0]?.trim();
  return forwarded || request.ip || 'unknown';
};

const toDeterministicUuid = (key: string) => {
  const cleaned = key.trim();
  const hash = require('node:crypto').createHash('sha256').update(cleaned).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
};

const resolveAccountContext = (request: FastifyRequest, requestedAccountId?: string | null) => {
  if (request.auth?.type === 'user') {
    const accountId = request.auth.profile?.accountId;
    if (!accountId) {
      throw unauthorized('Account not found for user');
    }
    if (requestedAccountId && requestedAccountId !== accountId) {
      throw forbidden('You cannot launch sites for another account');
    }
    return {
      accountId,
      source: 'user' as const,
    };
  }
  if (request.auth?.type === 'machine') {
    if (!request.auth.permissions?.allowAccountContext) {
      throw forbidden('Machine token is not allowed to select account context');
    }
    if (!requestedAccountId) {
      throw badRequest('accountId is required for machine launches');
    }
    return {
      accountId: requestedAccountId,
      source: 'machine' as const,
    };
  }
  throw unauthorized('Authentication required');
};

export const registerLaunchRoutes = (
  app: FastifyInstance,
  deps: { db: DatabaseService; runner: RunnerService }
) => {
  const { db, runner } = deps;

  const launchPreHandler = async (request: FastifyRequest, reply: any) => {
    try {
      await app.authenticateUser(request, reply);
      return;
    } catch (userError) {
      try {
        await app.authenticateMachine(request, reply);
        if (request.auth?.type === 'machine' && !request.auth.permissions?.jobs?.run) {
          throw forbidden('Machine token missing jobs.run permission');
        }
      } catch {
        throw unauthorized((userError as Error)?.message || 'Authentication required');
      }
    }
  };

  app.post('/launch', { preHandler: launchPreHandler }, async (request, reply) => {
    const parsed = launchPayload.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid payload', details: parsed.error.flatten() });
    }
    const body = parsed.data;
    const requestId = body.idempotencyKey ? toDeterministicUuid(body.idempotencyKey) : randomUUID();
    const resolvedBucket =
      process.env.LOVABLE_DEPLOY_BUCKET ||
      process.env.DEPLOY_BUCKET ||
      process.env.TEMPLATE_UPLOAD_BUCKET;
    if (!resolvedBucket) {
      return reply.code(500).send({ message: 'Deploy bucket not configured' });
    }
    const basePrefix =
      process.env.LOVABLE_DEPLOY_PREFIX || process.env.DEPLOY_PREFIX || process.env.PREVIEW_ROOT_PREFIX || '';
    const desiredSlug = buildSlugCandidate({
      businessDetails: body.businessDetails,
      url: body.url,
      description: body.description,
      requestId,
    });
    const existing = await db.getSiteGenerationByRequestId(requestId);
    if (existing) {
      return reply.code(existing.status === 'completed' ? 200 : 202).send({
        status: existing.status,
        requestId,
        slug: existing.slug,
        prefix: existing.prefix,
        bucket: existing.bucket,
        publicUrl: existing.publicUrl,
        errorMessage: existing.errorMessage,
      });
    }
    const { slug, prefixPath } = await ensureUniqueSlug({
      bucket: resolvedBucket,
      basePrefix,
      slugCandidate: desiredSlug,
    });
    const publicUrl = buildPublicUrl({ bucket: resolvedBucket, prefix: prefixPath });
    const { accountId } = resolveAccountContext(request, body.accountId);
    const userId = request.auth?.profile?.id ?? null;
    const testMode = Boolean(body.testMode);
    const isMachine = request.auth?.type === 'machine';
    if (testMode && !isMachine) {
      return reply.code(403).send({ message: 'testMode is only available for machine credentials' });
    }
    if (process.env.LAUNCH_RATE_LIMIT_DISABLED !== 'true') {
      const perAccountLimit = Number(process.env.LAUNCH_PER_ACCOUNT_PER_MINUTE || 10);
      const perIpLimit = Number(process.env.LAUNCH_PER_IP_PER_MINUTE || 30);
      try {
        if (!isMachine && perAccountLimit > 0) {
          await enforceRateLimit({
            slug: null,
            action: 'launch:account',
            identifier: `acct:${accountId}`,
            limit: perAccountLimit,
            windowMs: 60 * 1000,
          });
        }
        if (perIpLimit > 0) {
          await enforceRateLimit({
            slug: null,
            action: 'launch:ip',
            identifier: `ip:${deriveRequesterIp(request)}`,
            limit: perIpLimit,
            windowMs: 60 * 1000,
          });
        }
      } catch (error) {
        if (error instanceof RateLimitError || (error as any)?.statusCode === 429) {
          return reply.code(429).send({
            message: 'Too many launch requests. Please wait a moment and try again.',
          });
        }
        throw error;
      }
    }
    const usageCost = 1;
    let subscription = null;
    let usage: any = null;
    let usageLimit = config.limits.trialEditLimit + config.limits.signedInBonusEdits;
    if (!isMachine) {
      subscription = await db.getSubscription(accountId);
      usageLimit = subscription?.monthlyEditLimit ?? usageLimit;
      const limits = db.buildUsageLimits(subscription, usageLimit);
      const existingSites = await db.listSiteGenerations(accountId);
      if (existingSites.length >= limits.freeSiteLimit) {
        return reply.code(402).send({
          message: 'Site limit exceeded',
          code: 'SITE_LIMIT_EXCEEDED',
          limits,
          sites: existingSites.length,
        });
      }
      usage = await db.getUsage(accountId, usageLimit);
      const remaining = subscription?.status === 'active'
        ? usage.remainingEdits
        : Math.max(usageLimit - usage.editsUsedThisPeriod, 0);
      const pendingReservations = await db.getPendingLaunchReservationTotal(accountId);
      const effectiveRemaining = remaining - pendingReservations;
      if (effectiveRemaining < usageCost) {
        return reply.code(402).send({
          message: 'Edit limit exceeded',
          code: 'LIMIT_EXCEEDED',
          limits: db.buildUsageLimits(subscription, usageLimit),
          usage,
        });
      }
    }
    await ensurePreviewPlaceholder({
      bucket: resolvedBucket,
      prefix: prefixPath,
      brandName: derivePlaceholderLabel({
        businessDetails: body.businessDetails,
        url: body.url,
        fallback: slug,
      }),
      requestId,
    });
    try {
      await db.createSiteGenerationRequest({
        requestId,
        accountId,
        userId,
        sourceUrl: body.url ?? null,
        description: body.description,
        businessDetails: body.businessDetails,
        slug,
        prefix: prefixPath,
        bucket: resolvedBucket,
      });
    } catch (error: any) {
      if ((error as any)?.code === '23505') {
        const existingGeneration = await db.getSiteGenerationByRequestId(requestId);
        if (existingGeneration) {
          return reply.code(existingGeneration.status === 'completed' ? 200 : 202).send({
            status: existingGeneration.status,
            requestId,
            slug: existingGeneration.slug,
            prefix: existingGeneration.prefix,
            bucket: existingGeneration.bucket,
            publicUrl: existingGeneration.publicUrl,
            errorMessage: existingGeneration.errorMessage,
          });
        }
      }
      throw error;
    }
    let reservedUsage = false;
    if (!isMachine && accountId) {
      await db
        .createLaunchReservation({
          accountId,
          requestId,
          cost: usageCost,
          limitSnapshot: usageLimit,
        })
        .then(() => {
          reservedUsage = true;
        })
        .catch((error) => {
          request.log.warn({ err: error }, '[launch] Failed to create usage reservation');
          throw error;
        });
    }
    try {
      await runner.runLaunchDirect({
        url: body.url,
        description: body.description,
        businessDetails: body.businessDetails,
        requestId,
        testMode,
        slug,
        prefix: prefixPath,
        bucket: resolvedBucket,
      });
      await db.touchSiteGenerationStage(requestId, 'running');
      return reply.code(202).send({ status: 'running', requestId, slug, prefix: prefixPath, bucket: resolvedBucket, publicUrl });
    } catch (error: any) {
      await db.updateSiteGeneration(requestId, {
        status: 'failed',
        errorMessage: error?.message ?? 'Failed to start launch',
      });
      if (reservedUsage && accountId) {
        await db.releaseLaunchReservation(requestId, error?.message).catch((releaseError) =>
          request.log.warn(
            { err: releaseError, requestId },
            '[launch] Failed to release usage reservation'
          )
        );
      }
      throw error;
    }
  });
};
