import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { StripeService } from '../services/stripe';
import { DatabaseService } from '../services/database';
import { UserRole } from '../types';
import { config } from '../env';

const checkoutSchema = z.object({
  planKey: z.string().min(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

const portalSchema = z.object({
  returnUrl: z.string().url(),
});

const ensureCustomerAccess = (roles: UserRole[]) => {
  const allowed: UserRole[] = ['customer', 'admin', 'super-admin'];
  return allowed.some((role) => roles.includes(role));
};

const trialAllowance = () => config.limits.trialEditLimit + config.limits.signedInBonusEdits;

export const registerBillingRoutes = (
  app: FastifyInstance,
  deps: { db: DatabaseService; stripe: StripeService }
) => {
  const { db, stripe } = deps;

  app.post(
    '/billing/create-checkout-session',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      if (!request.auth?.profile) return reply.code(401).send({ message: 'Unauthorized' });
      if (!ensureCustomerAccess(request.auth.roles)) {
        return reply.code(403).send({ message: 'Forbidden' });
      }
      const parsed = checkoutSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Invalid request', details: parsed.error.flatten() });
      }
      const plan = await db.getSubscriptionPlan(parsed.data.planKey);
      if (!plan) {
        return reply.code(400).send({ message: 'Plan not found' });
      }
      if (!plan.stripePriceId) {
        return reply.code(400).send({ message: 'Plan missing Stripe price id' });
      }
      const subscription = await db.getSubscription(request.auth.profile.accountId);
      const checkout = await stripe.createCheckoutSession(
        request.auth.profile.accountId,
        plan,
        parsed.data,
        {
          email: request.auth.profile.email,
          existingCustomerId: subscription?.stripeCustomerId ?? undefined,
        }
      );
      return checkout;
    }
  );

  app.get('/billing/plans', async (_request, reply) => {
    const plans = await db.listSubscriptionPlans();
    return { items: plans };
  });

  app.get(
    '/billing/subscription-status',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      if (!request.auth?.profile) {
        return reply.code(401).send({ message: 'Unauthorized' });
      }
      if (!ensureCustomerAccess(request.auth.roles)) {
        return reply.code(403).send({ message: 'Forbidden' });
      }
      const subscription = await db.getSubscription(request.auth.profile.accountId);
      const limit = subscription?.monthlyEditLimit ?? trialAllowance();
      const usage = await db.getUsage(request.auth.profile.accountId, limit);
      const limits = db.buildUsageLimits(subscription, limit);
      return {
        subscription: subscription ?? { status: 'none' },
        usage,
        limits,
      };
    }
  );

  app.post(
    '/billing/manage-portal',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      if (!request.auth?.profile) {
        return reply.code(401).send({ message: 'Unauthorized' });
      }
      if (!ensureCustomerAccess(request.auth.roles)) {
        return reply.code(403).send({ message: 'Forbidden' });
      }
      const body = portalSchema.parse(request.body);
      const subscription = await db.getSubscription(request.auth.profile.accountId);
      if (!subscription?.stripeCustomerId) {
        return reply.code(400).send({ message: 'No active Stripe subscription found' });
      }
      const portal = await stripe.createBillingPortalSession({
        customerId: subscription.stripeCustomerId,
        returnUrl: body.returnUrl,
      });
      return portal;
    }
  );
};
