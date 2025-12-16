import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DatabaseService } from '../services/database';
import { DomainService, domainHelpers, DnsConfig } from '../services/domain';
import { DomainOrderRecord, DomainRecord, UserRole } from '../types';
import { DomainOrderService } from '../services/domain-order';
import { StripeService } from '../services/stripe';
import { config } from '../env';
import { DomainManager } from '../services/domain-manager';

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

const shouldRefreshHttps = (record: DomainRecord): boolean => {
  if (!record.httpsStatus || record.httpsStatus === 'pending') return true;
  if (record.httpsStatus === 'live') return false;
  const lastChecked = record.httpsCheckedAt ? Date.parse(record.httpsCheckedAt) : 0;
  if (!lastChecked) return true;
  const ageMs = Date.now() - lastChecked;
  return ageMs > 5 * 60 * 1000;
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
  }
) => {
  const { db, domainService, domainOrderService, domainManager, stripe } = deps;

  app.get('/domains', { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.auth?.profile || !ensureCustomerAccess(request.auth.roles)) {
      return reply.code(403).send({ message: 'Forbidden' });
    }
    const records = await db.listDomainsForAccount(request.auth.profile.accountId);
    const hydrated = await Promise.all(
      records.map(async (record) => {
        if (shouldRefreshHttps(record)) {
          try {
            return (await domainManager.refreshHttps(record)) ?? record;
          } catch {
            return record;
          }
        }
        return record;
      })
    );
    const items = hydrated.map((record) => withDns(record, domainService));
    return { items };
  });

  app.post('/domains/search', { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.auth?.profile || !ensureCustomerAccess(request.auth.roles)) {
      return reply.code(403).send({ message: 'Forbidden' });
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
    if (!request.auth?.profile || !ensureCustomerAccess(request.auth.roles)) {
      return reply.code(403).send({ message: 'Forbidden' });
    }
    const profile = request.auth.profile;
    const body = purchaseSchema.parse(request.body);
    const sanitizedDomain = sanitizeDomainOrThrow(body.domain);
    const existing = await db.getDomainByName(sanitizedDomain);
    if (existing && existing.slug !== body.slug) {
      return reply.code(409).send({ message: 'Domain is already connected to another site' });
    }
    const shouldWire = Boolean(body.wire);
    if (shouldWire && !domainService.supportsManagedRegistrar()) {
      return reply.code(400).send({ message: 'Automatic domain wiring is not available' });
    }
    let purchase;
    try {
      purchase = await domainService.purchaseDomain({
        domain: sanitizedDomain,
        slug: body.slug,
        years: body.termYears,
        contact: body.contact,
      });
    } catch (error) {
      request.log.error(
        {
          domain: sanitizedDomain,
          slug: body.slug,
          err: (error as Error)?.message,
        },
        '[domains] purchase failed'
      );
      return reply.code(502).send({ message: 'Unable to register domain' });
    }
    const baseDnsConfig = domainService.buildDnsConfig({
      slug: body.slug,
      domain: sanitizedDomain,
      verificationToken: existing?.verificationToken ?? undefined,
    });
    const { dnsConfig: enrichedDnsConfig, metadata: edgeMetadata } = await domainManager.prepareDnsConfig({
      domain: sanitizedDomain,
      slug: body.slug,
      dnsConfig: baseDnsConfig,
      canonicalMode: body.canonical,
    });

    const order = await db.createDomainOrder({
      accountId: profile.accountId,
      slug: body.slug,
      domain: sanitizedDomain,
      status: purchase.status,
      providerOrderId: purchase.providerOrderId,
      priceCents: (body.termYears ?? 1) * 4000,
      currency: 'USD',
      metadata: body.contact ? { contact: body.contact } : null,
    });

    const record = await db.upsertSiteDomain({
      accountId: profile.accountId,
      slug: body.slug,
      domain: sanitizedDomain,
      type: 'managed',
      provider: domainService.getProviderCode(),
      status: shouldWire ? 'configuring' : purchase.status ?? 'pending',
      verificationToken: baseDnsConfig.verificationToken,
      dnsSettings: enrichedDnsConfig,
    });
    await domainManager.persistEdgeMetadata(sanitizedDomain, edgeMetadata);

    let wired = false;
    if (shouldWire) {
      try {
        await domainService.wireDomain({ domain: sanitizedDomain, dnsConfig: enrichedDnsConfig });
        wired = true;
      } catch (error) {
        request.log.error(
          {
            domain: sanitizedDomain,
            slug: body.slug,
            err: (error as Error)?.message,
          },
          '[domains] automatic wiring failed'
        );
        return reply
          .code(502)
          .send({ message: 'Domain purchase succeeded but wiring failed. Please try again.' });
      }
    }

    const currentRecord = (await db.getDomainByName(sanitizedDomain)) ?? record;
    const refreshed = await domainManager.refreshHttps(currentRecord).catch(() => null);
    const finalRecord = refreshed ?? currentRecord;

    return {
      order,
      domain: finalRecord ? withDns(finalRecord, domainService) : null,
      dns: enrichedDnsConfig,
      wired,
    };
  });

  app.post(
    '/domains/cart/checkout',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      if (!request.auth?.profile || !ensureCustomerAccess(request.auth.roles)) {
        return reply.code(403).send({ message: 'Forbidden' });
      }
      const body = cartCheckoutSchema.parse(request.body);
      const profile = request.auth.profile;
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
      const refreshed = await domainManager.refreshHttps(record).catch(() => null);
      const finalRecord = refreshed ?? record;
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
        return reply.code(502).send({ message: 'Unable to wire domain at this time' });
      }
      const updated = await db.updateSiteDomain(sanitizedDomain, { dnsSettings: dnsConfig });
      const refreshed = await domainManager.refreshHttps(updated ?? record).catch(() => null);
      const finalRecord = refreshed ?? updated ?? record;
      return {
        domain: finalRecord ? withDns(finalRecord, domainService) : null,
        dns: dnsConfig,
        wired: true,
      };
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
      const refreshed = await Promise.all(
        filtered.map(async (record) => {
          if (shouldRefreshHttps(record)) {
            try {
              return (await domainManager.refreshHttps(record)) ?? record;
            } catch {
              return record;
            }
          }
          return record;
        })
      );
      const enriched = refreshed.map((record) => withDns(record, domainService));
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
      reply.code(204).send();
    }
  );
};
