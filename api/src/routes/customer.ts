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
  business: businessDetailsSchema,
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
      if (remaining <= 0) {
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
      await db.incrementUsage(profile.accountId, limit, 1).catch((error) => {
        request.log.warn({ err: error }, '[customer] Failed to increment usage');
      });
      const job = await db.createJobForRequest(editRequest.id);
      await runner.enqueueEditJob({
        jobId: job.id,
        editRequestId: editRequest.id,
        accountId: profile.accountId,
        description: body.description,
        siteId: body.siteId,
        businessDetails: body.business,
      });

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
    const requestId = randomUUID();
    const subscription = await db.getSubscription(profile.accountId);
    const limit = subscription?.monthlyEditLimit ?? trialAllowance();
    const usage = await db.getUsage(profile.accountId, limit);
    const remaining = subscription?.status === 'active'
      ? usage.remainingEdits
      : Math.max(limit - usage.editsUsedThisPeriod, 0);
    if (remaining <= 0) {
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
    const { slug, prefixPath } = await ensureUniqueSlug({
      bucket: resolvedBucket,
      basePrefix,
      slugCandidate: desiredSlug,
    });
    const publicUrl = buildPublicUrl({ bucket: resolvedBucket, prefix: prefixPath });
    await ensurePreviewPlaceholder({
      bucket: resolvedBucket,
      prefix: prefixPath,
      brandName: derivePlaceholderLabel({ business: body.business, url: body.url, fallback: slug }),
      requestId,
    });
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
    await db.incrementUsage(profile.accountId, limit, 1).catch((error) => {
      request.log.warn({ err: error }, '[customer] Failed to increment usage for launch');
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
      throw error;
    }
  });

  app.get('/customer/sites', { preHandler: app.authenticateUser }, async (request, reply) => {
    const profile = ensureCustomerAccess(request);
    const items = await db.listSiteGenerations(profile.accountId);
    return items;
  });

  app.get('/sites', { preHandler: app.authenticateUser }, async (request, reply) => {
    const profile = ensureCustomerAccess(request);
    const items = await db.listSiteGenerations(profile.accountId);
    return { items };
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
