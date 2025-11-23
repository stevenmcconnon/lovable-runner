import Stripe from 'stripe';
import { config } from '../env';
import { StripeCheckoutRequest, SubscriptionPlan } from '../types';
import { DatabaseService } from './database';

const stripeClient = new Stripe(config.stripe.secretKey, {
  apiVersion: '2024-06-20',
});

export class StripeService {
  private stripe = stripeClient;

  async createCheckoutSession(
    accountId: string,
    plan: SubscriptionPlan,
    params: StripeCheckoutRequest,
    options: { email?: string; existingCustomerId?: string } = {}
  ): Promise<{ checkoutUrl: string }> {
    if (!plan.stripePriceId) {
      throw new Error('Plan is missing Stripe price id');
    }
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      client_reference_id: accountId,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      customer_email: options.existingCustomerId ? undefined : options.email,
      customer: options.existingCustomerId,
      metadata: {
        accountId,
        planKey: plan.planKey,
      },
      subscription_data: {
        metadata: {
          accountId,
          planKey: plan.planKey,
        },
      },
    });

    if (!session.url) throw new Error('Stripe did not return a checkout url');
    return { checkoutUrl: session.url };
  }

  verifyWebhook(payload: Buffer | string, signature: string | undefined) {
    if (!config.stripe.webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }
    if (!signature) {
      throw new Error('Missing Stripe signature header');
    }
    return this.stripe.webhooks.constructEvent(payload, signature, config.stripe.webhookSecret);
  }

  async handleWebhook(event: Stripe.Event, db: DatabaseService) {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription) {
          const subscription = await this.stripe.subscriptions.retrieve(
            typeof session.subscription === 'string' ? session.subscription : session.subscription.id
          );
          await this.syncSubscription(subscription, db);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.syncSubscription(subscription, db);
        break;
      }
      default:
        break;
    }
  }

  private async syncSubscription(subscription: Stripe.Subscription, db: DatabaseService) {
    const accountId =
      subscription.metadata?.accountId ||
      subscription.metadata?.account_id ||
      subscription.metadata?.account;
    const planKey =
      subscription.metadata?.planKey ||
      subscription.metadata?.plan_key ||
      subscription.items.data[0]?.price?.metadata?.planKey ||
      subscription.items.data[0]?.price?.metadata?.plan_key;

    if (!accountId || !planKey) {
      console.warn('Subscription missing metadata for account/plan', subscription.id);
      return;
    }

    await db.upsertSubscriptionFromStripe({
      accountId,
      planKey,
      status: subscription.status,
      stripeCustomerId: subscription.customer as string,
      stripeSubscriptionId: subscription.id,
      currentPeriodStart: subscription.current_period_start
        ? subscription.current_period_start * 1000
        : null,
      currentPeriodEnd: subscription.current_period_end ? subscription.current_period_end * 1000 : null,
    });
  }
}
