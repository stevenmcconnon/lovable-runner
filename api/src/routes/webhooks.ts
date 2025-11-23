import { FastifyInstance } from 'fastify';
import { StripeService } from '../services/stripe';
import { DatabaseService } from '../services/database';

export const registerWebhookRoutes = (
  app: FastifyInstance,
  deps: { db: DatabaseService; stripe: StripeService }
) => {
  const { stripe, db } = deps;

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
    await stripe.handleWebhook(event, db);
    return { received: true };
  });
};
