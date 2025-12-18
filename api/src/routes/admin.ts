import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import AWS from 'aws-sdk';
import { randomUUID } from 'node:crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../env';
import { RunnerService } from '../services/runner';
import { DatabaseService } from '../services/database';
import { UserRole } from '../types';

const adminEditRequestQuery = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'rejected']).optional(),
  accountId: z.string().optional(),
  email: z.string().optional(),
});

const adminJobsQuery = z.object({
  status: z.enum(['queued', 'running', 'failed', 'completed']).optional(),
  editRequestId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});

const adminSiteLaunchQuery = z.object({
  accountId: z.string().uuid().optional(),
  status: z.enum(['queued', 'running', 'completed', 'failed']).optional(),
  limit: z.coerce.number().min(1).max(200).optional(),
});

const userRoleEnum = z.enum(['customer', 'admin', 'super-admin']);

const adminUserQuery = z.object({
  role: userRoleEnum.optional(),
  search: z.string().min(1).optional(),
  accountId: z.string().uuid().optional(),
});

const createAdminUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1).optional(),
  roles: z.array(userRoleEnum).min(1).optional(),
  accountId: z.string().uuid().optional(),
  sendInvite: z.boolean().optional(),
  temporaryPassword: z.string().min(8).optional(),
});

const updateAdminUserSchema = z.object({
  email: z.string().email().optional(),
  fullName: z.string().min(1).optional(),
  roles: z.array(userRoleEnum).min(1).optional(),
  accountId: z.string().uuid().optional(),
  temporaryPassword: z.string().min(8).optional(),
});

const accountParamsSchema = z.object({
  accountId: z.string().uuid(),
});

const userIdParamsSchema = z.object({
  userId: z.string().uuid(),
});

const jobEventsQuery = z.object({
  slug: z.string().optional(),
  action: z.string().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  requestId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});

const encodeCursor = (cursor: { createdAt: string; id: string }) =>
  Buffer.from(JSON.stringify(cursor)).toString('base64');

const decodeCursor = (token?: string | null) => {
  if (!token) return null;
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
    if (
      payload &&
      typeof payload === 'object' &&
      typeof (payload as any).createdAt === 'string' &&
      typeof (payload as any).id === 'string'
    ) {
      return payload as { createdAt: string; id: string };
    }
    return null;
  } catch {
    return null;
  }
};

