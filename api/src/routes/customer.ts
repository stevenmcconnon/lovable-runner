import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../env';
import { RunnerService } from '../services/runner';
import { DatabaseService } from '../services/database';
import { UserRole } from '../types';
import { buildSlugCandidate, ensureUniqueSlug, buildPublicUrl } from './launch';

const rootRequire = (relativePath: string): any => {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(require('node:path').join(process.cwd(), relativePath));
};

const { loadSiteConfig } = rootRequire('src/site-store.js') as {
  loadSiteConfig: (slug: string) => Promise<any>;
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

const businessDetailsSchema = z
  .object({
    businessName: z.string().max(255).optional(),
    businessType: z.string().max(255).optional(),
    phone: z.string().max(64).optional(),
    address: z.string().max(255).optional(),
    additionalDetails: z.string().max(2000).optional(),
  })
  .optional();

const editRequestInput = z.object({
  description: z.string().min(10).max(2000),
  siteId: z.string().optional(),
  business: businessDetailsSchema,
});

const siteLaunchInput = z.object({
  url: z.string().url(),
  description: z.string().max(2000).optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
  business: businessDetailsSchema,
});

const siteListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  includeMeta: z.string().optional(),
});

const trialAllowance = () => config.limits.trialEditLimit + config.limits.signedInBonusEdits;

