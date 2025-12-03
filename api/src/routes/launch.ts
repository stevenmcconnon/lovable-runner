import { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { RunnerService } from '../services/runner';
import { DatabaseService } from '../services/database';

const launchPayload = z
  .object({
    url: z.string().url().optional(),
    description: z.string().min(1).optional(),
    accountId: z.string().uuid().optional(),
    testMode: z.boolean().optional(),
    businessDetails: z
      .object({
        businessName: z.string().optional(),
        businessType: z.string().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        additionalDetails: z.string().optional(),
      })
      .optional(),
  })
  .refine((data) => Boolean(data.url || data.description), {
    message: 'url or description is required',
    path: ['url'],
  });

export const registerLaunchRoutes = (
  app: FastifyInstance,
  deps: { db: DatabaseService; runner: RunnerService }
) => {
  const { db, runner } = deps;

  const launchPreHandler = async (request: any, reply: any) => {
    let userError: any = null;
    try {
      await app.authenticateUser(request, reply);
      await app.requireRoles(request, reply, ['customer', 'admin', 'super-admin']);
      request.launchAuthContext = 'user';
      return;
    } catch (error) {
      userError = error;
    }
    try {
      await app.authenticateMachine(request, reply);
      request.launchAuthContext = 'machine';
    } catch (machineError) {
      throw userError || machineError;
    }
  };

  app.post('/launch', { preHandler: launchPreHandler }, async (request, reply) => {
    const parsed = launchPayload.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid payload', details: parsed.error.flatten() });
    }
    const body = parsed.data;
    const requestId = randomUUID();
    const profileAccountId = request.auth?.profile?.accountId ?? null;
    const profileUserId = request.auth?.profile?.id ?? null;
    const accountId = body.accountId ?? profileAccountId ?? null;
    const userId = profileUserId;
    const testMode = Boolean(body.testMode);
    const launchContext = (request as any).launchAuthContext;
    if (testMode && launchContext !== 'machine') {
      return reply.code(403).send({ message: 'testMode is only available for machine credentials' });
    }
    await db.createSiteGenerationRequest({
      requestId,
      accountId,
      userId,
      sourceUrl: body.url ?? null,
      description: body.description,
      businessDetails: body.businessDetails,
    });
    try {
      await runner.runLaunchDirect({
        url: body.url,
        description: body.description,
        businessDetails: body.businessDetails,
        requestId,
        testMode,
      });
      await db.touchSiteGenerationStage(requestId, 'running');
      return reply.code(202).send({ status: 'running', requestId });
    } catch (error: any) {
      await db.updateSiteGeneration(requestId, {
        status: 'failed',
        errorMessage: error?.message ?? 'Failed to start launch',
      });
      throw error;
    }
  });
};
