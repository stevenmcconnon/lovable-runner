import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    DATABASE_URL: z.string().min(1).optional(),
    DB_HOST: z.string().min(1).optional(),
    DB_PORT: z.string().min(1).optional(),
    DB_NAME: z.string().min(1).optional(),
    DB_USERNAME: z.string().min(1).optional(),
    DB_PASSWORD: z.string().min(1).optional(),
    STRIPE_SECRET_KEY: z.string().min(1, 'STRIPE_SECRET_KEY is required'),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    COGNITO_USER_POOL_ID: z.string().min(1, 'COGNITO_USER_POOL_ID is required'),
    COGNITO_USER_POOL_REGION: z.string().min(1, 'COGNITO_USER_POOL_REGION is required'),
    COGNITO_APP_CLIENT_ID: z.string().min(1, 'COGNITO_APP_CLIENT_ID is required'),
    COGNITO_APP_CLIENT_SECRET: z.string().optional(),
    COGNITO_DOMAIN: z.string().min(1, 'COGNITO_DOMAIN is required'),
    COGNITO_CLIENT_ID: z.string().optional(),
    COGNITO_CLIENT_SECRET: z.string().optional(),
    COGNITO_USER_POOL_DOMAIN: z.string().optional(),
    COGNITO_M2M_CLIENT_ID: z.string().optional(),
    RUNNER_FUNCTION_NAME: z.string().optional(),
    RUNNER_QUEUE_URL: z.string().url().optional(),
    TEMPLATE_UPLOAD_BUCKET: z.string().min(1, 'TEMPLATE_UPLOAD_BUCKET is required'),
    DEFAULT_TRIAL_EDIT_LIMIT: z.coerce.number().default(1),
    SIGNED_IN_BONUS_EDITS: z.coerce.number().default(1),
    ANONYMOUS_LAUNCH_LIMIT: z.coerce.number().default(1),
    AWS_REGION: z.string().optional(),
    FRONTEND_ORIGIN: z.string().optional(),
    AUTH_CALLBACK_URL: z.string().optional(),
    SITE_BUILDER_API_ENABLED: z.string().optional(),
    SITE_DOCS_TOKEN: z.string().optional(),
    THUMBNAIL_SERVICE_BASE: z.string().optional(),
    NAMECHEAP_API_USER: z.string().optional(),
    NAMECHEAP_API_KEY: z.string().optional(),
    NAMECHEAP_USERNAME: z.string().optional(),
    NAMECHEAP_API_BASE: z.string().optional(),
    NAMECHEAP_CLIENT_IP: z.string().optional(),
    DOMAIN_PRICE_CENTS: z.string().optional(),
    DOMAIN_PRICE_MARKUP_CENTS: z.string().optional(),
    DOMAIN_BASE_PRICE_CENTS: z.string().optional(),
    PREVIEW_DOMAIN: z.string().optional(),
    LIVE_DOMAIN: z.string().optional(),
    CUSTOM_DOMAIN_ORIGIN: z.string().optional(),
    CUSTOM_DOMAIN_CERT_REGION: z.string().optional(),
    CUSTOM_DOMAIN_PRICE_CLASS: z.string().optional(),
    CUSTOM_DOMAIN_CANONICAL_DEFAULT: z.string().optional(),
    CUSTOM_DOMAIN_DISTRIBUTION_ID: z.string().optional(),
    DOMAIN_JOB_BATCH_LIMIT: z.string().optional(),
    DOMAIN_JOB_MAX_RUNTIME_MS: z.string().optional(),
    DOMAIN_MAX_PER_ACCOUNT: z.string().optional(),
    DOMAIN_ORDER_DAILY_LIMIT: z.string().optional(),
    DOMAIN_REFRESH_DAILY_LIMIT: z.string().optional(),
    ANALYTICS_DATABASE_URL: z.string().optional(),
  })
  .refine(
    (value) =>
      Boolean(value.DATABASE_URL) ||
      Boolean(
        value.DB_HOST &&
          value.DB_NAME &&
          value.DB_USERNAME &&
          value.DB_PASSWORD &&
          (value.DB_PORT ?? true)
      ),
    {
      message:
        'DATABASE_URL or DB_HOST/DB_PORT/DB_NAME/DB_USERNAME/DB_PASSWORD must be provided to connect to PostgreSQL.',
      path: ['DATABASE_URL'],
    }
  );

