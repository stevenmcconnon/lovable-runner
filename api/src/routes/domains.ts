import path from 'node:path';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DatabaseService } from '../services/database';
import { DomainService, domainHelpers, DnsConfig } from '../services/domain';
import { DomainOrderRecord, DomainRecord, UserRole } from '../types';
import { DomainOrderService } from '../services/domain-order';
import { StripeService } from '../services/stripe';
import { config } from '../env';
import { DomainManager } from '../services/domain-manager';
import { NotificationService } from '../services/notifications';

const rootRequire = (relativePath: string): any => {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(path.join(process.cwd(), relativePath));
  } catch {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(path.join(__dirname, '..', '..', relativePath));
  }
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

const { recordAuditEvent } = rootRequire('src/audit-log.js') as {
  recordAuditEvent: (params: {
    slug?: string | null;
    accountId?: string | null;
    actorUserId?: string | null;
    actorEmail?: string | null;
    action: string;
    description?: string | null;
    metadata?: Record<string, unknown> | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  }) => Promise<void>;
};

const contactSchema = z.object({
  firstName: z.string().min(2).max(120).optional(),
  lastName: z.string().min(2).max(120).optional(),
  name: z.string().min(2).max(160).optional(),
  email: z.string().email(),
  phone: z.string().min(6).max(40),
  phoneCountryCode: z.string().max(4).optional(),
  phoneExt: z.string().max(10).optional(),
  address1: z.string().min(3).max(160),
  address2: z.string().max(160).optional(),
  city: z.string().min(2).max(120),
  state: z.string().min(2).max(120),
  postalCode: z.string().min(2).max(20),
  country: z.string().min(2).max(2),
  organization: z.string().max(160).optional(),
  jobTitle: z.string().max(120).optional(),
  promotionCode: z.string().max(120).optional(),
});

