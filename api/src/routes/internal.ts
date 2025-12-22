import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DatabaseService } from '../services/database';
import { domainHelpers } from '../services/domain';
import { DomainManager } from '../services/domain-manager';
import { config } from '../env';

const completeJobSchema = z.object({
  s3Key: z.string().min(1),
  previewUrl: z.string().url().optional(),
  lovableProjectId: z.string().optional(),
});

const failJobSchema = z.object({
  errorMessage: z.string().min(1),
});

const siteLaunchCompleteSchema = z.object({
  bucket: z.string().min(1),
  prefix: z.string().min(1),
  slug: z.string().min(1),
  publicUrl: z.string().url().optional(),
});

const siteLaunchFailSchema = z.object({
  errorMessage: z.string().min(1),
});

const siteLaunchStageSchema = z.object({
  status: z.enum(['running', 'building', 'deploying']),
});

const domainRefreshParams = z.object({
  domain: z.string().min(3),
});

const defaultUsageLimit = () => config.limits.trialEditLimit + config.limits.signedInBonusEdits;

const resolveUsageLimit = async (db: DatabaseService, accountId?: string | null) => {
  if (!accountId) return defaultUsageLimit();
  const subscription = await db.getSubscription(accountId);
  return subscription?.monthlyEditLimit ?? defaultUsageLimit();
};

export const registerInternalRoutes = (
  app: FastifyInstance,
  deps: { db: DatabaseService; domainManager?: DomainManager }
) => {
  const { db, domainManager } = deps;

  const machinePreHandler = async (request: any, reply: any) => {
    await app.authenticateMachine(request, reply);
    if (!request.auth?.permissions?.jobs?.run) {
      const error = new Error('Machine token missing jobs.run permission');
      // @ts-expect-error attach status
      error.statusCode = 403;
      throw error;
    }
  };

  app.post(
    '/internal/jobs/:jobId/complete',
    { preHandler: machinePreHandler },
    async (request, reply) => {
      const jobId = (request.params as any).jobId;
      const parsed = completeJobSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Invalid payload', details: parsed.error.flatten() });
      }
      const job = await db.updateJob(jobId, {
        status: 'completed',
        s3Key: parsed.data.s3Key,
        previewUrl: parsed.data.previewUrl,
        lovableProjectId: parsed.data.lovableProjectId,
      });
      await db.updateEditRequestStatus(job.editRequestId, 'completed', job.id);
      return job;
    }
  );

  app.post(
    '/internal/jobs/:jobId/fail',
    { preHandler: machinePreHandler },
    async (request, reply) => {
      const jobId = (request.params as any).jobId;
      const parsed = failJobSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Invalid payload', details: parsed.error.flatten() });
      }
      const job = await db.updateJob(jobId, {
        status: 'failed',
        errorMessage: parsed.data.errorMessage,
      });
      await db.updateEditRequestStatus(job.editRequestId, 'rejected', job.id);
      return job;
    }
  );

  app.post(
    '/internal/site-launches/:requestId/complete',
    { preHandler: machinePreHandler },
    async (request, reply) => {
      const requestId = (request.params as any).requestId;
      const parsed = siteLaunchCompleteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Invalid payload', details: parsed.error.flatten() });
      }
      const record = await db.getSiteGenerationByRequestId(requestId);
      if (!record) {
        return reply.code(404).send({ message: 'Site generation request not found' });
      }
      const publicUrl =
        parsed.data.publicUrl ??
        (parsed.data.bucket
          ? `https://${parsed.data.bucket}.s3.amazonaws.com/${parsed.data.prefix.replace(/\/$/, '')}/`
          : null);
      await db.updateSiteGeneration(requestId, {
        status: 'completed',
        bucket: parsed.data.bucket,
        prefix: parsed.data.prefix,
        slug: parsed.data.slug,
        publicUrl,
      });
      const updated = await db.getSiteGenerationByRequestId(requestId);
      const reservation = await db.consumeLaunchReservation(requestId);
      if (reservation) {
        const limit =
          reservation.limitSnapshot ?? (await resolveUsageLimit(db, reservation.accountId));
        await db.incrementUsage(reservation.accountId, limit, reservation.cost).catch((error) =>
          request.log.warn(
            { err: error, requestId },
            '[internal] Failed to consume launch usage reservation'
          )
        );
      }
      return reply.send(updated);
    }
  );

  app.post(
    '/internal/site-launches/:requestId/fail',
    { preHandler: machinePreHandler },
    async (request, reply) => {
      const requestId = (request.params as any).requestId;
      const parsed = siteLaunchFailSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Invalid payload', details: parsed.error.flatten() });
      }
      const record = await db.getSiteGenerationByRequestId(requestId);
      if (!record) {
        return reply.code(404).send({ message: 'Site generation request not found' });
      }
      await db.updateSiteGeneration(requestId, {
        status: 'failed',
        errorMessage: parsed.data.errorMessage,
      });
      await db.releaseLaunchReservation(requestId, parsed.data.errorMessage).catch((error) =>
        request.log.warn(
          { err: error, requestId },
          '[internal] Failed to release launch usage reservation'
        )
      );
      const updated = await db.getSiteGenerationByRequestId(requestId);
      return reply.send(updated);
    }
  );

  app.post(
    '/internal/site-launches/:requestId/stage',
    { preHandler: machinePreHandler },
    async (request, reply) => {
      const requestId = (request.params as any).requestId;
      const parsed = siteLaunchStageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Invalid payload', details: parsed.error.flatten() });
      }
      const record = await db.getSiteGenerationByRequestId(requestId);
      if (!record) {
        return reply.code(404).send({ message: 'Site generation request not found' });
      }
      await db.updateSiteGeneration(requestId, {
        status: parsed.data.status as any,
      });
      const updated = await db.getSiteGenerationByRequestId(requestId);
      return reply.send(updated);
    }
  );

  app.post(
    '/internal/domains/:domain/https-refresh',
    { preHandler: machinePreHandler },
    async (request, reply) => {
      if (!domainManager) {
        return reply.code(503).send({ message: 'Domain manager is not configured' });
      }
      const params = domainRefreshParams.parse(request.params);
      const sanitized = domainHelpers.sanitizeDomainInput(params.domain);
      if (!sanitized) {
        return reply.code(400).send({ message: 'Invalid domain value' });
      }
      const record = await db.getDomainByName(sanitized);
      if (!record) {
        return reply.code(404).send({ message: 'Domain not found' });
      }
      const updated = await domainManager.refreshHttps(record);
      return reply.send({ domain: updated ?? record });
    }
  );
};
