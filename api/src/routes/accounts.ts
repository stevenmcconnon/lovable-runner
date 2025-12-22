import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DatabaseService } from '../services/database';

const invitationSchema = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'admin', 'customer', 'super-admin', 'member', 'viewer']).default('member'),
});

const acceptSchema = z.object({
  token: z.string().uuid(),
});

const shareSchema = z.object({
  slug: z.string().min(3),
  accountId: z.string().uuid(),
});

const getAccountContext = (request: any) => request.auth?.account;

const requireAccountRole = (
  request: any,
  roles: Array<string>
): { accountId: string; role: string } => {
  const account = getAccountContext(request);
  if (!account) {
    const error = new Error('Account context is required');
    // @ts-expect-error attach status
    error.statusCode = 400;
    throw error;
  }
  if (!roles.includes(account.role)) {
    const error = new Error('Forbidden');
    // @ts-expect-error attach status
    error.statusCode = 403;
    throw error;
  }
  return { accountId: account.id, role: account.role };
};

export const registerAccountRoutes = (app: FastifyInstance, deps: { db: DatabaseService }) => {
  const { db } = deps;

  app.get('/accounts/members', { preHandler: app.authenticateUser }, async (request, reply) => {
    const account = getAccountContext(request);
    if (!account) {
      return reply.code(400).send({ message: 'Account context required' });
    }
    const members = await db.listMembersForAccount(account.id);
    return { accountId: account.id, items: members };
  });

  app.post('/accounts/invitations', { preHandler: app.authenticateUser }, async (request, reply) => {
    const { accountId } = requireAccountRole(request, ['owner', 'admin']);
    const parsed = invitationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid request', details: parsed.error.flatten() });
    }
    const invite = await db.createInvitation({
      accountId,
      email: parsed.data.email,
      role: parsed.data.role as any,
      invitedBy: request.auth?.profile?.id,
    });
    return { token: invite.token };
  });

  app.post('/accounts/invitations/accept', { preHandler: app.authenticateUser }, async (request, reply) => {
    const parsed = acceptSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid request', details: parsed.error.flatten() });
    }
    if (!request.auth?.profile?.id) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }
    const membership = await db.acceptInvitation(parsed.data.token, request.auth.profile.id);
    if (!membership) {
      return reply.code(404).send({ message: 'Invitation not found or already used' });
    }
    return { membership };
  });

  app.post('/accounts/share-site', { preHandler: app.authenticateUser }, async (request, reply) => {
    const { accountId } = requireAccountRole(request, ['owner', 'admin']);
    const parsed = shareSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid request', details: parsed.error.flatten() });
    }
    // Ensure the current account actually owns the slug
    const slugs = await db.listAccountSlugs(accountId);
    if (!slugs.includes(parsed.data.slug)) {
      return reply.code(404).send({ message: 'Site not found in this account' });
    }
    await db.shareSiteWithAccount(parsed.data.slug, parsed.data.accountId);
    return { ok: true };
  });
};
