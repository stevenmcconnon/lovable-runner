import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  AdminCreateUserCommandInput,
  AdminUpdateUserAttributesCommandInput,
  AttributeType,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../env';
import { RunnerService } from '../services/runner';
import { DatabaseService } from '../services/database';
import { UserRole } from '../types';
import { TelemetryService } from '../services/telemetry';

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

const adminAccountsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
  search: z.string().min(1).optional(),
});

const encodeCursor = (cursor: Record<string, string>) =>
  Buffer.from(JSON.stringify(cursor)).toString('base64');

const decodeCursor = <TKeys extends string>(
  token?: string | null,
  requiredKeys: TKeys[] = []
): Record<TKeys, string> | null => {
  if (!token) return null;
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
    if (
      payload &&
      typeof payload === 'object' &&
      Object.values(payload as Record<string, unknown>).every((value) => typeof value === 'string')
    ) {
      const record = payload as Record<string, string>;
      if (requiredKeys.every((key) => typeof record[key] === 'string')) {
        return record as Record<TKeys, string>;
      }
    }
    return null;
  } catch {
    return null;
  }
};

const s3Client = new S3Client({ region: config.awsRegion });
const cognitoClient = new CognitoIdentityProviderClient({ region: config.awsRegion });

export const registerAdminRoutes = (
  app: FastifyInstance,
  deps: { db: DatabaseService; runner: RunnerService; telemetry?: TelemetryService }
) => {
  const { db, runner, telemetry } = deps;

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
      if (!request.auth?.permissions?.admin) {
        const error = new Error('Machine token missing admin permission');
        // @ts-expect-error attach status
        error.statusCode = 403;
        throw error;
      }
    } catch (machineError) {
      throw userError || machineError;
    }
  };

  const enforceSuperAdmin = (request: FastifyRequest) => {
    if (request.auth?.type !== 'user' || !request.auth?.roles?.includes('super-admin')) {
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
    const response = await cognitoClient.send(
      new AdminGetUserCommand({
        UserPoolId: config.cognito.userPoolId,
        Username: username,
      })
    );
    const attribute = response.UserAttributes?.find((attr: AttributeType) => attr.Name === 'sub');
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
    const cursor = parsed.data.cursor
      ? decodeCursor(parsed.data.cursor, ['createdAt', 'id'] as const)
      : null;
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
    const cursor = parsed.data.cursor
      ? decodeCursor(parsed.data.cursor, ['createdAt', 'id'] as const)
      : null;
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

  app.get('/admin/owner-metrics', { preHandler: superAdminPreHandler }, async () => {
    const snapshot = await db.getOwnerDashboardSnapshot();
    return snapshot;
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
    const createParams: AdminCreateUserCommandInput = {
      UserPoolId: config.cognito.userPoolId,
      Username: body.email,
      UserAttributes: [
        { Name: 'email', Value: body.email },
        { Name: 'email_verified', Value: 'true' },
        body.fullName ? { Name: 'name', Value: body.fullName } : null,
      ].filter(Boolean) as { Name: string; Value: string }[],
      MessageAction: sendInvite ? undefined : ('SUPPRESS' as const),
      TemporaryPassword: body.temporaryPassword,
    };
    const createResponse = await cognitoClient.send(new AdminCreateUserCommand(createParams));
    const username = createResponse.User?.Username ?? body.email;
    let cognitoSub =
      createResponse.User?.Attributes?.find((attr: AttributeType) => attr.Name === 'sub')?.Value ??
      null;
    if (!cognitoSub) {
      cognitoSub = await resolveCognitoSub(username);
    }
    if (body.temporaryPassword && !sendInvite) {
      await cognitoClient.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: config.cognito.userPoolId,
          Username: username,
          Password: body.temporaryPassword,
          Permanent: true,
        })
      );
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
          await cognitoClient.send(
            new AdminUpdateUserAttributesCommand({
              UserPoolId: config.cognito.userPoolId,
              Username: user.cognitoSub,
              UserAttributes: updateAttributes,
            })
          );
        }
      }
      if (body.roles) {
        await db.replaceRolesForUser(params.userId, body.roles as UserRole[]);
      }
      if (body.temporaryPassword) {
        await cognitoClient.send(
          new AdminSetUserPasswordCommand({
            UserPoolId: config.cognito.userPoolId,
            Username: user.cognitoSub,
            Password: body.temporaryPassword,
            Permanent: true,
          })
        );
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
        await cognitoClient.send(
          new AdminDeleteUserCommand({
            UserPoolId: config.cognito.userPoolId,
            Username: user.cognitoSub,
          })
        );
      } catch (error) {
        request.log.warn({ err: error }, 'Failed to delete Cognito user (continuing)');
      }
      await db.deleteProfileForAdmin(params.userId);
      return reply.code(204).send();
    }
  );

  app.get('/admin/accounts', { preHandler: superAdminPreHandler }, async (request, reply) => {
    const parsed = adminAccountsQuery.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid filters', details: parsed.error.flatten() });
    }
    const cursorPayload = parsed.data.cursor
      ? decodeCursor(parsed.data.cursor, ['sortDate', 'accountId'] as const)
      : null;
    if (parsed.data.cursor && !cursorPayload) {
      return reply.code(400).send({ message: 'Cursor token is invalid' });
    }
    const { items, nextCursor } = await db.listAccountsAdmin({
      limit: parsed.data.limit,
      search: parsed.data.search,
      cursor: cursorPayload
        ? { sortDate: cursorPayload.sortDate, accountId: cursorPayload.accountId }
        : undefined,
    });
    const encodedCursor = nextCursor ? encodeCursor(nextCursor) : null;
    if (encodedCursor) {
      reply.header('x-next-cursor', encodedCursor);
    }
    return { items, nextCursor: encodedCursor };
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

  app.get('/admin/telemetry', { preHandler: adminPreHandler }, async (request, reply) => {
    if (!telemetry) {
      return reply.code(503).send({ message: 'Telemetry service unavailable' });
    }
    const snapshot = await telemetry.getSnapshot();
    return snapshot;
  });
};
