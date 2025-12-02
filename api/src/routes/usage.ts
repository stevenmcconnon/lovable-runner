import { FastifyInstance } from 'fastify';
import { DatabaseService } from '../services/database';
import { config } from '../env';
import { UserRole } from '../types';

const ensureUsageAccess = (roles: UserRole[]) => {
  const allowed: UserRole[] = ['customer', 'admin', 'super-admin'];
  return allowed.some((role) => roles.includes(role));
};

export const registerUsageRoutes = (app: FastifyInstance, deps: { db: DatabaseService }) => {
  const { db } = deps;

  app.get('/usage', { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.auth?.profile || !ensureUsageAccess(request.auth.roles)) {
      return reply.code(403).send({ message: 'Forbidden' });
    }
    const profile = request.auth.profile;
    const subscription = await db.getSubscription(profile.accountId);
    const limit = subscription?.monthlyEditLimit ?? config.limits.trialEditLimit;
    const usage = await db.getUsage(profile.accountId, limit);
    const limits = db.buildUsageLimits(subscription, config.limits.trialEditLimit);
    return {
      usage,
      subscription: subscription ?? { status: 'none', planKey: 'trial', planName: 'Trial' },
      limits,
    };
  });

  app.get('/usage/limits', { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.auth?.profile || !ensureUsageAccess(request.auth.roles)) {
      return reply.code(403).send({ message: 'Forbidden' });
    }
    const subscription = await db.getSubscription(request.auth.profile.accountId);
    const limits = db.buildUsageLimits(subscription, config.limits.trialEditLimit);
    return limits;
  });
};
