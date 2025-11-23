import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { StripeService } from '../services/stripe';
import { SupabaseService } from '../services/supabase';
import { UserRole } from '../types';

const checkoutSchema = z.object({
  planKey: z.string().min(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

const ensureCustomerAccess = (roles: UserRole[]) => {
  const allowed: UserRole[] = ['customer', 'admin', 'super-admin'];
  return allowed.some((role) => roles.includes(role));
};

export const registerBillingRoutes = (
  app: FastifyInstance,
  deps: { supabase: SupabaseService; stripe: StripeService }
) => {
  const { supabase, stripe } = deps;

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
      const plan = await supabase.getSubscriptionPlan(parsed.data.planKey);
      if (!plan) {
        return reply.code(400).send({ message: 'Plan not found' });
      }
      if (!plan.stripePriceId) {
        return reply.code(400).send({ message: 'Plan missing Stripe price id' });
      }
      const subscription = await supabase.getSubscription(request.auth.profile.accountId);
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
};
