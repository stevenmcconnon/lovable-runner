import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from '../env';
import { DatabaseService } from '../services/database';
import { RunnerService } from '../services/runner';

type LoadSiteConfigFn = (slug: string) => Promise<any>;
type GeneratePatchFn = (params: {
  site: any;
  instructions: string;
  assets?: Array<{ name?: string; url: string; description?: string }>;
}) => Promise<{ patch: any; summary?: string }>;
type AssetUploadFn = (params: {
  slug: string;
  filename?: string;
  contentType?: string;
  expiresIn?: number;
}) => Promise<any>;
type AssetListFn = (params: { slug: string; limit?: number }) => Promise<{
  items: Array<{ key: string; size?: number; url: string }>;
}>;

const rootRequire = (relativePath: string): any => {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(path.join(process.cwd(), relativePath));
  } catch {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(path.join(__dirname, '..', '..', relativePath));
  }
};

const { loadSiteConfig } = rootRequire('src/site-store.js') as {
  loadSiteConfig: LoadSiteConfigFn;
};
const { generateSitePatchWithOpenAI } = rootRequire('src/openai.js') as {
  generateSitePatchWithOpenAI: GeneratePatchFn;
};
const { createSiteAssetUpload, listSiteAssets } = rootRequire('src/asset-store.js') as {
  createSiteAssetUpload: AssetUploadFn;
  listSiteAssets: AssetListFn;
};

const openApiPath = path.join(process.cwd(), 'openapi', 'openapi.json');
let cachedOpenApi: any = null;
try {
  if (fs.existsSync(openApiPath)) {
    cachedOpenApi = JSON.parse(fs.readFileSync(openApiPath, 'utf8'));
  }
} catch (error) {
  // eslint-disable-next-line no-console
  console.warn('[site-builder] Failed to read OpenAPI document', error);
}

const slugParamsSchema = z.object({
  slug: z.string().min(1),
});

const patchSchema = z
  .object({
    patch: z.unknown().optional(),
    site: z.unknown().optional(),
    regenerateImages: z.boolean().optional(),
    requestId: z.string().optional(),
    description: z.string().optional(),
    sourceUrl: z.string().optional(),
  })
  .refine((value) => Boolean(value.patch || value.site), {
    message: 'patch or site is required',
    path: ['patch'],
  });

const instructionSchema = z.object({
  instructions: z.string().min(5, 'instructions must contain at least 5 characters'),
  assets: z
    .array(
      z.object({
        name: z.string().optional(),
        url: z.string().url(),
        description: z.string().optional(),
      })
    )
    .optional(),
  regenerateImages: z.boolean().optional(),
  requestId: z.string().optional(),
  description: z.string().optional(),
  sourceUrl: z.string().optional(),
});

const uploadRequestSchema = z
  .object({
    filename: z.string().optional(),
    contentType: z.string().optional(),
    expiresIn: z.number().int().min(60).max(3600).optional(),
  })
  .optional();

const getDocsToken = () => (config.siteBuilder.docsToken || '').trim();
const docsEnabled = Boolean(getDocsToken() && cachedOpenApi);
const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const verifyDocsAccess = (request: FastifyRequest, reply: FastifyReply) => {
  if (!docsEnabled || !cachedOpenApi) {
    reply.code(404).send({ error: 'Not found' });
    return false;
  }
  const token = getDocsToken();
  const incoming =
    (request.headers['x-docs-token'] as string | undefined) ||
    (request.query as Record<string, string | undefined>)?.token;
  if (!incoming || incoming !== token) {
    reply.code(403).send({ error: 'Docs access token required' });
    return false;
  }
  return true;
};

const mapBusinessDetails = (record: any) => ({
  businessName: record?.site?.meta?.brandName ?? undefined,
  businessType: record?.site?.meta?.headline ?? undefined,
  phone: record?.site?.meta?.phone ?? undefined,
  address: record?.site?.meta?.location ?? undefined,
  additionalDetails: record?.site?.meta?.subheadline ?? undefined,
});

type QueueUpdateParams = {
  request: any;
  reply: FastifyReply;
  slug: string;
  patch?: any;
  site?: any;
  regenerateImages?: boolean;
  description?: string;
  sourceUrl?: string;
  requestId?: string;
  existingRecord?: any;
};

