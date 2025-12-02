import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DatabaseService } from '../services/database';
import { DomainService, domainHelpers } from '../services/domain';
import { DomainRecord, UserRole } from '../types';

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

const purchaseSchema = z.object({
  domain: z.string().min(3).max(253),
  slug: z.string().min(3).max(120),
  termYears: z.number().int().min(1).max(10).optional(),
  contact: z
    .object({
      name: z.string().min(3).max(120),
      email: z.string().email(),
      phone: z.string().max(64).optional(),
    })
    .optional(),
});

const manualSchema = z.object({
  domain: z.string().min(3).max(253),
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
): DomainRecord & { dns: any } => ({
  ...record,
  dns:
    record.dnsSettings ??
    domainService.buildDnsConfig({
      slug: record.slug,
      domain: record.domain,
      verificationToken: record.verificationToken ?? undefined,
    }),
});

export const registerDomainRoutes = (
  app: FastifyInstance,
  deps: { db: DatabaseService; domainService: DomainService }
) => {
  const { db, domainService } = deps;

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
    const body = searchSchema.parse(request.body);
    const candidates = domainService.search(body.query, body.tlds, body.limit);
    const enriched = await Promise.all(
      candidates.map(async (candidate) => {
        const existing = await db.getDomainByName(candidate.domain);
        return {
          ...candidate,
          available: !existing,
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

    const purchase = domainService.purchaseDomain(sanitizedDomain);
    const dnsConfig = domainService.buildDnsConfig({
      slug: body.slug,
      domain: sanitizedDomain,
      verificationToken: existing?.verificationToken ?? undefined,
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
      provider: 'stub-reseller',
      status: purchase.status === 'processing' ? 'configuring' : 'pending',
      verificationToken: dnsConfig.verificationToken,
      dnsSettings: dnsConfig,
    });

    return {
      order,
      domain: record,
      dns: dnsConfig,
    };
  });

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
      const dnsConfig = domainService.buildDnsConfig({
        slug: params.slug,
        domain: sanitizedDomain,
        verificationToken: existing?.verificationToken ?? undefined,
      });
      const record = await db.upsertSiteDomain({
        accountId: profile.accountId,
        slug: params.slug,
        domain: sanitizedDomain,
        type: 'manual',
        provider: existing?.provider ?? null,
        status: existing?.status ?? 'pending',
        verificationToken: dnsConfig.verificationToken,
        dnsSettings: dnsConfig,
      });
      return {
        domain: record,
        dns: dnsConfig,
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
      const enriched = filtered.map((record) => ({
        ...record,
        dns:
          record.dnsSettings ??
          domainService.buildDnsConfig({
            slug: params.slug,
            domain: record.domain,
            verificationToken: record.verificationToken ?? undefined,
          }),
      }));
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
