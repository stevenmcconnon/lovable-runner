import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DatabaseService } from '../services/database';

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

export const registerInternalRoutes = (
  app: FastifyInstance,
  deps: { db: DatabaseService }
) => {
  const { db } = deps;

  const machinePreHandler = async (request: any, reply: any) => {
    await app.authenticateMachine(request, reply);
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
};
