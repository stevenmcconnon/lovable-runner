import { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { RunnerService } from '../services/runner';
import { DatabaseService } from '../services/database';
import { config } from '../env';

const launchPayload = z
  .object({
    url: z.string().url().optional(),
    description: z.string().min(1).optional(),
    accountId: z.string().uuid().optional(),
    testMode: z.boolean().optional(),
    businessDetails: z
      .object({
        businessName: z.string().optional(),
        businessType: z.string().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        additionalDetails: z.string().optional(),
      })
      .optional(),
  })
  .refine((data) => Boolean(data.url || data.description), {
    message: 'url or description is required',
    path: ['url'],
  });

const s3Client = new S3Client({ region: config.awsRegion });

const slugify = (input?: string | null) =>
  (input || '')
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

const buildSlugCandidate = (params: {
  businessDetails?: { businessName?: string | null; businessType?: string | null; phone?: string | null };
  url?: string | null;
  description?: string | null;
  requestId?: string | null;
}) => {
  if (params.businessDetails?.businessName) return slugify(params.businessDetails.businessName);
  if (params.url) return slugify(params.url);
  if (params.description) return slugify(params.description.slice(0, 50));
  if (params.requestId) return slugify(params.requestId);
  return slugify(`site-${Date.now()}`);
};

const ensureUniqueSlug = async ({
  bucket,
  basePrefix,
  slugCandidate,
}: {
  bucket: string;
  basePrefix: string;
  slugCandidate: string;
}) => {
  const sanitizedBase = slugCandidate && slugCandidate.length ? slugCandidate : 'site';
  let attempt = 0;

  const buildPrefixPath = (slugValue: string) => {
    if (!slugValue) return '';
    return basePrefix ? `${basePrefix.replace(/\/$/, '')}/${slugValue}` : slugValue;
  };

  while (attempt < 20) {
    const candidate = attempt === 0 ? sanitizedBase : `${sanitizedBase}-${attempt}`;
    const prefixPath = buildPrefixPath(candidate);
    const existing = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${prefixPath}/`,
        MaxKeys: 1,
      })
    );
    if (!existing.Contents || existing.Contents.length === 0) {
      return { slug: candidate, prefixPath };
    }
    attempt += 1;
  }

  const fallback = `${sanitizedBase}-${Date.now()}`;
  return { slug: fallback, prefixPath: buildPrefixPath(fallback) };
};

const buildPublicUrl = ({ bucket, prefix }: { bucket: string; prefix: string }) => {
  const normalizedPrefix = prefix ? `${prefix.replace(/\/+$/, '')}/` : '';
  const previewDomain = (process.env.PREVIEW_DOMAIN || '').trim().replace(/\/+$/, '');
  if (previewDomain) return `https://${previewDomain}/${normalizedPrefix}`;
  return `https://${bucket}.s3.amazonaws.com/${normalizedPrefix}`;
};

export const registerLaunchRoutes = (
  app: FastifyInstance,
  deps: { db: DatabaseService; runner: RunnerService }
) => {
  const { db, runner } = deps;

  const launchPreHandler = async (request: any, reply: any) => {
    let userError: any = null;
    try {
      await app.authenticateUser(request, reply);
      await app.requireRoles(request, reply, ['customer', 'admin', 'super-admin']);
      request.launchAuthContext = 'user';
      return;
    } catch (error) {
      userError = error;
    }
    try {
      await app.authenticateMachine(request, reply);
      request.launchAuthContext = 'machine';
    } catch (machineError) {
      throw userError || machineError;
    }
  };

  app.post('/launch', { preHandler: launchPreHandler }, async (request, reply) => {
    const parsed = launchPayload.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid payload', details: parsed.error.flatten() });
    }
    const body = parsed.data;
    const requestId = randomUUID();
    const resolvedBucket =
      process.env.LOVABLE_DEPLOY_BUCKET ||
      process.env.DEPLOY_BUCKET ||
      process.env.TEMPLATE_UPLOAD_BUCKET;
    if (!resolvedBucket) {
      return reply.code(500).send({ message: 'Deploy bucket not configured' });
    }
    const basePrefix =
      process.env.LOVABLE_DEPLOY_PREFIX || process.env.DEPLOY_PREFIX || process.env.PREVIEW_ROOT_PREFIX || '';
    const desiredSlug = buildSlugCandidate({
      businessDetails: body.businessDetails,
      url: body.url,
      description: body.description,
      requestId,
    });
    const { slug, prefixPath } = await ensureUniqueSlug({
      bucket: resolvedBucket,
      basePrefix,
      slugCandidate: desiredSlug,
    });
    const publicUrl = buildPublicUrl({ bucket: resolvedBucket, prefix: prefixPath });
    const profileAccountId = request.auth?.profile?.accountId ?? null;
    const profileUserId = request.auth?.profile?.id ?? null;
    const accountId = body.accountId ?? profileAccountId ?? null;
    const userId = profileUserId;
    const testMode = Boolean(body.testMode);
    const launchContext = (request as any).launchAuthContext;
    if (testMode && launchContext !== 'machine') {
      return reply.code(403).send({ message: 'testMode is only available for machine credentials' });
    }
    await db.createSiteGenerationRequest({
      requestId,
      accountId,
      userId,
      sourceUrl: body.url ?? null,
      description: body.description,
      businessDetails: body.businessDetails,
      slug,
      prefix: prefixPath,
      bucket: resolvedBucket,
    });
    try {
      await runner.runLaunchDirect({
        url: body.url,
        description: body.description,
        businessDetails: body.businessDetails,
        requestId,
        testMode,
        slug,
        prefix: prefixPath,
        bucket: resolvedBucket,
      });
      await db.touchSiteGenerationStage(requestId, 'running');
      return reply.code(202).send({ status: 'running', requestId, slug, prefix: prefixPath, bucket: resolvedBucket, publicUrl });
    } catch (error: any) {
      await db.updateSiteGeneration(requestId, {
        status: 'failed',
        errorMessage: error?.message ?? 'Failed to start launch',
      });
      throw error;
    }
  });
};
