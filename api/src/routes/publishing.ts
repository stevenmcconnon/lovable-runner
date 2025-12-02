import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DatabaseService } from '../services/database';
import { UserRole } from '../types';

const publishSchema = z
  .object({
    target: z.enum(['live', 'preview']).default('live'),
  })
  .optional();

const slugParams = z.object({
  slug: z.string().min(3),
});

const deploymentParams = slugParams.extend({
  deploymentId: z.string().uuid(),
});

const ensurePublishAccess = (roles: UserRole[]) => {
  const allowed: UserRole[] = ['customer', 'admin', 'super-admin'];
  return allowed.some((role) => roles.includes(role));
};

const buildPublicUrl = (slug: string, target: 'live' | 'preview') => {
  const host =
    target === 'live'
      ? (process.env.LIVE_DOMAIN || 'sites.ai-sitemaker.com').replace(/\/+$/, '')
      : (process.env.PREVIEW_DOMAIN || 'preview.ai-sitemaker.com').replace(/\/+$/, '');
  return `https://${host}/${slug}/`;
};

export const registerPublishingRoutes = (
  app: FastifyInstance,
  deps: { db: DatabaseService }
) => {
  const { db } = deps;

  app.post(
    '/sites/:slug/publish',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      if (!request.auth?.profile || !ensurePublishAccess(request.auth.roles)) {
        return reply.code(403).send({ message: 'Forbidden' });
      }
      const profile = request.auth.profile;
      const params = slugParams.parse(request.params);
      const body = publishSchema.parse(request.body) ?? { target: 'live' };
      const deployment = await db.createDeployment({
        slug: params.slug,
        accountId: profile.accountId,
        target: body.target,
        status: 'deploying',
        requestedBy: profile.id,
      });
      const completed = await db.updateDeployment(deployment.id, {
        status: 'completed',
        publicUrl: buildPublicUrl(params.slug, body.target),
        completedAt: new Date().toISOString(),
      });
      return completed ?? deployment;
    }
  );

  app.get(
    '/sites/:slug/deployments',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      if (!request.auth?.profile || !ensurePublishAccess(request.auth.roles)) {
        return reply.code(403).send({ message: 'Forbidden' });
      }
      const params = slugParams.parse(request.params);
      const isSuperAdmin = request.auth.roles.includes('super-admin');
      const deployments = await db.listDeployments(params.slug, 50);
      const filtered = deployments.filter((deployment) => {
        if (!deployment.accountId) return true;
        if (deployment.accountId === request.auth?.profile?.accountId) return true;
        return isSuperAdmin;
      });
      return { items: filtered };
    }
  );

  app.get(
    '/sites/:slug/deployments/:deploymentId',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      if (!request.auth?.profile || !ensurePublishAccess(request.auth.roles)) {
        return reply.code(403).send({ message: 'Forbidden' });
      }
      const params = deploymentParams.parse(request.params);
      const record = await db.getDeploymentById(params.deploymentId);
      if (!record || record.slug !== params.slug) {
        return reply.code(404).send({ message: 'Deployment not found' });
      }
      if (
        record.accountId &&
        record.accountId !== request.auth.profile.accountId &&
        !request.auth.roles.includes('super-admin')
      ) {
        return reply.code(404).send({ message: 'Deployment not found' });
      }
      return record;
    }
  );
};
