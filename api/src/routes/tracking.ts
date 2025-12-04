import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DatabaseService } from '../services/database';

const pixelQuery = z.object({
  slug: z.string().min(1),
  event: z.enum(['view', 'cta']).default('view'),
});

export const registerTrackingRoutes = (app: FastifyInstance, deps: { db: DatabaseService }) => {
  const { db } = deps;

  app.get('/track/pixel', async (request, reply) => {
    const parsed = pixelQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid payload' });
    }
    const { slug, event } = parsed.data;
    try {
      await db.recordSiteMetric(slug, event);
    } catch (error) {
      request.log.warn({ err: error }, '[track] failed to record metric');
    }
    reply
      .code(204)
      .header('Cache-Control', 'no-store, must-revalidate')
      .header('Content-Type', 'image/gif')
      .send();
  });
};
