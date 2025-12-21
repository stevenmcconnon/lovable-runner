import crypto from 'node:crypto';
import { config } from '../env';

const normalizeSlug = (slug?: string | null) => slug?.trim().toLowerCase() ?? '';

const timingSafeEquals = (expected: string, provided: string) => {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
};

export const buildSiteToken = (slug: string): string => {
  const normalized = normalizeSlug(slug);
  if (!normalized) return '';
  return crypto.createHmac('sha256', config.security.siteSigningSecret).update(normalized).digest('hex');
};

export const verifySiteToken = (slug?: string | null, token?: string | null): boolean => {
  if (!slug || !token) return false;
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) return false;
  const expected = buildSiteToken(normalizedSlug);
  try {
    return timingSafeEquals(expected, token);
  } catch {
    return expected === token;
  }
};