const rawEnv = envSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  DB_HOST: process.env.DB_HOST,
  DB_PORT: process.env.DB_PORT,
  DB_NAME: process.env.DB_NAME,
  DB_USERNAME: process.env.DB_USERNAME,
  DB_PASSWORD: process.env.DB_PASSWORD,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID,
  COGNITO_USER_POOL_REGION: process.env.COGNITO_USER_POOL_REGION,
  COGNITO_APP_CLIENT_ID: process.env.COGNITO_APP_CLIENT_ID,
  COGNITO_APP_CLIENT_SECRET: process.env.COGNITO_APP_CLIENT_SECRET,
  COGNITO_DOMAIN: process.env.COGNITO_DOMAIN,
  COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID,
  COGNITO_CLIENT_SECRET: process.env.COGNITO_CLIENT_SECRET,
  COGNITO_USER_POOL_DOMAIN: process.env.COGNITO_USER_POOL_DOMAIN,
  COGNITO_M2M_CLIENT_ID: process.env.COGNITO_M2M_CLIENT_ID,
  RUNNER_FUNCTION_NAME: process.env.RUNNER_FUNCTION_NAME,
  RUNNER_QUEUE_URL: process.env.RUNNER_QUEUE_URL,
  TEMPLATE_UPLOAD_BUCKET: process.env.TEMPLATE_UPLOAD_BUCKET,
  DEFAULT_TRIAL_EDIT_LIMIT: process.env.DEFAULT_TRIAL_EDIT_LIMIT,
  SIGNED_IN_BONUS_EDITS: process.env.SIGNED_IN_BONUS_EDITS,
  ANONYMOUS_LAUNCH_LIMIT: process.env.ANONYMOUS_LAUNCH_LIMIT,
  AWS_REGION: process.env.AWS_REGION,
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN,
  AUTH_CALLBACK_URL: process.env.AUTH_CALLBACK_URL,
  SITE_BUILDER_API_ENABLED: process.env.SITE_BUILDER_API_ENABLED,
  SITE_DOCS_TOKEN: process.env.SITE_DOCS_TOKEN,
  THUMBNAIL_SERVICE_BASE: process.env.THUMBNAIL_SERVICE_BASE,
  NAMECHEAP_API_USER: process.env.NAMECHEAP_API_USER,
  NAMECHEAP_API_KEY: process.env.NAMECHEAP_API_KEY,
  NAMECHEAP_USERNAME: process.env.NAMECHEAP_USERNAME,
  NAMECHEAP_API_BASE: process.env.NAMECHEAP_API_BASE,
  NAMECHEAP_CLIENT_IP: process.env.NAMECHEAP_CLIENT_IP,
  DOMAIN_PRICE_CENTS: process.env.DOMAIN_PRICE_CENTS,
  DOMAIN_PRICE_MARKUP_CENTS: process.env.DOMAIN_PRICE_MARKUP_CENTS,
  DOMAIN_BASE_PRICE_CENTS: process.env.DOMAIN_BASE_PRICE_CENTS,
  PREVIEW_DOMAIN: process.env.PREVIEW_DOMAIN,
  LIVE_DOMAIN: process.env.LIVE_DOMAIN,
  CUSTOM_DOMAIN_ORIGIN: process.env.CUSTOM_DOMAIN_ORIGIN,
  CUSTOM_DOMAIN_CERT_REGION: process.env.CUSTOM_DOMAIN_CERT_REGION,
  CUSTOM_DOMAIN_PRICE_CLASS: process.env.CUSTOM_DOMAIN_PRICE_CLASS,
  CUSTOM_DOMAIN_CANONICAL_DEFAULT: process.env.CUSTOM_DOMAIN_CANONICAL_DEFAULT,
  CUSTOM_DOMAIN_DISTRIBUTION_ID: process.env.CUSTOM_DOMAIN_DISTRIBUTION_ID,
  DOMAIN_JOB_BATCH_LIMIT: process.env.DOMAIN_JOB_BATCH_LIMIT,
  DOMAIN_JOB_MAX_RUNTIME_MS: process.env.DOMAIN_JOB_MAX_RUNTIME_MS,
  DOMAIN_MAX_PER_ACCOUNT: process.env.DOMAIN_MAX_PER_ACCOUNT,
  DOMAIN_ORDER_DAILY_LIMIT: process.env.DOMAIN_ORDER_DAILY_LIMIT,
  DOMAIN_REFRESH_DAILY_LIMIT: process.env.DOMAIN_REFRESH_DAILY_LIMIT,
  ANALYTICS_DATABASE_URL: process.env.ANALYTICS_DATABASE_URL,
});

