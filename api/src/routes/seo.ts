import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DatabaseService } from '../services/database';
import { SiteSeoService } from '../services/site-seo';

const slugParams = z.object({
  slug: z.string().min(3),
});

const snapshotQuery = z.object({
  host: z.string().optional(),
});

export const registerSeoRoutes = (
  app: FastifyInstance,
  deps: { db: DatabaseService; seo: SiteSeoService }
) => {
  const { seo } = deps;

  app.get('/seo/sites/:slug', async (request, reply) => {
    const params = slugParams.parse(request.params);
    const query = snapshotQuery.safeParse(request.query);
    const hostOverride = query.success ? query.data.host : undefined;
    const host = hostOverride || (request.headers.host as string | undefined) || null;
    const snapshot = await seo.buildSnapshot(params.slug, host);
    if (!snapshot) {
      return reply.code(404).send({ message: 'Site not found' });
    }
    return snapshot;
  });

  app.get('/seo/sites/:slug/sitemap.xml', async (request, reply) => {
    const params = slugParams.parse(request.params);
    const sitemap = await seo.buildSitemapXml(params.slug);
    if (!sitemap) {
      return reply.code(404).send('Site not found');
    }
    reply.type('application/xml');
    return sitemap.body;
  });

  app.get('/seo/sites/:slug/robots.txt', async (request, reply) => {
    const params = slugParams.parse(request.params);
    const robots = await seo.buildRobotsTxt(params.slug);
    if (!robots) {
      return reply.code(404).send('Site not found');
    }
    reply.type('text/plain');
    return robots;
  });
};