const buildThumbnailUrl = (publicUrl: string, refresh?: boolean) => {
  const base = (config.thumbnail.serviceBase || '').trim();
  if (!base || !publicUrl) return null;
  const ts = refresh ? `&ts=${Date.now()}` : '';
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}url=${encodeURIComponent(publicUrl)}${ts}`;
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
  business?: { businessName?: string | null } | null;
  url?: string | null;
  fallback?: string;
}) => params.business?.businessName || extractHostname(params.url) || params.fallback || 'Preview site';

const toDeterministicUuid = (key: string) => {
  const cleaned = key.trim();
  const hash = require('node:crypto').createHash('sha256').update(cleaned).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
};

const shouldIncludeMeta = (value?: string | null) =>
  typeof value === 'string' && ['1', 'true', 'yes'].includes(value.toLowerCase());

const encodeSiteCursor = (cursor: { createdAt: string; requestId: string }) =>
  Buffer.from(JSON.stringify(cursor)).toString('base64');

const decodeSiteCursor = (token: string) => {
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof (payload as any).createdAt !== 'string' ||
      typeof (payload as any).requestId !== 'string'
    ) {
      return null;
    }
    return payload as { createdAt: string; requestId: string };
  } catch {
    return null;
  }
};

const ensureCustomerAccess = (request: FastifyRequest) => {
  if (!request.auth || !request.auth.profile) {
    const error = new Error('Unauthorized');
    // @ts-expect-error attach status
    error.statusCode = 401;
    throw error;
  }
  const allowedRoles: UserRole[] = ['customer', 'admin', 'super-admin'];
  if (!allowedRoles.some((role) => request.auth?.roles.includes(role))) {
    const error = new Error('Forbidden');
    // @ts-expect-error attach status
    error.statusCode = 403;
    throw error;
  }
  return request.auth.profile;
};

export const registerCustomerRoutes = (
  app: FastifyInstance,
  deps: { db: DatabaseService; runner: RunnerService }
) => {
  const { db, runner } = deps;

  app.get(
    '/customer/subscription',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      const profile = ensureCustomerAccess(request);
      const subscription = await db.getSubscription(profile.accountId);
      if (!subscription) {
        return { status: 'none' };
      }
      return subscription;
    }
  );

  app.get('/customer/usage', { preHandler: app.authenticateUser }, async (request, reply) => {
    const profile = ensureCustomerAccess(request);
    const subscription = await db.getSubscription(profile.accountId);
    const limit = subscription?.monthlyEditLimit ?? trialAllowance();
    const usage = await db.getUsage(profile.accountId, limit);
    return usage;
  });

  app.get(
    '/customer/edit-requests',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      const profile = ensureCustomerAccess(request);
      const requests = await db.listCustomerEditRequests(profile.accountId);
      return requests;
    }
  );

  app.post(
    '/customer/edit-requests',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      const profile = ensureCustomerAccess(request);
      const parsed = editRequestInput.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          message: 'Validation error',
          details: parsed.error.flatten(),
        });
      }
      const body = parsed.data;
      const subscription = await db.getSubscription(profile.accountId);
      const isActive = subscription && subscription.status === 'active';
      const limit = subscription?.monthlyEditLimit ?? trialAllowance();
      const usage = await db.getUsage(profile.accountId, limit);
      const remaining = isActive
        ? usage.remainingEdits
        : Math.max(limit - usage.editsUsedThisPeriod, 0);
      const pendingReservations = await db.getPendingLaunchReservationTotal(profile.accountId);
      const effectiveRemaining = remaining - pendingReservations;
      if (effectiveRemaining <= 0) {
        return reply.code(402).send({
          message: 'Edit limit exceeded',
          code: 'LIMIT_EXCEEDED',
          limits: db.buildUsageLimits(subscription, limit),
          usage,
        });
      }

      const editRequest = await db.createEditRequest({
        accountId: profile.accountId,
        userId: profile.id,
        description: body.description,
        siteId: body.siteId,
        businessDetails: body.business,
      });
      const job = await db.createJobForRequest(editRequest.id);
      let reservedUsage = false;
      await db
        .createLaunchReservation({
          accountId: profile.accountId,
          requestId: job.id,
          cost: 1,
          limitSnapshot: limit,
        })
        .then(() => {
          reservedUsage = true;
        })
        .catch((error) => {
          request.log.warn({ err: error }, '[customer] Failed to reserve usage for edit request');
        });
      try {
        await runner.enqueueEditJob({
          jobId: job.id,
          editRequestId: editRequest.id,
          accountId: profile.accountId,
          description: body.description,
          siteId: body.siteId,
          businessDetails: body.business,
        });
      } catch (error) {
        if (reservedUsage) {
          await db
            .releaseLaunchReservation(job.id, (error as any)?.message)
            .catch((releaseError) =>
              request.log.warn(
                { err: releaseError, jobId: job.id },
                '[customer] Failed to release edit usage reservation'
              )
            );
        }
        throw error;
      }

      if (!isActive && usage.editsUsedThisPeriod === 0 && !profile.hasUsedTrial) {
        await db.markTrialUsed(profile.id);
        profile.hasUsedTrial = true;
      }

      return reply.code(201).send({
        ...editRequest,
        latestJob: job,
      });
    }
  );

  app.post('/customer/sites', { preHandler: app.authenticateUser }, async (request, reply) => {
    const profile = ensureCustomerAccess(request);
    const parsed = siteLaunchInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        message: 'Validation error',
        details: parsed.error.flatten(),
      });
    }
    const body = parsed.data;
    try {
      await enforceRateLimit({
        slug: null,
        action: 'site:create',
        identifier: profile.accountId,
        limit: Number(process.env.SITE_CREATE_HOURLY_LIMIT || 3),
        windowMs: 60 * 60 * 1000,
      });
    } catch (error: any) {
      if (error instanceof RateLimitError || error?.statusCode === 429) {
        return reply.code(429).send({
          message: 'Site creation limit reached. Please wait before launching another site.',
        });
      }
      throw error;
    }
    const requestId = body.idempotencyKey ? toDeterministicUuid(body.idempotencyKey) : randomUUID();
    const existing = await db.getSiteGenerationByRequestId(requestId, profile.accountId);
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
    const subscription = await db.getSubscription(profile.accountId);
    const limit = subscription?.monthlyEditLimit ?? trialAllowance();
    const usage = await db.getUsage(profile.accountId, limit);
    const remaining = subscription?.status === 'active'
      ? usage.remainingEdits
      : Math.max(limit - usage.editsUsedThisPeriod, 0);
    const pendingReservations = await db.getPendingLaunchReservationTotal(profile.accountId);
    const effectiveRemaining = remaining - pendingReservations;
    if (effectiveRemaining <= 0) {
      return reply.code(402).send({
        message: 'Edit limit exceeded',
        code: 'LIMIT_EXCEEDED',
        limits: db.buildUsageLimits(subscription, limit),
        usage,
      });
    }
    const limits = db.buildUsageLimits(subscription, limit);
    const existingSites = await db.listSiteGenerations(profile.accountId);
    if (existingSites.length >= limits.freeSiteLimit) {
      return reply.code(402).send({
        message: 'Site limit exceeded',
        code: 'SITE_LIMIT_EXCEEDED',
        limits,
        sites: existingSites.length,
      });
    }
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
      businessDetails: body.business,
      url: body.url,
      description: body.description,
      requestId,
    });
    let { slug, prefixPath } = await ensureUniqueSlug({
      bucket: resolvedBucket,
      basePrefix,
      slugCandidate: desiredSlug,
      db,
      requestId,
    });
    let publicUrl = buildPublicUrl({ bucket: resolvedBucket, prefix: prefixPath });
    await ensurePreviewPlaceholder({
      bucket: resolvedBucket,
      prefix: prefixPath,
      brandName: derivePlaceholderLabel({ business: body.business, url: body.url, fallback: slug }),
      requestId,
    });
    let creationError: any = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await db.createSiteGenerationRequest({
          requestId,
          accountId: profile.accountId,
          userId: profile.id,
          sourceUrl: body.url,
          description: body.description,
          businessDetails: body.business,
          slug,
          prefix: prefixPath,
          bucket: resolvedBucket,
        });
        creationError = null;
        break;
      } catch (error: any) {
        if ((error as any)?.code === '23505') {
          const existingGeneration = await db.getSiteGenerationByRequestId(requestId, profile.accountId);
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
          if ((error as any)?.constraint === 'site_generations_slug_key' && attempt === 0) {
            const retrySlug = await ensureUniqueSlug({
              bucket: resolvedBucket,
              basePrefix,
              slugCandidate: `${desiredSlug}-${requestId.slice(0, 8)}`,
              db,
              requestId: `${requestId}-retry`,
            });
            slug = retrySlug.slug;
            prefixPath = retrySlug.prefixPath;
            publicUrl = buildPublicUrl({ bucket: resolvedBucket, prefix: prefixPath });
            await ensurePreviewPlaceholder({
              bucket: resolvedBucket,
              prefix: prefixPath,
              brandName: derivePlaceholderLabel({ business: body.business, url: body.url, fallback: slug }),
              requestId,
            });
            continue;
          }
        }
        creationError = error;
        break;
      }
    }
    if (creationError) {
      throw creationError;
    }
    let reservedUsage = false;
    await db
      .createLaunchReservation({
        accountId: profile.accountId,
        requestId,
        cost: 1,
        limitSnapshot: limit,
      })
      .then(() => {
        reservedUsage = true;
      })
      .catch((error) => {
        request.log.warn({ err: error }, '[customer] Failed to reserve usage for launch');
      });
    try {
      await runner.runLaunchDirect({
        url: body.url,
        description: body.description,
        businessDetails: body.business,
        requestId,
        slug,
        prefix: prefixPath,
        bucket: resolvedBucket,
      });
      await db.touchSiteGenerationStage(requestId, 'running');
      return reply.code(202).send({
        requestId,
        status: 'running',
        slug,
        prefix: prefixPath,
        bucket: resolvedBucket,
        publicUrl,
      });
    } catch (error: any) {
      await db.updateSiteGeneration(requestId, {
        status: 'failed',
        errorMessage: error?.message ?? 'Failed to start launch',
      });
      if (reservedUsage) {
        await db
          .releaseLaunchReservation(requestId, error?.message)
          .catch((releaseError) =>
            request.log.warn(
              { err: releaseError, requestId },
              '[customer] Failed to release launch reservation'
            )
          );
      }
      throw error;
    }
  });

  app.get('/customer/sites', { preHandler: app.authenticateUser }, async (request, reply) => {
    const profile = ensureCustomerAccess(request);
    const parsedQuery = siteListQuery.safeParse(request.query ?? {});
    if (!parsedQuery.success) {
      return reply.code(400).send({
        message: 'Invalid query',
        details: parsedQuery.error.flatten(),
      });
    }
    const query = parsedQuery.data;
    let cursor = null;
    if (query.cursor) {
      cursor = decodeSiteCursor(query.cursor);
      if (!cursor) {
        return reply.code(400).send({ message: 'Cursor is invalid' });
      }
    }
    const { items, nextCursor } = await db.listSiteGenerationsPage(profile.accountId, {
      limit: query.limit,
      cursor: cursor ?? undefined,
    });
    const encodedCursor = nextCursor ? encodeSiteCursor(nextCursor) : null;
    if (encodedCursor) {
      reply.header('x-next-cursor', encodedCursor);
    }
    if (shouldIncludeMeta(query.includeMeta)) {
      return { items, nextCursor: encodedCursor };
    }
    return items;
  });

  app.get('/sites', { preHandler: app.authenticateUser }, async (request, reply) => {
    const profile = ensureCustomerAccess(request);
    const parsedQuery = siteListQuery.safeParse(request.query ?? {});
    if (!parsedQuery.success) {
      return reply.code(400).send({
        message: 'Invalid query',
        details: parsedQuery.error.flatten(),
      });
    }
    const query = parsedQuery.data;
    let cursor = null;
    if (query.cursor) {
      cursor = decodeSiteCursor(query.cursor);
      if (!cursor) {
        return reply.code(400).send({ message: 'Cursor is invalid' });
      }
    }
    const { items, nextCursor } = await db.listSiteGenerationsPage(profile.accountId, {
      limit: query.limit,
      cursor: cursor ?? undefined,
    });
    const encodedCursor = nextCursor ? encodeSiteCursor(nextCursor) : null;
    if (encodedCursor) {
      reply.header('x-next-cursor', encodedCursor);
    }
    const payload = { items };
    if (shouldIncludeMeta(query.includeMeta)) {
      Object.assign(payload, { nextCursor: encodedCursor });
    }
    return payload;
  });

  app.get('/sites/:slug/thumbnail', { preHandler: app.authenticateUser }, async (request, reply) => {
    const profile = ensureCustomerAccess(request);
    const slug = (request.params as any).slug;
    const refresh =
      (request.query as Record<string, string | undefined> | undefined)?.refresh === 'true';
    const record = await loadSiteConfig(slug);
    if (!record?.metadata?.publicUrl) {
      return reply.code(404).send({ message: 'Site not found' });
    }
    // Basic guard: ensure the account matches when present.
    if (record.metadata?.accountId && record.metadata.accountId !== profile.accountId) {
      return reply.code(404).send({ message: 'Site not found' });
    }
    const thumbnailUrl = buildThumbnailUrl(record.metadata.publicUrl, refresh);
    if (!thumbnailUrl) {
      return reply.code(503).send({ message: 'Thumbnail service not configured' });
    }
    return {
      slug,
      publicUrl: record.metadata.publicUrl,
      thumbnailUrl,
    };
  });

  app.get(
    '/customer/sites/:requestId',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      const profile = ensureCustomerAccess(request);
      const requestId = (request.params as any).requestId;
      const record = await db.getSiteGenerationByRequestId(requestId, profile.accountId);
      if (!record) {
        return reply.code(404).send({ message: 'Site request not found' });
      }
      return record;
    }
  );
};