const searchSchema = z.object({
  query: z.string().min(2).max(120),
  tlds: z
    .array(
      z
        .string()
        .min(2)
        .max(10)
        .regex(/^[a-z0-9]+$/i)
        .transform((value) => value.toLowerCase())
    )
    .max(10)
    .optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

const canonicalModeSchema = z.enum(['apex', 'www']);

const purchaseSchema = z.object({
  domain: z.string().min(3).max(253),
  slug: z.string().min(3).max(120),
  termYears: z.number().int().min(1).max(10).optional(),
  contact: contactSchema,
  wire: z.boolean().optional(),
  canonical: canonicalModeSchema.optional(),
});

const manualSchema = z.object({
  domain: z.string().min(3).max(253),
  canonical: canonicalModeSchema.optional(),
});

const slugParams = z.object({
  slug: z.string().min(3),
});

const verifyParams = z.object({
  domain: z.string().min(3),
});

const slugDomainParams = z.object({
  slug: z.string().min(3),
  domain: z.string().min(3),
});

const ensureCustomerAccess = (roles: UserRole[]) => {
  const allowed: UserRole[] = ['customer', 'admin', 'super-admin'];
  return allowed.some((role) => roles.includes(role));
};

type ProfileSummary = {
  accountId?: string | null;
  id?: string | null;
  email?: string | null;
};

const extractRequestMeta = (request: FastifyRequest) => {
  const forwardedFor = request.headers['x-forwarded-for'];
  const ipAddress =
    request.ip ||
    (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor) ||
    ((request as any).raw?.socket?.remoteAddress ?? null);
  const userAgentHeader = request.headers['user-agent'] || request.headers['User-Agent'];
  const userAgent = Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader || null;
  return { ipAddress, userAgent };
};

const logDomainEvent = (
  request: FastifyRequest,
  profile: ProfileSummary | null | undefined,
  params: { slug?: string | null; action: string; description: string; metadata?: Record<string, unknown> | null }
) => {
  recordAuditEvent({
    slug: params.slug ?? null,
    accountId: profile?.accountId ?? null,
    actorUserId: profile?.id ?? null,
    actorEmail: profile?.email ?? null,
    action: params.action,
    description: params.description,
    metadata: params.metadata ?? null,
    ...extractRequestMeta(request),
  }).catch((error) =>
    request.log.warn({ err: error, action: params.action }, '[domains] audit log failed')
  );
};

const buildRateLimitIdentifier = (profile: ProfileSummary | null | undefined) =>
  profile?.accountId || profile?.id || profile?.email || 'anonymous';

const isRateLimitError = (error: unknown): boolean => {
  if (!error) return false;
  if (error instanceof RateLimitError) return true;
  if (typeof error === 'object' && 'statusCode' in error) {
    return (error as { statusCode?: number }).statusCode === 429;
  }
  return false;
};

const sanitizeDomainOrThrow = (value: string) => {
  const sanitized = domainHelpers.sanitizeDomainInput(value);
  if (!sanitized) {
    const error = new Error('Invalid domain');
    // @ts-expect-error add code
    error.statusCode = 400;
    throw error;
  }
  return sanitized;
};

const withDns = (
  record: DomainRecord,
  domainService: DomainService
): DomainRecord & { dns: any; https: any } => {
  const dnsConfig =
    record.dnsSettings ??
    domainService.buildDnsConfig({
      slug: record.slug,
      domain: record.domain,
      verificationToken: record.verificationToken ?? undefined,
    });
  const validationRecords = Array.isArray(record.certificateValidation)
    ? record.certificateValidation
    : [];
  return {
    ...record,
    dns: dnsConfig,
    https: {
      status: record.httpsStatus ?? 'pending',
      readyAt: record.httpsReadyAt ?? null,
      checkedAt: record.httpsCheckedAt ?? null,
      certificate: {
        arn: record.certificateArn ?? null,
        status: record.certificateStatus ?? null,
        statusAt: record.certificateStatusAt ?? null,
        validationRecords,
      },
      edge: {
        domain: record.edgeDomain ?? null,
        distributionId: record.edgeDistributionId ?? null,
        status: record.edgeStatus ?? null,
        statusAt: record.edgeStatusAt ?? null,
        functionName: record.edgeFunctionName ?? null,
      },
      canonical: {
        host: record.canonicalHost ?? null,
        mode: record.canonicalMode ?? null,
      },
      error: record.routingError ?? null,
    },
  };
};

const cartCheckoutSchema = z.object({
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
  items: z
    .array(
      z.object({
        domain: z.string().min(3).max(253),
        slug: z.string().min(3).max(120),
        termYears: z.number().int().min(1).max(10).optional(),
        contact: contactSchema,
        wire: z.boolean().optional(),
        canonical: canonicalModeSchema.optional(),
      })
    )
    .min(1)
    .max(10),
});

const DEFAULT_DOMAIN_PRICE_CENTS = config.domains?.defaultBasePriceCents ?? 1500;
const PRICE_MARKUP_CENTS = config.domains?.priceMarkupCents ?? 300;

export const registerDomainRoutes = (
  app: FastifyInstance,
  deps: {
    db: DatabaseService;
    domainService: DomainService;
    domainOrderService: DomainOrderService;
    domainManager: DomainManager;
    stripe: StripeService;
    notifications?: NotificationService;
    runner?: import('../services/runner').RunnerService;
  }
) => {
  const { db, domainService, domainOrderService, domainManager, stripe, notifications, runner } = deps;

  app.get('/domains', { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.auth?.profile || !ensureCustomerAccess(request.auth.roles)) {
      return reply.code(403).send({ message: 'Forbidden' });
    }
    const records = await db.listDomainsForAccount(request.auth.profile.accountId);
    const items = records.map((record) => withDns(record, domainService));
    return { items };
  });

  app.post('/domains/search', { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.auth?.profile || !ensureCustomerAccess(request.auth.roles)) {
      return reply.code(403).send({ message: 'Forbidden' });
    }
    const profile = request.auth.profile;
    try {
      await enforceRateLimit({
        slug: null,
        action: 'domain:search',
        identifier: buildRateLimitIdentifier(profile),
        limit: Number(process.env.DOMAIN_SEARCH_PER_MINUTE || 30),
        windowMs: 60 * 1000,
      });
    } catch (error) {
      if (isRateLimitError(error)) {
        return reply
          .code(429)
          .send({ message: 'Too many domain searches. Please wait a moment and try again.' });
      }
      throw error;
    }
    const body = searchSchema.parse(request.body);
    const candidates = await domainService.search(body.query, body.tlds, body.limit);
    const enriched = await Promise.all(
      candidates.map(async (candidate) => {
        const existing = await db.getDomainByName(candidate.domain);
        return {
          ...candidate,
          available: !existing,
          priceCents: candidate.priceCents
            ? candidate.priceCents + PRICE_MARKUP_CENTS
            : undefined,
        };
      })
    );
    return { items: enriched };
  });

  app.post('/domains/purchase', { preHandler: app.authenticateUser }, async (request, reply) => {
    if (request.auth?.type !== 'machine') {
      return reply
        .code(403)
        .send({ message: 'Direct domain purchase endpoint is no longer available. Please use checkout.' });
    }
    request.log.warn('[domains] Direct domain purchase endpoint invoked by machine token');
    return reply
      .code(410)
      .send({ message: 'Direct domain purchase endpoint has been disabled in favor of async orders.' });
  });

  app.post(
    '/domains/cart/checkout',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      if (!request.auth?.profile || !ensureCustomerAccess(request.auth.roles)) {
        return reply.code(403).send({ message: 'Forbidden' });
      }
      const profile = request.auth.profile;
      try {
        await enforceRateLimit({
          slug: null,
          action: 'domain:purchase',
          identifier: buildRateLimitIdentifier(profile),
          limit: Number(process.env.DOMAIN_PURCHASE_HOURLY_LIMIT || 3),
          windowMs: 60 * 60 * 1000,
        });
      } catch (error) {
        if (isRateLimitError(error)) {
          return reply
            .code(429)
            .send({ message: 'Domain purchase limit reached. Please try again later.' });
        }
        throw error;
      }
      const body = cartCheckoutSchema.parse(request.body);
      const seenDomains = new Set<string>();
      const orderSummaries: Array<{ order: DomainOrderRecord; priceCents: number }> = [];

      for (const item of body.items) {
        const sanitizedDomain = sanitizeDomainOrThrow(item.domain);
        if (seenDomains.has(sanitizedDomain)) {
          return reply.code(400).send({ message: `Duplicate domain: ${sanitizedDomain}` });
        }
        seenDomains.add(sanitizedDomain);
        const existing = await db.getDomainByName(sanitizedDomain);
        if (existing && existing.slug !== item.slug) {
          return reply.code(409).send({ message: `Domain ${sanitizedDomain} is already connected` });
        }
        const baseDnsConfig = domainService.buildDnsConfig({
          slug: item.slug,
          domain: sanitizedDomain,
          verificationToken: existing?.verificationToken ?? undefined,
        });
        const { dnsConfig: enrichedDnsConfig, metadata: edgeMetadata } = await domainManager.prepareDnsConfig({
          domain: sanitizedDomain,
          slug: item.slug,
          dnsConfig: baseDnsConfig,
          canonicalMode: item.canonical,
        });
        const basePrice = await domainService
          .lookupBasePrice(sanitizedDomain)
          .catch(() => DEFAULT_DOMAIN_PRICE_CENTS);
        const priceCents = Math.round((item.termYears ?? 1) * (basePrice + PRICE_MARKUP_CENTS));
        const order = await domainOrderService.createPendingOrder({
          accountId: profile.accountId,
          slug: item.slug,
          domain: sanitizedDomain,
          termYears: item.termYears,
          contact: item.contact,
          wire: item.wire,
          dnsConfig: enrichedDnsConfig,
          edgeMetadata,
          priceCents,
        });
        orderSummaries.push({ order, priceCents });
      }

      const subscription = await db.getSubscription(profile.accountId);
      const checkout = await stripe.createDomainCheckoutSession({
        accountId: profile.accountId,
        successUrl: body.successUrl,
        cancelUrl: body.cancelUrl,
        orders: orderSummaries.map(({ order, priceCents }) => ({
          orderId: order.id,
          domain: order.domain,
          amountCents: priceCents,
        })),
        email: profile.email,
        existingCustomerId: subscription?.stripeCustomerId ?? undefined,
      });

      await Promise.all(
        orderSummaries.map(({ order }) => domainOrderService.attachStripeSession(order, checkout.sessionId))
      );

      return {
        checkoutUrl: checkout.checkoutUrl,
        sessionId: checkout.sessionId,
        orders: orderSummaries.map(({ order }) => ({
          id: order.id,
          domain: order.domain,
          slug: order.slug,
        })),
      };
    }
  );

  app.post(
    '/domains/:domain/verify',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      if (!request.auth?.profile || !ensureCustomerAccess(request.auth.roles)) {
        return reply.code(403).send({ message: 'Forbidden' });
      }
      const params = verifyParams.parse(request.params);
      const sanitizedDomain = sanitizeDomainOrThrow(params.domain);
      const record = await db.getDomainByName(sanitizedDomain);
      if (!record) {
        return reply.code(404).send({ message: 'Domain not found' });
      }
      const isOwner = !record.accountId || record.accountId === request.auth.profile.accountId;
      const isSuperAdmin = request.auth.roles.includes('super-admin');
      if (!isOwner && !isSuperAdmin) {
        return reply.code(404).send({ message: 'Domain not found' });
      }
      const now = new Date().toISOString();
      const updated = await db.updateSiteDomain(sanitizedDomain, {
        status: 'verified',
        verifiedAt: now,
        lastCheckedAt: now,
      });
      return { domain: updated };
    }
  );

  app.get('/domains/:domain', { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.auth?.profile || !ensureCustomerAccess(request.auth.roles)) {
      return reply.code(403).send({ message: 'Forbidden' });
    }
    const params = verifyParams.parse(request.params);
    const sanitizedDomain = sanitizeDomainOrThrow(params.domain);
    const record = await db.getDomainByName(sanitizedDomain);
    if (!record) {
      return reply.code(404).send({ message: 'Domain not found' });
    }
    const isSuperAdmin = request.auth.roles.includes('super-admin');
    const sameAccount = !record.accountId || record.accountId === request.auth.profile.accountId;
    if (!sameAccount && !isSuperAdmin) {
      return reply.code(404).send({ message: 'Domain not found' });
    }
    return { domain: withDns(record, domainService) };
  });

  app.post(
    '/sites/:slug/domains',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      if (!request.auth?.profile || !ensureCustomerAccess(request.auth.roles)) {
        return reply.code(403).send({ message: 'Forbidden' });
      }
      const profile = request.auth.profile;
      const params = slugParams.parse(request.params);
      const body = manualSchema.parse(request.body);
      try {
        await enforceRateLimit({
          slug: params.slug,
          action: 'domain:attach',
          identifier: buildRateLimitIdentifier(profile),
          limit: Number(process.env.DOMAIN_ATTACH_HOURLY_LIMIT || 10),
          windowMs: 60 * 60 * 1000,
        });
      } catch (error) {
        if (isRateLimitError(error)) {
          return reply
            .code(429)
            .send({ message: 'Domain attachment limit reached. Please wait and try again.' });
        }
        throw error;
      }
      const sanitizedDomain = sanitizeDomainOrThrow(body.domain);
      const existing = await db.getDomainByName(sanitizedDomain);
      if (existing && existing.slug !== params.slug) {
        return reply.code(409).send({ message: 'Domain is already attached to another site' });
      }
      const baseDnsConfig = domainService.buildDnsConfig({
        slug: params.slug,
        domain: sanitizedDomain,
        verificationToken: existing?.verificationToken ?? undefined,
      });
      const { dnsConfig: enrichedDnsConfig, metadata: edgeMetadata } = await domainManager.prepareDnsConfig({
        domain: sanitizedDomain,
        slug: params.slug,
        dnsConfig: baseDnsConfig,
        canonicalMode: body.canonical,
      });
      const record = await db.upsertSiteDomain({
        accountId: profile.accountId,
        slug: params.slug,
        domain: sanitizedDomain,
        type: 'manual',
        provider: existing?.provider ?? null,
        status: existing?.status ?? 'pending',
        verificationToken: baseDnsConfig.verificationToken,
        dnsSettings: enrichedDnsConfig,
      });
      await domainManager.persistEdgeMetadata(sanitizedDomain, edgeMetadata);
      setImmediate(() => {
        domainManager
          .ensureCertificateForDomain({
            domain: sanitizedDomain,
            canonicalMode: edgeMetadata.canonicalMode,
            canonicalHost: edgeMetadata.canonicalHost,
          })
          .then(async () => {
            const latest = await db.getDomainByName(sanitizedDomain);
            if (latest) {
              await domainManager.refreshHttps(latest).catch(() => null);
            }
          })
          .catch((error) =>
            request.log.warn(
              { err: (error as Error)?.message, domain: sanitizedDomain },
              '[domains] Failed to enqueue certificate provisioning'
            )
          );
      });
      const refreshed = await domainManager.refreshHttps(record).catch(() => null);
      const finalRecord = refreshed ?? record;
      logDomainEvent(request, profile, {
        slug: params.slug,
        action: 'domain.attach.manual',
        description: `Attached domain ${sanitizedDomain}`,
        metadata: {
          domain: sanitizedDomain,
          type: 'manual',
          status: finalRecord?.status ?? 'pending',
        },
      });
      return {
        domain: finalRecord ? withDns(finalRecord, domainService) : null,
        dns: enrichedDnsConfig,
      };
    }
  );

  app.post(
    '/sites/:slug/domains/:domain/wire',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      if (!request.auth?.profile || !ensureCustomerAccess(request.auth.roles)) {
        return reply.code(403).send({ message: 'Forbidden' });
      }
      if (!domainService.supportsManagedRegistrar()) {
        return reply.code(400).send({ message: 'Automatic wiring is not enabled' });
      }
      const params = slugDomainParams.parse(request.params);
      const profile = request.auth.profile;
      try {
        await enforceRateLimit({
          slug: params.slug,
          action: 'domain:wire',
          identifier: buildRateLimitIdentifier(profile),
          limit: Number(process.env.DOMAIN_WIRE_HOURLY_LIMIT || 5),
          windowMs: 60 * 60 * 1000,
        });
      } catch (error) {
        if (isRateLimitError(error)) {
          return reply
            .code(429)
            .send({ message: 'Domain wiring limit reached. Please try again later.' });
        }
        throw error;
      }
      const sanitizedDomain = sanitizeDomainOrThrow(params.domain);
      const record = await db.getDomainByName(sanitizedDomain);
      if (!record || record.slug !== params.slug) {
        return reply.code(404).send({ message: 'Domain not found' });
      }
      const sameAccount =
        !record.accountId || record.accountId === request.auth.profile.accountId;
      const isSuperAdmin = request.auth.roles.includes('super-admin');
      if (!sameAccount && !isSuperAdmin) {
        return reply.code(404).send({ message: 'Domain not found' });
      }
      if (record.type !== 'managed') {
        return reply
          .code(400)
          .send({ message: 'Only managed domains purchased through AI SiteMaker can be wired automatically.' });
      }
      const existingDns = (record.dnsSettings as Partial<DnsConfig> | null) ?? null;
      const dnsConfig = domainService.buildDnsConfig({
        slug: params.slug,
        domain: sanitizedDomain,
        verificationToken: existingDns?.verificationToken ?? record.verificationToken ?? undefined,
      });
      try {
        await domainService.wireDomain({ domain: sanitizedDomain, dnsConfig });
      } catch (error) {
        request.log.error(
          {
            domain: sanitizedDomain,
            slug: params.slug,
            err: (error as Error)?.message,
          },
          '[domains] manual wire failed'
        );
        logDomainEvent(request, profile, {
          slug: params.slug,
          action: 'domain.wire.failed',
          description: `Automatic wiring failed for ${sanitizedDomain}`,
          metadata: {
            domain: sanitizedDomain,
            error: (error as Error)?.message,
            manualRequest: true,
          },
        });
        return reply.code(502).send({ message: 'Unable to wire domain at this time' });
      }
      const updated = await db.updateSiteDomain(sanitizedDomain, { dnsSettings: dnsConfig });
      const refreshed = await domainManager.refreshHttps(updated ?? record).catch(() => null);
      const finalRecord = refreshed ?? updated ?? record;
      logDomainEvent(request, profile, {
        slug: params.slug,
        action: 'domain.wire.manual',
        description: `Wired domain ${sanitizedDomain}`,
        metadata: {
          domain: sanitizedDomain,
          type: 'managed',
        },
      });
      return {
        domain: finalRecord ? withDns(finalRecord, domainService) : null,
        dns: dnsConfig,
        wired: true,
      };
    }
  );

  app.post(
    '/sites/:slug/domains/:domain/https-refresh',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      if (!request.auth?.profile || !ensureCustomerAccess(request.auth.roles)) {
        return reply.code(403).send({ message: 'Forbidden' });
      }
      const params = slugDomainParams.parse(request.params);
      const sanitizedDomain = sanitizeDomainOrThrow(params.domain);
      const record = await db.getDomainByName(sanitizedDomain);
      if (!record || record.slug !== params.slug) {
        return reply.code(404).send({ message: 'Domain not found' });
      }
      const isSuperAdmin = request.auth.roles.includes('super-admin');
      const isOwner = !record.accountId || record.accountId === request.auth.profile.accountId;
      if (!isOwner && !isSuperAdmin) {
        return reply.code(404).send({ message: 'Domain not found' });
      }
      const rateLimit = Number(process.env.DOMAIN_HTTPS_REFRESH_PER_HOUR || 5);
      if (rateLimit > 0) {
        try {
          await enforceRateLimit({
            slug: params.slug,
            action: 'domain:https-refresh',
            identifier: `${buildRateLimitIdentifier(request.auth.profile)}:${params.slug}`,
            limit: rateLimit,
            windowMs: 60 * 60 * 1000,
          });
        } catch (error) {
          if (isRateLimitError(error)) {
            return reply
              .code(429)
              .send({ message: 'Too many HTTPS refresh requests. Please wait and try again.' });
          }
          throw error;
        }
      }
      if (runner) {
        await runner
          .requestDomainRefresh({ domain: sanitizedDomain })
          .catch((error) => {
            request.log.warn(
              { err: error, domain: sanitizedDomain, slug: params.slug },
              '[domains] Failed to enqueue domain refresh'
            );
            throw error;
          });
        logDomainEvent(request, request.auth.profile, {
          slug: params.slug,
          action: 'domain.https.refresh.enqueue',
          description: `Queued HTTPS refresh for ${sanitizedDomain}`,
          metadata: {
            domain: sanitizedDomain,
            status: record.httpsStatus ?? 'unknown',
          },
        });
        return reply.code(202).send({
          status: 'queued',
          domain: withDns(record, domainService),
        });
      }
      if (!domainManager) {
        return reply.code(503).send({ message: 'Domain manager is not configured' });
      }
      const refreshed = await domainManager.refreshHttps(record).catch((error) => {
        request.log.warn(
          { err: error, domain: sanitizedDomain, slug: params.slug },
          '[domains] manual https refresh failed'
        );
        return null;
      });
      logDomainEvent(request, request.auth.profile, {
        slug: params.slug,
        action: 'domain.https.refresh',
        description: `Manual HTTPS refresh requested for ${sanitizedDomain}`,
        metadata: {
          domain: sanitizedDomain,
          status: refreshed?.httpsStatus ?? record.httpsStatus ?? 'unknown',
        },
      });
      const finalRecord = refreshed ?? record;
      return { domain: withDns(finalRecord, domainService) };
    }
  );

  app.get(
    '/sites/:slug/domains/status',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      if (!request.auth?.profile || !ensureCustomerAccess(request.auth.roles)) {
        return reply.code(403).send({ message: 'Forbidden' });
      }
      const params = slugParams.parse(request.params);
      const isSuperAdmin = request.auth.roles.includes('super-admin');
      const records = await db.listDomainsForSlug(params.slug);
      const filtered = records.filter((record) => {
        if (!record.accountId) return true;
        if (record.accountId === request.auth?.profile?.accountId) return true;
        return isSuperAdmin;
      });
      const enriched = filtered.map((record) => withDns(record, domainService));
      return { items: enriched };
    }
  );

  app.post(
    '/sites/:slug/domains/:domain/primary',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      if (!request.auth?.profile || !ensureCustomerAccess(request.auth.roles)) {
        return reply.code(403).send({ message: 'Forbidden' });
      }
      const params = slugDomainParams.parse(request.params);
      const sanitizedDomain = sanitizeDomainOrThrow(params.domain);
      const record = await db.getDomainByName(sanitizedDomain);
      if (!record || record.slug !== params.slug) {
        return reply.code(404).send({ message: 'Domain not found' });
      }
      const isSuperAdmin = request.auth.roles.includes('super-admin');
      const isOwner = record.accountId === request.auth.profile.accountId;
      if (!isOwner && !isSuperAdmin) {
        return reply.code(404).send({ message: 'Domain not found' });
      }
      await db.setPrimaryDomainForSlug(params.slug, sanitizedDomain);
      const updated = await db.getDomainByName(sanitizedDomain);
      logDomainEvent(request, request.auth.profile, {
        slug: params.slug,
        action: 'domain.primary.set',
        description: `Set ${sanitizedDomain} as the primary domain`,
        metadata: {
          domain: sanitizedDomain,
        },
      });
      return { domain: updated ? withDns(updated, domainService) : null };
    }
  );

  app.delete(
    '/sites/:slug/domains/:domain',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      if (!request.auth?.profile || !ensureCustomerAccess(request.auth.roles)) {
        return reply.code(403).send({ message: 'Forbidden' });
      }
      const params = slugDomainParams.parse(request.params);
      const sanitizedDomain = sanitizeDomainOrThrow(params.domain);
      const record = await db.getDomainByName(sanitizedDomain);
      if (!record || record.slug !== params.slug) {
        return reply.code(404).send({ message: 'Domain not found' });
      }
      const isSuperAdmin = request.auth.roles.includes('super-admin');
      const isOwner = record.accountId === request.auth.profile.accountId;
      if (!isOwner && !isSuperAdmin) {
        return reply.code(404).send({ message: 'Domain not found' });
      }
      await db.deleteSiteDomain(sanitizedDomain, params.slug);
      logDomainEvent(request, request.auth.profile, {
        slug: params.slug,
        action: 'domain.detach',
        description: `Removed domain ${sanitizedDomain}`,
        metadata: {
          domain: sanitizedDomain,
        },
      });
      reply.code(204).send();
    }
  );
};
