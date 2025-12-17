import path from 'node:path';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const rootRequire = (relativePath: string): any => {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(path.join(process.cwd(), relativePath));
  } catch {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(path.join(__dirname, '..', '..', relativePath));
  }
};

const { recordAnalyticsEvent } = rootRequire('src/analytics.js') as {
  recordAnalyticsEvent: (params: { slug: string; type: string; metadata?: Record<string, any> }) => Promise<void>;
};

const pixelQuery = z.object({
  slug: z.string().min(1),
  event: z.enum(['view', 'cta']).default('view'),
  path: z.string().optional(),
  visitor: z.string().optional(),
});

export const registerTrackingRoutes = (app: FastifyInstance): void => {
  app.get('/track/pixel', async (request, reply) => {
    const parsed = pixelQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid payload' });
    }
    const { slug, event, path: pagePath, visitor } = parsed.data;
    const referrer =
      (request.headers.referer as string | undefined) ||
      (request.headers.referrer as string | undefined);
    try {
      await recordAnalyticsEvent({
        slug,
        type: event,
        metadata: {
          path: pagePath,
          referrer,
          visitorId: visitor || undefined,
        },
      });
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
