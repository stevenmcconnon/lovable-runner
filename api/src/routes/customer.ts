import { randomUUID } from 'node:crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../env';
import { RunnerService } from '../services/runner';
import { DatabaseService } from '../services/database';
import { UserRole } from '../types';

const businessDetailsSchema = z
  .object({
    businessName: z.string().max(255).optional(),
    businessType: z.string().max(255).optional(),
    phone: z.string().max(64).optional(),
    address: z.string().max(255).optional(),
    additionalDetails: z.string().max(2000).optional(),
  })
  .optional();

const editRequestInput = z.object({
  description: z.string().min(10).max(2000),
  siteId: z.string().optional(),
  business: businessDetailsSchema,
});

const siteLaunchInput = z.object({
  url: z.string().url(),
  description: z.string().max(2000).optional(),
  business: businessDetailsSchema,
});

const ensureCustomerAccess = (request: FastifyRequest) => {
  if (!request.auth || !request.auth.profile) {
    const error = new Error('Unauthorized');
    // @ts-expect-error attach status
    error.statusCode = 401;
    throw error;
  }
  const allowedRoles: UserRole[] = ['customer', 'admin', 'super-admin'];
  if (!allowedRoles.some((role) => request.auth?.roles.includes(role))) {
    const error = new Error('Forbidden');
    // @ts-expect-error attach status
    error.statusCode = 403;
    throw error;
  }
  return request.auth.profile;
};

export const registerCustomerRoutes = (
  app: FastifyInstance,
  deps: { db: DatabaseService; runner: RunnerService }
) => {
  const { db, runner } = deps;

  app.get('/me', { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.auth?.profile) {
      return reply.code(404).send({ message: 'Profile not found' });
    }
    const { profile } = request.auth;
    return {
      userId: profile.id,
      cognitoSub: profile.cognitoSub,
      email: profile.email,
      fullName: profile.fullName,
      roles: request.auth.roles,
    };
  });

  app.get(
    '/customer/subscription',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      const profile = ensureCustomerAccess(request);
      const subscription = await db.getSubscription(profile.accountId);
      if (!subscription) {
        return { status: 'none' };
      }
      return subscription;
    }
  );

  app.get('/customer/usage', { preHandler: app.authenticateUser }, async (request, reply) => {
    const profile = ensureCustomerAccess(request);
    const subscription = await db.getSubscription(profile.accountId);
    const limit = subscription?.monthlyEditLimit ?? config.limits.trialEditLimit;
    const usage = await db.getUsage(profile.accountId, limit);
    return usage;
  });

  app.get(
    '/customer/edit-requests',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      const profile = ensureCustomerAccess(request);
      const requests = await db.listCustomerEditRequests(profile.accountId);
      return requests;
    }
  );

  app.post(
    '/customer/edit-requests',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      const profile = ensureCustomerAccess(request);
      const parsed = editRequestInput.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          message: 'Validation error',
          details: parsed.error.flatten(),
        });
      }
      const body = parsed.data;
      const subscription = await db.getSubscription(profile.accountId);
      const isActive = subscription && subscription.status === 'active';
      const limit = isActive
        ? subscription.monthlyEditLimit ?? config.limits.trialEditLimit
        : config.limits.trialEditLimit;
      const usage = await db.getUsage(profile.accountId, limit);
      const remaining = isActive
        ? usage.remainingEdits
        : profile.hasUsedTrial
        ? 0
        : Math.max(config.limits.trialEditLimit - usage.editsUsedThisPeriod, 0);
      if (remaining <= 0) {
        return reply.code(403).send({
          message: 'Edit limit exceeded',
          code: 'LIMIT_EXCEEDED',
        });
      }

      const editRequest = await db.createEditRequest({
        accountId: profile.accountId,
        userId: profile.id,
        description: body.description,
        siteId: body.siteId,
        businessDetails: body.business,
      });
      const job = await db.createJobForRequest(editRequest.id);
      await runner.enqueueEditJob({
        jobId: job.id,
        editRequestId: editRequest.id,
        accountId: profile.accountId,
        description: body.description,
        siteId: body.siteId,
        businessDetails: body.business,
      });

      if (!isActive && !profile.hasUsedTrial) {
        await db.markTrialUsed(profile.id);
        profile.hasUsedTrial = true;
      }

      return reply.code(201).send({
        ...editRequest,
        latestJob: job,
      });
    }
  );

  app.post('/customer/sites', { preHandler: app.authenticateUser }, async (request, reply) => {
    const profile = ensureCustomerAccess(request);
    const parsed = siteLaunchInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        message: 'Validation error',
        details: parsed.error.flatten(),
      });
    }
    const body = parsed.data;
    const requestId = randomUUID();
    await db.createSiteGenerationRequest({
      requestId,
      accountId: profile.accountId,
      userId: profile.id,
      sourceUrl: body.url,
      description: body.description,
      businessDetails: body.business,
    });
    try {
      await runner.runLaunchDirect({
        url: body.url,
        description: body.description,
        businessDetails: body.business,
        requestId,
      });
      await db.touchSiteGenerationStage(requestId, 'running');
      return reply.code(202).send({ requestId, status: 'running' });
    } catch (error: any) {
      await db.updateSiteGeneration(requestId, {
        status: 'failed',
        errorMessage: error?.message ?? 'Failed to start launch',
      });
      throw error;
    }
  });

  app.get('/customer/sites', { preHandler: app.authenticateUser }, async (request, reply) => {
    const profile = ensureCustomerAccess(request);
    const items = await db.listSiteGenerations(profile.accountId);
    return items;
  });

  app.get('/sites', { preHandler: app.authenticateUser }, async (request, reply) => {
    const profile = ensureCustomerAccess(request);
    const items = await db.listSiteGenerations(profile.accountId);
    return { items };
  });

  app.get(
    '/customer/sites/:requestId',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      const profile = ensureCustomerAccess(request);
      const requestId = (request.params as any).requestId;
      const record = await db.getSiteGenerationByRequestId(requestId, profile.accountId);
      if (!record) {
        return reply.code(404).send({ message: 'Site request not found' });
      }
      return record;
    }
  );
};
