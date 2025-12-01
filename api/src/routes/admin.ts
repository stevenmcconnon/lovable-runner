import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../env';
import { RunnerService } from '../services/runner';
import { DatabaseService } from '../services/database';
import { SiteGenerationStatus } from '../types';

const adminEditRequestQuery = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'rejected']).optional(),
  accountId: z.string().optional(),
  email: z.string().optional(),
});

const adminJobsQuery = z.object({
  status: z.enum(['queued', 'running', 'failed', 'completed']).optional(),
  editRequestId: z.string().optional(),
});

const adminSiteLaunchQuery = z.object({
  accountId: z.string().uuid().optional(),
  status: z.enum(['queued', 'running', 'completed', 'failed']).optional(),
  limit: z.coerce.number().min(1).max(200).optional(),
});

const s3Client = new S3Client({ region: config.awsRegion });

export const registerAdminRoutes = (
  app: FastifyInstance,
  deps: { db: DatabaseService; runner: RunnerService }
) => {
  const { db, runner } = deps;

  const adminPreHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    let userError: any = null;
    try {
      await app.authenticateUser(request, reply);
      await app.requireRoles(request, reply, ['admin', 'super-admin']);
      return;
    } catch (error) {
      userError = error;
    }
    try {
      await app.authenticateMachine(request, reply);
    } catch (machineError) {
      throw userError || machineError;
    }
  };

  app.get('/admin/edit-requests', { preHandler: adminPreHandler }, async (request, reply) => {
    const parsed = adminEditRequestQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid filters', details: parsed.error.flatten() });
    }
    const items = await db.listAdminEditRequests(parsed.data);
    return items;
  });

  app.get('/admin/edit-requests/:id', { preHandler: adminPreHandler }, async (request, reply) => {
    const item = await db.getEditRequestById((request.params as any).id);
    if (!item) return reply.code(404).send({ message: 'Edit request not found' });
    return item;
  });

  app.get('/admin/jobs', { preHandler: adminPreHandler }, async (request, reply) => {
    const parsed = adminJobsQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid filters', details: parsed.error.flatten() });
    }
    const jobs = await db.listJobs(parsed.data);
    return jobs;
  });

  app.post(
    '/admin/jobs/:jobId/retry',
    { preHandler: adminPreHandler },
    async (request, reply) => {
      const jobId = (request.params as any).jobId;
      const newJob = await db.retryJob(jobId);
      const editRequest = await db.getEditRequestById(newJob.editRequestId);
      if (editRequest) {
        await runner.enqueueEditJob({
          jobId: newJob.id,
          editRequestId: editRequest.id,
          accountId: editRequest.accountId,
          description: editRequest.description,
          siteId: editRequest.siteId,
        });
      }
      return newJob;
    }
  );

  app.post(
    '/admin/upload-template',
    { preHandler: adminPreHandler },
    async (request, reply) => {
      const file = await request.file();
      if (!file) return reply.code(400).send({ message: 'file is required' });
      const buffer = await file.toBuffer();
      const key = `templates/${randomUUID()}-${file.filename}`;
      await s3Client.send(
        new PutObjectCommand({
          Bucket: config.s3.templateBucket,
          Key: key,
          Body: buffer,
          ContentType: file.mimetype,
        })
      );
      const templateId = randomUUID();
      const record = await db.recordTemplateUpload({
        templateId,
        fileName: file.filename,
        s3Key: key,
        uploadedBy: request.auth?.profile?.id ?? request.auth?.sub ?? 'admin',
      });
      return reply.code(201).send({
        templateId: record.templateId,
        fileName: record.fileName,
        uploadedAt: record.uploadedAt,
      });
    }
  );

  app.get('/admin/site-launches', { preHandler: adminPreHandler }, async (request, reply) => {
    const parsed = adminSiteLaunchQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid filters', details: parsed.error.flatten() });
    }
    const items = await db.listSiteGenerationsAdmin(parsed.data);
    return items;
  });

  app.get(
    '/admin/site-launches/:requestId',
    { preHandler: adminPreHandler },
    async (request, reply) => {
      const item = await db.getSiteGenerationByRequestId((request.params as any).requestId);
      if (!item) return reply.code(404).send({ message: 'Site launch not found' });
      return item;
    }
  );
};
