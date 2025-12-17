import path from 'node:path';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DatabaseService } from '../services/database';
import { UserRole } from '../types';
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

type PromoteDraftToLiveResult = {
  bucket: string;
  sourcePrefix: string;
  destinationPrefix: string;
  copied: number;
};

const { promoteDraftToLive } = rootRequire('src/site-store.js') as {
  promoteDraftToLive: (slug: string) => Promise<PromoteDraftToLiveResult>;
};
const { recordAuditEvent } = rootRequire('src/audit-log.js') as {
  recordAuditEvent: (params: {
    slug?: string | null;
    accountId?: string | null;
    actorUserId?: string | null;
    actorEmail?: string | null;
    action: string;
    description?: string | null;
    metadata?: Record<string, any> | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  }) => Promise<void>;
};

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
  deps: { db: DatabaseService; notifications?: NotificationService }
) => {
  const { db, notifications } = deps;

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
      const publicUrl = buildPublicUrl(params.slug, body.target);
      const buildRequestMeta = () => {
        const forwardedFor = request.headers['x-forwarded-for'];
        const ipAddress =
          request.ip ||
          (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor) ||
          (request as any).raw?.socket?.remoteAddress ||
          null;
        const userAgentHeader = request.headers['user-agent'] || request.headers['User-Agent'];
        const userAgent = Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader || null;
        return { ipAddress, userAgent };
      };
      try {
        let promotion: PromoteDraftToLiveResult | null = null;
        if (body.target === 'live') {
          promotion = await promoteDraftToLive(params.slug);
        }
        const completed = await db.updateDeployment(deployment.id, {
          status: 'completed',
          publicUrl,
          bucket: promotion?.bucket ?? null,
          prefix: promotion?.destinationPrefix ?? null,
          completedAt: new Date().toISOString(),
        });
        const response =
          completed ?? {
          ...deployment,
          status: 'completed',
          publicUrl,
          bucket: promotion?.bucket ?? null,
          prefix: promotion?.destinationPrefix ?? null,
          completedAt: new Date().toISOString(),
        };
        if (notifications) {
          notifications
            .notifyDeploymentComplete({
              slug: params.slug,
              accountId: profile.accountId,
              target: body.target,
              publicUrl,
            })
            .catch((error) =>
              request.log.warn(
                { err: error, slug: params.slug, target: body.target },
                '[publish] Failed to enqueue notification'
              )
            );
        }
        const { ipAddress, userAgent } = buildRequestMeta();
        recordAuditEvent({
          slug: params.slug,
          accountId: profile.accountId,
          actorUserId: profile.id,
          actorEmail: profile.email,
          action: body.target === 'live' ? 'site.publish.live' : 'site.publish.preview',
          description: `Published ${params.slug} to ${body.target}`,
          metadata: {
            publicUrl,
            target: body.target,
            deploymentId: response.id,
          },
          ipAddress,
          userAgent,
        }).catch((error) =>
          request.log.warn({ err: error, slug: params.slug }, '[publish] audit log failed')
        );
        return response;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Publish failed';
        const statusCode = (error as any)?.statusCode === 404 ? 404 : 500;
        await db.updateDeployment(deployment.id, {
          status: 'failed',
          errorMessage: message,
        });
        recordAuditEvent({
          slug: params.slug,
          accountId: profile.accountId,
          actorUserId: profile.id,
          actorEmail: profile.email,
          action: 'site.publish.failed',
          description: `Publish failed for ${params.slug}`,
          metadata: {
            error: message,
            target: body.target,
            deploymentId: deployment.id,
          },
          ...buildRequestMeta(),
        }).catch((auditErr) =>
          request.log.warn({ err: auditErr, slug: params.slug }, '[publish] audit log failed')
        );
        request.log.error(
          { err: error, slug: params.slug, deploymentId: deployment.id },
          'Failed to publish site'
        );
        return reply.code(statusCode).send({
          message: statusCode === 404 ? 'Draft content not found' : 'Failed to publish site',
        });
      }
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
