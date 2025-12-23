import { FastifyInstance } from 'fastify';
import { StripeService } from '../services/stripe';
import { DatabaseService } from '../services/database';
import { DomainOrderService } from '../services/domain-order';
import path from 'node:path';

const rootRequire = (relativePath: string): any => {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(path.join(process.cwd(), relativePath));
  } catch {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(path.join(__dirname, '..', '..', relativePath));
  }
};

const { suppressRecipient } = rootRequire('src/notification-preferences.js') as {
  suppressRecipient: (params: { slug: string; recipient: string }) => Promise<any>;
};

export const registerWebhookRoutes = (
  app: FastifyInstance,
  deps: { db: DatabaseService; stripe: StripeService; domainOrderService: DomainOrderService }
) => {
  const { stripe, db, domainOrderService } = deps;

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
    await stripe.handleWebhook(event, db, { domainOrderService });
    return { received: true };
  });

  app.post('/webhooks/ses', async (request, reply) => {
    const payload = request.body as any;
    if (!payload || typeof payload !== 'object') {
      return reply.code(400).send({ message: 'Invalid payload' });
    }
    // Support SNS-enveloped SES notifications
    const type = payload.Type || payload.type;
    if (type === 'SubscriptionConfirmation' && payload.SubscribeURL) {
      request.log.info({ topic: payload.TopicArn }, 'SES SNS subscription confirmation received');
      return reply.code(202).send({ ok: true });
    }
    let message = payload;
    if (payload.Message) {
      try {
        message = JSON.parse(payload.Message);
      } catch {
        message = payload.Message;
      }
    }
    const notificationType = message.notificationType || message.eventType;
    const mail = message.mail || {};
    const tags = mail.tags || {};
    const slug =
      (Array.isArray(tags.slug) && tags.slug[0]) ||
      (Array.isArray(tags.accountSlug) && tags.accountSlug[0]) ||
      'global';
    const recipients: string[] =
      notificationType === 'Bounce'
        ? message.bounce?.bouncedRecipients?.map((r: any) => r.emailAddress).filter(Boolean) || []
        : notificationType === 'Complaint'
          ? message.complaint?.complainedRecipients?.map((r: any) => r.emailAddress).filter(Boolean) || []
          : [];
    await Promise.all(
      recipients.map(async (email) => {
        try {
          await suppressRecipient({ slug, recipient: email.toLowerCase() });
        } catch (error) {
          request.log.warn({ err: error }, 'failed to suppress bounced recipient');
        }
      })
    );
    return reply.send({ ok: true, suppressed: recipients.length, type: notificationType });
  });
};
