import path from 'node:path';
import fs from 'node:fs/promises';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../env';

const templateRoot = path.join(process.cwd(), 'templates');
const manifestPath = path.join(templateRoot, 'template-library.json');
const presetsPath = path.join(templateRoot, 'template-copy-presets.json');
const libraryDir = path.join(templateRoot, 'library');

const templateParamsSchema = z.object({
  templateId: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/i, 'Invalid template id'),
});

const requireTemplatesToken = (request: FastifyRequest, reply: FastifyReply) => {
  const token = (config.templates.docsToken || '').trim();
  if (!token) {
    reply.code(503).send({ message: 'Template catalog access is not configured' });
    return false;
  }
  const headerToken =
    (request.headers['x-templates-token'] as string | undefined) ||
    (request.headers['x-docs-token'] as string | undefined);
  const queryToken = (request.query as Record<string, string | undefined>)?.token;
  const incoming = (headerToken || queryToken || '').trim();
  if (!incoming || incoming !== token) {
    reply.code(403).send({ message: 'Template access token required' });
    return false;
  }
  return true;
};

const readJson = async (absolutePath: string) => {
  const raw = await fs.readFile(absolutePath, 'utf8');
  return JSON.parse(raw);
};

const resolveTemplatePath = (templateId: string) =>
  path.join(libraryDir, `${templateId}.json`);

export const registerTemplateRoutes = (app: FastifyInstance) => {
  app.get('/templates', async (request, reply) => {
    if (!requireTemplatesToken(request, reply)) return;
    try {
      const payload = await readJson(manifestPath);
      reply.send(payload);
    } catch (error) {
      request.log.error({ err: error }, '[templates] failed to load manifest');
      reply.code(500).send({ message: 'Unable to load template manifest' });
    }
  });

  app.get('/templates/presets', async (request, reply) => {
    if (!requireTemplatesToken(request, reply)) return;
    try {
      const payload = await readJson(presetsPath);
      reply.send(payload);
    } catch (error) {
      request.log.error({ err: error }, '[templates] failed to load presets');
      reply.code(500).send({ message: 'Unable to load template presets' });
    }
  });

  app.get('/templates/:templateId', async (request, reply) => {
    if (!requireTemplatesToken(request, reply)) return;
    const parsed = templateParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      reply.code(400).send({ message: 'Invalid template id', details: parsed.error.flatten() });
      return;
    }
    const targetPath = resolveTemplatePath(parsed.data.templateId);
    try {
      const payload = await readJson(targetPath);
      reply.send(payload);
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        reply.code(404).send({ message: 'Template not found' });
        return;
      }
      request.log.error({ err: error }, '[templates] failed to load template');
      reply.code(500).send({ message: 'Unable to load template' });
    }
  });
};
