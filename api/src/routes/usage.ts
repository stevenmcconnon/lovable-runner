import { FastifyInstance } from 'fastify';
import { DatabaseService } from '../services/database';
import { config } from '../env';
import { UserRole } from '../types';

const ensureUsageAccess = (roles: UserRole[]) => {
  const allowed: UserRole[] = ['customer', 'admin', 'super-admin'];
  return allowed.some((role) => roles.includes(role));
};

const trialAllowance = () => config.limits.trialEditLimit + config.limits.signedInBonusEdits;

export const registerUsageRoutes = (app: FastifyInstance, deps: { db: DatabaseService }) => {
  const { db } = deps;

  app.get('/usage', { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.auth?.profile || !ensureUsageAccess(request.auth.roles)) {
      return reply.code(403).send({ message: 'Forbidden' });
    }
    const profile = request.auth.profile;
    const subscription = await db.getSubscription(profile.accountId);
    const limit = subscription?.monthlyEditLimit ?? trialAllowance();
    const usage = await db.getUsage(profile.accountId, limit);
    const limits = db.buildUsageLimits(subscription, limit);
    const sites = (await db.listSiteGenerations(profile.accountId)).filter((site) => Boolean(site.slug));
    const metricsBySite = await Promise.all(
      sites.map(async (site) => {
        const metrics = await db.getSiteMetrics(site.slug as string, 30);
        return { slug: site.slug as string, ...metrics };
      })
    );
    const metricsSummary = metricsBySite.reduce(
      (acc, curr) => {
        acc.views += curr.views;
        acc.ctaClicks += curr.ctaClicks;
        return acc;
      },
      { views: 0, ctaClicks: 0 }
    );
    const billing = {
      planKey: subscription?.planKey ?? 'trial',
      planName: subscription?.planName ?? 'Trial',
      status: subscription?.status ?? 'none',
      isTrial: (subscription?.planKey ?? 'trial') === 'trial' || !subscription?.status,
      allowOverage: limits.allowOverage,
      coupons: limits.coupons ?? [],
    };
    return {
      usage,
      subscription: subscription ?? { status: 'none', planKey: 'trial', planName: 'Trial' },
      limits,
      billing,
      metrics: {
        windowDays: 30,
        views: metricsSummary.views,
        ctaClicks: metricsSummary.ctaClicks,
        sites: metricsBySite,
      },
    };
  });

  app.get('/usage/limits', { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.auth?.profile || !ensureUsageAccess(request.auth.roles)) {
      return reply.code(403).send({ message: 'Forbidden' });
    }
    const subscription = await db.getSubscription(request.auth.profile.accountId);
    const limits = db.buildUsageLimits(subscription, trialAllowance());
    return limits;
  });
};