const fallbackOrigin = rawEnv.FRONTEND_ORIGIN ?? 'https://ai-sitemaker.com';
const fallbackCallbackUrl =
  rawEnv.AUTH_CALLBACK_URL ?? `${fallbackOrigin.replace(/\/$/, '')}/auth/callback`;
const cognitoDomain =
  rawEnv.COGNITO_USER_POOL_DOMAIN ??
  rawEnv.COGNITO_DOMAIN ??
  `ai-sitemaker-auth.auth.${rawEnv.COGNITO_USER_POOL_REGION}.amazonaws.com`;
const cognitoClientId = rawEnv.COGNITO_CLIENT_ID ?? rawEnv.COGNITO_APP_CLIENT_ID;
const cognitoClientSecret = rawEnv.COGNITO_CLIENT_SECRET ?? rawEnv.COGNITO_APP_CLIENT_SECRET;

const namecheapConfigured =
  rawEnv.NAMECHEAP_API_USER && rawEnv.NAMECHEAP_API_KEY && rawEnv.NAMECHEAP_CLIENT_IP;

const domainRegistrar = namecheapConfigured
  ? {
      namecheap: {
        apiUser: rawEnv.NAMECHEAP_API_USER!,
        apiKey: rawEnv.NAMECHEAP_API_KEY!,
        username: rawEnv.NAMECHEAP_USERNAME || rawEnv.NAMECHEAP_API_USER!,
        clientIp: rawEnv.NAMECHEAP_CLIENT_IP!,
        baseUrl: rawEnv.NAMECHEAP_API_BASE || 'https://api.namecheap.com/xml.response',
      },
    }
  : undefined;

const domainPricing = {
  markupCents: Number(rawEnv.DOMAIN_PRICE_MARKUP_CENTS || rawEnv.DOMAIN_PRICE_CENTS || '300'),
  defaultBasePriceCents: Number(rawEnv.DOMAIN_BASE_PRICE_CENTS || rawEnv.DOMAIN_PRICE_CENTS || '1200'),
};

const sanitizeHostname = (value?: string | null) =>
  value ? value.replace(/^https?:\/\//i, '').replace(/\/+$/, '') : '';

const canonicalDefault =
  rawEnv.CUSTOM_DOMAIN_CANONICAL_DEFAULT &&
  rawEnv.CUSTOM_DOMAIN_CANONICAL_DEFAULT.toLowerCase() === 'www'
    ? 'www'
    : 'apex';

const allowedPriceClasses = new Set(['PriceClass_100', 'PriceClass_200', 'PriceClass_All']);
const edgePriceClass = allowedPriceClasses.has(rawEnv.CUSTOM_DOMAIN_PRICE_CLASS || '')
  ? (rawEnv.CUSTOM_DOMAIN_PRICE_CLASS as 'PriceClass_100' | 'PriceClass_200' | 'PriceClass_All')
  : 'PriceClass_100';

const previewDomain = sanitizeHostname(rawEnv.PREVIEW_DOMAIN) || 'preview.ai-sitemaker.com';
const liveDomain = sanitizeHostname(rawEnv.LIVE_DOMAIN) || '';
const edgeOriginHostname =
  sanitizeHostname(rawEnv.CUSTOM_DOMAIN_ORIGIN) || liveDomain || previewDomain || 'sites.ai-sitemaker.com';
const edgeDistributionId = rawEnv.CUSTOM_DOMAIN_DISTRIBUTION_ID || '';

const domainJobBatchLimit = (() => {
  const parsed = Number(rawEnv.DOMAIN_JOB_BATCH_LIMIT ?? '');
  const fallback = 10;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(parsed, 50));
})();

const domainJobMaxRuntimeMs = (() => {
  const parsed = Number(rawEnv.DOMAIN_JOB_MAX_RUNTIME_MS ?? '');
  const fallback = 60_000;
  const value = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.max(1000, Math.min(value, 300_000));
})();

