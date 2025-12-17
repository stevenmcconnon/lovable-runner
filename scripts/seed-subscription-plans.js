#!/usr/bin/env node
/* eslint-disable no-console */
const Stripe = require('stripe');
const { query, closePool } = require('../src/pg-client');

const plans = [
  {
    key: 'starter',
    name: 'Starter',
    priceCents: 2900,
    monthlyEditLimit: 5,
    stripePriceId: 'price_1SaXZTFXG8DaUq7ULBoQPaNO',
  },
  {
    key: 'growth',
    name: 'Growth',
    priceCents: 6900,
    monthlyEditLimit: 20,
    stripePriceId: 'price_1SaXYyFXG8DaUq7UVHtS7y7l',
  },
  {
    key: 'scale',
    name: 'Scale',
    priceCents: 14900,
    monthlyEditLimit: 75,
    stripePriceId: 'price_1SaXXbFXG8DaUq7UzIYWq2ra',
  },
  {
    key: 'starter-annual',
    name: 'Starter Annual',
    priceCents: 29000,
    monthlyEditLimit: 5,
    stripePriceId: 'price_1SaXa9FXG8DaUq7UenwkRVPC',
  },
  {
    key: 'growth-annual',
    name: 'Growth Annual',
    priceCents: 69000,
    monthlyEditLimit: 20,
    stripePriceId: 'price_1SaXbmFXG8DaUq7U1b5cP1Bu',
  },
  {
    key: 'scale-annual',
    name: 'Scale Annual',
    priceCents: 149000,
    monthlyEditLimit: 75,
    stripePriceId: 'price_1SaXcoFXG8DaUq7UAPZhufT5',
  },
];

const shouldSkipStripeVerification = () => {
  const flag = process.env.SKIP_STRIPE_VERIFY;
  if (flag && flag.toLowerCase() === 'false') return false;
  if (flag && ['1', 'true', 'yes'].includes(flag.toLowerCase())) return true;
  return process.argv.slice(2).includes('--skip-stripe-verify');
};

const skipStripeVerification = shouldSkipStripeVerification();

const buildStripeClient = () => {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return null;
  return new Stripe(secret, {
    apiVersion: '2024-06-20',
  });
};

const stripe = skipStripeVerification ? null : buildStripeClient();

if (skipStripeVerification) {
  console.warn('[plans] Stripe verification disabled. Update STRIPE_SECRET_KEY later to re-enable checks.');
}

const verifyStripePrice = async (plan) => {
  if (skipStripeVerification) {
    console.warn(`[plans] SKIP_STRIPE_VERIFY enabled; skipping Stripe check for ${plan.key}`);
    return;
  }
  if (!stripe) {
    console.warn(`[plans] STRIPE_SECRET_KEY not set; skipping verification for ${plan.key}`);
    return;
  }
  if (!plan.stripePriceId) {
    console.warn(`[plans] Plan ${plan.key} missing stripePriceId`);
    return;
  }
  try {
    const price = await stripe.prices.retrieve(plan.stripePriceId);
    const expectedCents = Number(plan.priceCents);
    if (price.unit_amount !== expectedCents) {
      console.warn(
        `[plans] Price mismatch for ${plan.key}: Stripe=${price.unit_amount}c expected=${expectedCents}c`
      );
    }
    if (price.currency !== 'usd') {
      console.warn(`[plans] Unexpected currency for ${plan.key}: ${price.currency}`);
    }
  } catch (error) {
    console.error(`[plans] Failed to fetch Stripe price ${plan.stripePriceId}`, error.message);
  }
};

const upsertPlan = async (plan) => {
  const values = [
    plan.key,
    plan.name,
    (plan.priceCents || 0) / 100,
    plan.monthlyEditLimit || null,
    plan.stripePriceId || null,
  ];
  await query(
    `
    INSERT INTO subscription_plans (plan_key, plan_name, price_monthly, monthly_edit_limit, stripe_price_id)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (plan_key)
    DO UPDATE SET
      plan_name = EXCLUDED.plan_name,
      price_monthly = EXCLUDED.price_monthly,
      monthly_edit_limit = EXCLUDED.monthly_edit_limit,
      stripe_price_id = EXCLUDED.stripe_price_id,
      updated_at = NOW()
  `,
    values
  );
};

const checkNamecheapConfig = () => {
  const required = ['NAMECHEAP_API_USER', 'NAMECHEAP_API_KEY', 'NAMECHEAP_CLIENT_IP'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    console.warn(
      `[plans] Namecheap configuration missing: ${missing.join(
        ', '
      )}. Update your environment before running production deploys.`
    );
  } else {
    console.log(
      `[plans] Namecheap credentials detected for user ${process.env.NAMECHEAP_API_USER} and IP ${process.env.NAMECHEAP_CLIENT_IP}`
    );
  }
};

const run = async () => {
  checkNamecheapConfig();
  for (const plan of plans) {
    await verifyStripePrice(plan);
    await upsertPlan(plan);
    console.log(`[plans] Upserted subscription plan ${plan.key}`);
  }
  console.log('[plans] Completed plan synchronization.');
};

run()
  .catch((error) => {
    console.error('[plans] Failed to seed subscription plans', error);
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => undefined));
