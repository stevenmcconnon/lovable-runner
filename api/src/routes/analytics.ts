import path from 'node:path';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DatabaseService } from '../services/database';

const rootRequire = (relativePath: string): any => {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(path.join(process.cwd(), relativePath));
  } catch {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(path.join(__dirname, '..', '..', relativePath));
  }
};

const { listAnalytics, buildAlerts } = rootRequire('src/analytics.js') as {
  listAnalytics: (params: { slug: string; days?: number }) => Promise<any[]>;
  buildAlerts: (records: Array<Record<string, any>>) => string[];
};

const slugParams = z.object({
  slug: z.string().min(3).max(120),
});

const analyticsQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
});

const ensureSiteAccess = async (db: DatabaseService, accountId: string, slug: string) => {
  const sites = await db.listSiteGenerations(accountId);
  return sites.some((site) => site.slug === slug);
};

export const registerAnalyticsRoutes = (app: FastifyInstance, deps: { db: DatabaseService }) => {
  const { db } = deps;

  app.get('/sites/:slug/analytics', { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.auth?.profile) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }
    const params = slugParams.parse(request.params);
    const query = analyticsQuery.safeParse(request.query);
    const windowDays = query.success ? query.data.days : undefined;
    const hasAccess = await ensureSiteAccess(db, request.auth.profile.accountId, params.slug);
    if (!hasAccess && !request.auth.roles.includes('super-admin')) {
      return reply.code(404).send({ message: 'Site not found' });
    }
    const records = await listAnalytics({ slug: params.slug, days: windowDays });
    const alerts = buildAlerts(records);
    return {
      slug: params.slug,
      windowDays: windowDays ?? 30,
      items: records,
      alerts,
    };
  });
};
