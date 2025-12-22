import { FastifyReply, FastifyRequest } from 'fastify';
import { DatabaseService } from './database';

const allowedSlugsCacheKey = Symbol('allowedSlugs');

const getAccountId = (request: FastifyRequest): string | null => {
  return (request.auth as any)?.account?.id ?? request.auth?.profile?.accountId ?? null;
};

const setCachedSlugs = (request: FastifyRequest, slugs: string[]) => {
  (request as any)[allowedSlugsCacheKey] = slugs;
};

export const getCachedSlugs = (request: FastifyRequest): string[] | undefined => {
  return (request as any)[allowedSlugsCacheKey];
};

export const loadAllowedSlugs = async (
  request: FastifyRequest,
  db: DatabaseService
): Promise<string[]> => {
  const cached = getCachedSlugs(request);
  if (cached) return cached;
  const accountId = getAccountId(request);
  if (!accountId) {
    setCachedSlugs(request, []);
    return [];
  }
  const slugs = await db.listAccountSlugs(accountId);
  setCachedSlugs(request, slugs);
  return slugs;
};

export const ensureAnySiteAccess = async (
  request: FastifyRequest,
  reply: FastifyReply,
  db: DatabaseService
): Promise<string[] | null> => {
  const slugs = await loadAllowedSlugs(request, db);
  if (!slugs.length) {
    reply.code(403).send({ error: 'No sites assigned to this account yet.' });
    return null;
  }
  return slugs;
};

export const ensureSlugAccess = async (
  request: FastifyRequest,
  reply: FastifyReply,
  db: DatabaseService,
  slug?: string | null
): Promise<string | null> => {
  if (!slug) {
    reply.code(400).send({ error: 'slug is required' });
    return null;
  }
  const slugs = await ensureAnySiteAccess(request, reply, db);
  if (!slugs) return null;
  if (!slugs.includes(slug)) {
    reply.code(403).send({ error: 'You do not have access to this site.' });
    return null;
  }
  return slug;
};

export const resolveSlugOrDefault = async (
  request: FastifyRequest,
  reply: FastifyReply,
  db: DatabaseService,
  slug?: string | null
): Promise<string | null> => {
  const slugs = await ensureAnySiteAccess(request, reply, db);
  if (!slugs) return null;
  if (slug) {
    if (!slugs.includes(slug)) {
      reply.code(403).send({ error: 'You do not have access to this site.' });
      return null;
    }
    return slug;
  }
  return slugs[0];
};