const s3Client = new S3Client({ region: config.awsRegion });
const cognitoClient = new AWS.CognitoIdentityServiceProvider({ region: config.awsRegion });

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

  const enforceSuperAdmin = (request: FastifyRequest) => {
    if (!request.auth?.roles?.includes('super-admin')) {
      const error = new Error('Super admin role required');
      // @ts-expect-error attach status
      error.statusCode = 403;
      throw error;
    }
  };

  const superAdminPreHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    await adminPreHandler(request, reply);
    enforceSuperAdmin(request);
  };

  const resolveCognitoSub = async (username: string): Promise<string> => {
    const response = await cognitoClient
      .adminGetUser({
        UserPoolId: config.cognito.userPoolId,
        Username: username,
      })
      .promise();
    const attribute = response.UserAttributes?.find(
      (attr: AWS.CognitoIdentityServiceProvider.AttributeType) => attr.Name === 'sub'
    );
    if (!attribute?.Value) {
      throw new Error('Unable to resolve Cognito sub for user');
    }
    return attribute.Value;
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
    const cursor = parsed.data.cursor ? decodeCursor(parsed.data.cursor) : null;
    if (parsed.data.cursor && !cursor) {
      return reply.code(400).send({ message: 'Cursor token is invalid' });
    }
    const result = await db.listJobs({
      status: parsed.data.status,
      editRequestId: parsed.data.editRequestId,
      limit: parsed.data.limit,
      cursor: cursor ?? undefined,
    });
    const encodedCursor = result.nextCursor ? encodeCursor(result.nextCursor) : null;
    if (encodedCursor) {
      reply.header('x-next-cursor', encodedCursor);
    }
    return { items: result.items, nextCursor: encodedCursor };
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

  app.get('/admin/job-events', { preHandler: superAdminPreHandler }, async (request, reply) => {
    const parsed = jobEventsQuery.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid filters', details: parsed.error.flatten() });
    }
    const cursor = parsed.data.cursor ? decodeCursor(parsed.data.cursor) : null;
    if (parsed.data.cursor && !cursor) {
      return reply.code(400).send({ message: 'Cursor token is invalid' });
    }
    const { items, nextCursor } = await db.listJobEvents({
      limit: parsed.data.limit,
      cursor: cursor ?? undefined,
      slug: parsed.data.slug,
      action: parsed.data.action,
      status: parsed.data.status,
      type: parsed.data.type,
      requestId: parsed.data.requestId,
    });
    const encodedCursor = nextCursor ? encodeCursor(nextCursor) : null;
    if (encodedCursor) {
      reply.header('x-next-cursor', encodedCursor);
    }
    return { items, nextCursor: encodedCursor };
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

  app.get('/admin/users', { preHandler: superAdminPreHandler }, async (request, reply) => {
    const parsed = adminUserQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid filters', details: parsed.error.flatten() });
    }
    const users = await db.listUsersAdmin(parsed.data);
    return { items: users };
  });

  app.post('/admin/users', { preHandler: superAdminPreHandler }, async (request, reply) => {
    const body = createAdminUserSchema.parse(request.body);
    const roles = body.roles && body.roles.length ? body.roles : ['customer'];
    const sendInvite = body.sendInvite !== false;
    const createParams = {
      UserPoolId: config.cognito.userPoolId,
      Username: body.email,
      UserAttributes: [
        { Name: 'email', Value: body.email },
        { Name: 'email_verified', Value: 'true' },
        body.fullName ? { Name: 'name', Value: body.fullName } : null,
      ].filter(Boolean) as { Name: string; Value: string }[],
      MessageAction: sendInvite ? undefined : 'SUPPRESS',
      TemporaryPassword: body.temporaryPassword,
    };
    const createResponse = await cognitoClient.adminCreateUser(createParams).promise();
    const username = createResponse.User?.Username ?? body.email;
    let cognitoSub =
      createResponse.User?.Attributes?.find(
        (attr: AWS.CognitoIdentityServiceProvider.AttributeType) => attr.Name === 'sub'
      )?.Value ?? null;
    if (!cognitoSub) {
      cognitoSub = await resolveCognitoSub(username);
    }
    if (body.temporaryPassword && !sendInvite) {
      await cognitoClient
        .adminSetUserPassword({
          UserPoolId: config.cognito.userPoolId,
          Username: username,
          Password: body.temporaryPassword,
          Permanent: true,
        })
        .promise();
    }
    const profile = await db.createProfileRecord({
      email: body.email,
      fullName: body.fullName,
      cognitoSub,
      accountId: body.accountId,
    });
    await db.replaceRolesForUser(profile.id, roles as UserRole[]);
    const userRecord = await db.getAdminUserById(profile.id);
    return reply.code(201).send(userRecord);
  });

  app.get(
    '/admin/users/:userId',
    { preHandler: superAdminPreHandler },
    async (request, reply) => {
      const params = userIdParamsSchema.parse(request.params);
      const user = await db.getAdminUserById(params.userId);
      if (!user) return reply.code(404).send({ message: 'User not found' });
      return user;
    }
  );

  app.patch(
    '/admin/users/:userId',
    { preHandler: superAdminPreHandler },
    async (request, reply) => {
      const params = userIdParamsSchema.parse(request.params);
      const body = updateAdminUserSchema.parse(request.body ?? {});
      const user = await db.getAdminUserById(params.userId);
      if (!user) return reply.code(404).send({ message: 'User not found' });
      if (body.email || body.fullName || body.accountId) {
        await db.updateProfileById(params.userId, {
          email: body.email,
          fullName: body.fullName,
          accountId: body.accountId,
        });
        const updateAttributes: { Name: string; Value: string }[] = [];
        if (body.email) {
          updateAttributes.push({ Name: 'email', Value: body.email });
          updateAttributes.push({ Name: 'email_verified', Value: 'true' });
        }
        if (body.fullName) {
          updateAttributes.push({ Name: 'name', Value: body.fullName });
        }
        if (updateAttributes.length) {
          await cognitoClient
            .adminUpdateUserAttributes({
              UserPoolId: config.cognito.userPoolId,
              Username: user.cognitoSub,
              UserAttributes: updateAttributes,
            })
            .promise();
        }
      }
      if (body.roles) {
        await db.replaceRolesForUser(params.userId, body.roles as UserRole[]);
      }
      if (body.temporaryPassword) {
        await cognitoClient
          .adminSetUserPassword({
            UserPoolId: config.cognito.userPoolId,
            Username: user.cognitoSub,
            Password: body.temporaryPassword,
            Permanent: true,
          })
          .promise();
      }
      const updated = await db.getAdminUserById(params.userId);
      return updated ?? { message: 'User updated' };
    }
  );

  app.delete(
    '/admin/users/:userId',
    { preHandler: superAdminPreHandler },
    async (request, reply) => {
      const params = userIdParamsSchema.parse(request.params);
      const user = await db.getAdminUserById(params.userId);
      if (!user) return reply.code(404).send({ message: 'User not found' });
      try {
        await cognitoClient
          .adminDeleteUser({
            UserPoolId: config.cognito.userPoolId,
            Username: user.cognitoSub,
          })
          .promise();
      } catch (error) {
        request.log.warn({ err: error }, 'Failed to delete Cognito user (continuing)');
      }
      await db.deleteProfileForAdmin(params.userId);
      return reply.code(204).send();
    }
  );

  app.get('/admin/accounts', { preHandler: superAdminPreHandler }, async () => {
    const accounts = await db.listAccountsAdmin();
    return { items: accounts };
  });

  app.get(
    '/admin/accounts/:accountId',
    { preHandler: superAdminPreHandler },
    async (request, reply) => {
      const params = accountParamsSchema.parse(request.params);
      const account = await db.getAccountWithUsers(params.accountId);
      if (!account) return reply.code(404).send({ message: 'Account not found' });
      return account;
    }
  );

  app.get(
    '/admin/accounts/:accountId/sites',
    { preHandler: superAdminPreHandler },
    async (request, reply) => {
      const params = accountParamsSchema.parse(request.params);
      const filters = adminSiteLaunchQuery.safeParse(request.query);
      const limitFilters = filters.success ? filters.data : {};
      const items = await db.listSiteGenerationsAdmin({
        accountId: params.accountId,
        status: limitFilters.status,
        limit: limitFilters.limit,
      });
      return { items };
    }
  );
};