const parseLimitValue = (value: string | undefined, fallback: number) => {
  const parsed = Number(value ?? '');
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
};

const domainLimits = {
  maxPerAccount: Math.max(0, parseLimitValue(rawEnv.DOMAIN_MAX_PER_ACCOUNT, 0)),
  maxOrdersPerDay: Math.max(0, parseLimitValue(rawEnv.DOMAIN_ORDER_DAILY_LIMIT, 0)),
  refreshDailyLimit: Math.max(0, parseLimitValue(rawEnv.DOMAIN_REFRESH_DAILY_LIMIT, 0)),
};

const buildDatabaseUrl = () => {
  if (rawEnv.DATABASE_URL) return rawEnv.DATABASE_URL;
  if (
    rawEnv.DB_HOST &&
    rawEnv.DB_NAME &&
    rawEnv.DB_USERNAME &&
    rawEnv.DB_PASSWORD
  ) {
    const port = rawEnv.DB_PORT || '5432';
    const user = encodeURIComponent(rawEnv.DB_USERNAME);
    const password = encodeURIComponent(rawEnv.DB_PASSWORD);
    return `postgresql://${user}:${password}@${rawEnv.DB_HOST}:${port}/${rawEnv.DB_NAME}`;
  }
  throw new Error('Unable to determine database connection information');
};

export const config = {
  nodeEnv: rawEnv.NODE_ENV ?? 'development',
  database: {
    url: buildDatabaseUrl(),
    analyticsUrl: rawEnv.ANALYTICS_DATABASE_URL || undefined,
  },
  stripe: {
    secretKey: rawEnv.STRIPE_SECRET_KEY,
    webhookSecret: rawEnv.STRIPE_WEBHOOK_SECRET,
  },
  cognito: {
    userPoolId: rawEnv.COGNITO_USER_POOL_ID,
    region: rawEnv.COGNITO_USER_POOL_REGION,
    appClientId: cognitoClientId,
    appClientSecret: cognitoClientSecret,
    domain: cognitoDomain,
    machineClientId: rawEnv.COGNITO_M2M_CLIENT_ID,
  },
  runner: {
    functionName: rawEnv.RUNNER_FUNCTION_NAME,
    queueUrl: rawEnv.RUNNER_QUEUE_URL,
  },
  s3: {
    templateBucket: rawEnv.TEMPLATE_UPLOAD_BUCKET,
  },
  limits: {
    trialEditLimit: rawEnv.DEFAULT_TRIAL_EDIT_LIMIT,
    signedInBonusEdits: rawEnv.SIGNED_IN_BONUS_EDITS,
    anonymousLaunchLimit: rawEnv.ANONYMOUS_LAUNCH_LIMIT,
  },
  awsRegion: rawEnv.AWS_REGION ?? rawEnv.COGNITO_USER_POOL_REGION,
  frontend: {
    origin: fallbackOrigin,
    authCallbackUrl: fallbackCallbackUrl,
  },
  siteBuilder: {
    enabled: rawEnv.SITE_BUILDER_API_ENABLED !== 'false',
    docsToken: rawEnv.SITE_DOCS_TOKEN ?? '',
  },
  thumbnail: {
    serviceBase: rawEnv.THUMBNAIL_SERVICE_BASE ?? '',
  },
  domainRegistrar,
  domains: {
    priceMarkupCents:
      Number.isFinite(domainPricing.markupCents) && domainPricing.markupCents > 0
        ? domainPricing.markupCents
        : 300,
    defaultBasePriceCents:
      Number.isFinite(domainPricing.defaultBasePriceCents) && domainPricing.defaultBasePriceCents > 0
        ? domainPricing.defaultBasePriceCents
        : 1200,
    previewDomain,
    liveDomain,
    edge: {
      originHostname: edgeOriginHostname,
      certificateRegion: rawEnv.CUSTOM_DOMAIN_CERT_REGION || rawEnv.AWS_REGION || 'us-east-1',
      priceClass: edgePriceClass,
      canonicalDefault,
      distributionId: edgeDistributionId,
    },
    jobs: {
      batchLimit: domainJobBatchLimit,
      maxRuntimeMs: domainJobMaxRuntimeMs,
    },
    limits: domainLimits,
  },
} as const;
