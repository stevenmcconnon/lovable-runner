import { FastifyInstance } from 'fastify';
import { StripeService } from '../services/stripe';
import { SupabaseService } from '../services/supabase';

export const registerWebhookRoutes = (
  app: FastifyInstance,
  deps: { supabase: SupabaseService; stripe: StripeService }
) => {
  const { stripe, supabase } = deps;

  app.post('/webhooks/stripe', async (request, reply) => {
    const signature = request.headers['stripe-signature'] as string | undefined;
    const rawBody = (request as any).rawBody;
    if (!rawBody) {
      return reply.code(400).send({ message: 'Missing raw body' });
    }

    let event;
    try {
      event = stripe.verifyWebhook(rawBody, signature);
    } catch (error) {
      return reply.code(400).send({ message: 'Invalid Stripe signature' });
    }
    await stripe.handleWebhook(event, supabase);
    return { received: true };
  });
};
