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
};
