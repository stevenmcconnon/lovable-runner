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
    TEMPLATE_UPLOAD_BUCKET: z.string().min(1, 'TEMPLATE_UPLOAD_BUCKET is required'),
    DEFAULT_TRIAL_EDIT_LIMIT: z.coerce.number().default(1),
    AWS_REGION: z.string().optional(),
    FRONTEND_ORIGIN: z.string().optional(),
    AUTH_CALLBACK_URL: z.string().optional(),
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
  TEMPLATE_UPLOAD_BUCKET: process.env.TEMPLATE_UPLOAD_BUCKET,
  DEFAULT_TRIAL_EDIT_LIMIT: process.env.DEFAULT_TRIAL_EDIT_LIMIT,
  AWS_REGION: process.env.AWS_REGION,
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN,
  AUTH_CALLBACK_URL: process.env.AUTH_CALLBACK_URL,
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
  },
  s3: {
    templateBucket: rawEnv.TEMPLATE_UPLOAD_BUCKET,
  },
  limits: {
    trialEditLimit: rawEnv.DEFAULT_TRIAL_EDIT_LIMIT,
  },
  awsRegion: rawEnv.AWS_REGION ?? rawEnv.COGNITO_USER_POOL_REGION,
  frontend: {
    origin: fallbackOrigin,
    authCallbackUrl: fallbackCallbackUrl,
  },
} as const;