export const registerSiteBuilderRoutes = (
  app: FastifyInstance,
  deps: { db: DatabaseService; runner: RunnerService }
) => {
  if (!config.siteBuilder.enabled) {
    return;
  }

  const { db, runner } = deps;

  const enqueueSiteUpdate = async ({
    request,
    reply,
    slug,
    patch,
    site,
    regenerateImages,
    description,
    sourceUrl,
    requestId,
    existingRecord,
  }: QueueUpdateParams) => {
    const record = existingRecord ?? (await loadSiteConfig(slug));
    if (!record?.site) {
      reply.code(404).send({ error: 'Site not found' });
      return;
    }
    const finalRequestId = requestId && uuidRegex.test(requestId) ? requestId : randomUUID();
    const accountId = request.auth?.profile?.accountId ?? null;
    const userId = request.auth?.profile?.id ?? null;
    const baseDescription = description ?? record.metadata?.description ?? '';
    await db.createSiteGenerationRequest({
      requestId: finalRequestId,
      accountId,
      userId,
      sourceUrl: sourceUrl ?? record.metadata?.sourceUrl ?? null,
      description: baseDescription,
      slug,
      prefix: record.metadata?.prefix ?? slug,
      bucket: record.metadata?.bucket ?? null,
      businessDetails: mapBusinessDetails(record),
    });
    await runner.runSiteUpdate({
      requestId: finalRequestId,
      slug,
      patch,
      site,
      regenerateImages,
      description: baseDescription,
      sourceUrl: sourceUrl ?? record.metadata?.sourceUrl ?? null,
    });
    await db.touchSiteGenerationStage(finalRequestId, 'running');
    reply.code(202).send({ status: 'running', requestId: finalRequestId });
  };

  const builderPreHandler = async (request: any, reply: any) => {
    let userError: any = null;
    try {
      await app.authenticateUser(request, reply);
      await app.requireRoles(request, reply, ['admin', 'super-admin']);
      request.siteBuilderAuth = 'user';
      return;
    } catch (error) {
      userError = error;
    }
    await app.authenticateMachine(request, reply).catch((machineError: any) => {
      throw userError || machineError;
    });
    request.siteBuilderAuth = 'machine';
  };

  app.get('/openapi.json', async (request, reply) => {
    if (!verifyDocsAccess(request, reply)) return;
    reply.send(cachedOpenApi);
  });

  app.get('/docs', async (request, reply) => {
    if (!verifyDocsAccess(request, reply)) return;
    reply.type('text/html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>AI SiteMaker API</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    html, body { margin: 0; padding: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    #redoc-container { height: 100%; }
  </style>
</head>
<body>
  <redoc spec-url="/openapi.json"></redoc>
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</body>
</html>`);
  });

  app.get(
    '/sites/:slug',
    { preHandler: builderPreHandler },
    async (request, reply) => {
      const params = slugParamsSchema.parse(request.params);
      const record = await loadSiteConfig(params.slug);
      if (!record) {
        return reply.code(404).send({ error: 'Site not found' });
      }
      return reply.send(record);
    }
  );

  app.patch(
    '/sites/:slug',
    { preHandler: builderPreHandler },
    async (request, reply) => {
      const params = slugParamsSchema.parse(request.params);
      const body = patchSchema.parse(request.body);
      await enqueueSiteUpdate({
        request,
        reply,
        slug: params.slug,
        patch: body.patch,
        site: body.site,
        regenerateImages: body.regenerateImages,
        description: body.description,
        sourceUrl: body.sourceUrl,
        requestId: body.requestId,
      });
    }
  );

  app.get(
    '/sites/:slug/assets',
    { preHandler: builderPreHandler },
    async (request, reply) => {
      const params = slugParamsSchema.parse(request.params);
      const assets = await listSiteAssets({ slug: params.slug, limit: 200 });
      reply.send(assets);
    }
  );

  app.post(
    '/sites/:slug/assets',
    { preHandler: builderPreHandler },
    async (request, reply) => {
      const params = slugParamsSchema.parse(request.params);
      const body = uploadRequestSchema.parse(request.body) ?? {};
      const upload = await createSiteAssetUpload({
        slug: params.slug,
        filename: body.filename,
        contentType: body.contentType,
        expiresIn: body.expiresIn,
      });
      reply.send(upload);
    }
  );

  app.post(
    '/sites/:slug/instructions',
    { preHandler: builderPreHandler },
    async (request, reply) => {
      const params = slugParamsSchema.parse(request.params);
      const body = instructionSchema.parse(request.body);
      const record = await loadSiteConfig(params.slug);
      if (!record?.site) {
        return reply.code(404).send({ error: 'Site not found' });
      }

      let assetContext = body.assets ? [...body.assets] : [];
      try {
        const listed = await listSiteAssets({ slug: params.slug, limit: 50 });
        const derived = listed.items.map((item) => ({
          name: item.key.split('/').pop(),
          url: item.url,
          description: item.size ? `${Math.round(item.size / 1024)} KB` : undefined,
        }));
        assetContext = [...assetContext, ...derived];
      } catch (error) {
        request.log.warn({ err: error }, '[site-builder] Failed to list assets for instructions');
      }

      const patchResult = await generateSitePatchWithOpenAI({
        site: record.site,
        instructions: body.instructions,
        assets: assetContext,
      });

      await enqueueSiteUpdate({
        request,
        reply,
        slug: params.slug,
        patch: patchResult.patch,
        regenerateImages: body.regenerateImages,
        description: body.description || patchResult.summary,
        sourceUrl: body.sourceUrl,
        requestId: body.requestId,
        existingRecord: record,
      });
    }
  );
};
