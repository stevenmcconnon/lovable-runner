import { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { RunnerService } from '../services/runner';
import { DatabaseService } from '../services/database';
import { config } from '../env';

const launchPayload = z
  .object({
    url: z.string().url().optional(),
    description: z.string().min(1).optional(),
    accountId: z.string().uuid().optional(),
    testMode: z.boolean().optional(),
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

const toUuidFromHash = (hash: string) =>
  `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;

export const deriveAnonymousAccountId = (request: FastifyRequest) => {
  const forwarded = (request.headers['x-forwarded-for'] as string | undefined)?.split(',')?.[0]?.trim();
  const visitorHeader =
    (request.headers['x-visitor-id'] as string | undefined) ||
    (request.headers['x-visitor-token'] as string | undefined);
  const raw = visitorHeader || forwarded || request.ip || randomUUID();
  const hash = createHash('sha256').update(raw).digest('hex');
  return toUuidFromHash(hash);
};

export const registerLaunchRoutes = (
  app: FastifyInstance,
  deps: { db: DatabaseService; runner: RunnerService }
) => {
  const { db, runner } = deps;

  const launchPreHandler = async (request: any, reply: any) => {
    try {
      await app.authenticateUser(request, reply);
      request.launchAuthContext = 'user';
      return;
    } catch {
      /* continue */
    }
    try {
      await app.authenticateMachine(request, reply);
      request.launchAuthContext = 'machine';
    } catch {
      request.launchAuthContext = 'anonymous';
    }
  };

  app.post('/launch', { preHandler: launchPreHandler }, async (request, reply) => {
    const parsed = launchPayload.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid payload', details: parsed.error.flatten() });
    }
    const body = parsed.data;
    const requestId = randomUUID();
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
    const { slug, prefixPath } = await ensureUniqueSlug({
      bucket: resolvedBucket,
      basePrefix,
      slugCandidate: desiredSlug,
    });
    const publicUrl = buildPublicUrl({ bucket: resolvedBucket, prefix: prefixPath });
    const launchContext = (request as any).launchAuthContext || 'anonymous';
    const profileAccountId = request.auth?.profile?.accountId ?? null;
    const profileUserId = request.auth?.profile?.id ?? null;
    const accountId =
      body.accountId ??
      profileAccountId ??
      (launchContext === 'anonymous' ? deriveAnonymousAccountId(request) : null);
    const userId = profileUserId;
    const testMode = Boolean(body.testMode);
    if (testMode && launchContext !== 'machine') {
      return reply.code(403).send({ message: 'testMode is only available for machine credentials' });
    }
    let subscription = null;
    let usage: any = null;
    let usageLimit = launchContext === 'anonymous'
      ? config.limits.anonymousLaunchLimit
      : config.limits.trialEditLimit + config.limits.signedInBonusEdits;
    if (launchContext !== 'machine' && accountId) {
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
      if (remaining <= 0) {
        return reply.code(402).send({
          message: 'Edit limit exceeded',
          code: 'LIMIT_EXCEEDED',
          limits: db.buildUsageLimits(subscription, usageLimit),
          usage,
        });
      }
    }
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
    if (launchContext !== 'machine' && accountId) {
      await db.incrementUsage(accountId, usageLimit, 1).catch((error) => {
        request.log.warn({ err: error }, '[launch] Failed to increment usage');
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
      throw error;
    }
  });
};
