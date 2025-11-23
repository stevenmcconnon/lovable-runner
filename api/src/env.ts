import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  STRIPE_SECRET_KEY: z.string().min(1, 'STRIPE_SECRET_KEY is required'),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  COGNITO_USER_POOL_ID: z.string().min(1, 'COGNITO_USER_POOL_ID is required'),
  COGNITO_USER_POOL_REGION: z.string().min(1, 'COGNITO_USER_POOL_REGION is required'),
  COGNITO_APP_CLIENT_ID: z.string().min(1, 'COGNITO_APP_CLIENT_ID is required'),
  COGNITO_M2M_CLIENT_ID: z.string().optional(),
  RUNNER_FUNCTION_NAME: z.string().min(1, 'RUNNER_FUNCTION_NAME is required'),
  TEMPLATE_UPLOAD_BUCKET: z.string().min(1, 'TEMPLATE_UPLOAD_BUCKET is required'),
  DEFAULT_TRIAL_EDIT_LIMIT: z.coerce.number().default(1),
  AWS_REGION: z.string().optional(),
});

const rawEnv = envSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID,
  COGNITO_USER_POOL_REGION: process.env.COGNITO_USER_POOL_REGION,
  COGNITO_APP_CLIENT_ID: process.env.COGNITO_APP_CLIENT_ID,
  COGNITO_M2M_CLIENT_ID: process.env.COGNITO_M2M_CLIENT_ID,
  RUNNER_FUNCTION_NAME: process.env.RUNNER_FUNCTION_NAME,
  TEMPLATE_UPLOAD_BUCKET: process.env.TEMPLATE_UPLOAD_BUCKET,
  DEFAULT_TRIAL_EDIT_LIMIT: process.env.DEFAULT_TRIAL_EDIT_LIMIT,
  AWS_REGION: process.env.AWS_REGION,
});

export const config = {
  nodeEnv: rawEnv.NODE_ENV ?? 'development',
  supabase: {
    url: rawEnv.SUPABASE_URL,
    serviceRoleKey: rawEnv.SUPABASE_SERVICE_ROLE_KEY,
  },
  stripe: {
    secretKey: rawEnv.STRIPE_SECRET_KEY,
    webhookSecret: rawEnv.STRIPE_WEBHOOK_SECRET,
  },
  cognito: {
    userPoolId: rawEnv.COGNITO_USER_POOL_ID,
    region: rawEnv.COGNITO_USER_POOL_REGION,
    appClientId: rawEnv.COGNITO_APP_CLIENT_ID,
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
} as const;
