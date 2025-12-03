const AWS = require('aws-sdk');

const resolveBucket = () =>
  process.env.SITE_STORE_BUCKET ||
  process.env.LAUNCH_STATUS_BUCKET ||
  process.env.LOVABLE_DEPLOY_BUCKET ||
  process.env.DEPLOY_BUCKET ||
  process.env.TEMPLATE_UPLOAD_BUCKET ||
  null;

const buildSiteKey = (slug) => `site-builds/sites/${slug}/site.json`;

const s3 = new AWS.S3();

const parseAccountSiteMap = () => {
  const raw = process.env.ACCOUNT_SITE_MAP;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    console.warn('[site-store] Failed to parse ACCOUNT_SITE_MAP (expected JSON object)', error.message);
    return null;
  }
};

const resolveSlugsForUser = (user) => {
  const map = parseAccountSiteMap();
  if (!map) return null;
  const keys = [
    user?.accountId,
    user?.sub,
    user?.email,
    ...(user?.groups || []),
  ].filter(Boolean);
  const resolved = new Set();
  keys.forEach((key) => {
    const entry = map[key];
    if (Array.isArray(entry)) {
      entry.forEach((slug) => resolved.add(slug));
    }
  });
  const fallback = map['*'] || map.default;
  if (Array.isArray(fallback)) {
    fallback.forEach((slug) => resolved.add(slug));
  }
  return resolved.size ? Array.from(resolved) : null;
};

const saveSiteConfig = async ({ slug, site, metadata }) => {
  const bucket = resolveBucket();
  if (!bucket || !slug || !site) return;
  const record = {
    slug,
    site,
    metadata: {
      ...(metadata || {}),
      updatedAt: new Date().toISOString(),
    },
  };
  await s3
    .putObject({
      Bucket: bucket,
      Key: buildSiteKey(slug),
      Body: JSON.stringify(record, null, 2),
      ContentType: 'application/json',
    })
    .promise()
    .catch((error) => {
      console.warn('[site-store] Failed to persist site config', error.message);
    });
};

const extractSlugFromKey = (key) => {
  const match = key.match(/site-builds\/sites\/([^/]+)\/site\.json$/);
  return match ? match[1] : null;
};

const listSiteConfigs = async ({ limit = 50, slugs } = {}) => {
  const bucket = resolveBucket();
  if (!bucket) {
    throw new Error('SITE_STORE_BUCKET or equivalent bucket env is required');
  }
  const prefix = 'site-builds/sites/';
  const maxResults = Math.min(Math.max(limit, 1), 200);
  let continuationToken;
  const keys = [];

  do {
    const listing = await s3
      .listObjectsV2({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: maxResults,
      })
      .promise();
    const foundKeys =
      listing.Contents?.map((item) => item.Key).filter((key) => key.endsWith('/site.json')) ||
      [];
    keys.push(...foundKeys);
    if (keys.length >= maxResults || !listing.IsTruncated) break;
    continuationToken = listing.NextContinuationToken;
  } while (continuationToken);

  const filteredKeys = Array.isArray(slugs) && slugs.length
    ? keys.filter((key) => slugs.includes(extractSlugFromKey(key)))
    : keys;

  const limitedKeys = filteredKeys.slice(0, maxResults);
  const records = await Promise.all(
    limitedKeys.map(async (key) => {
      try {
        const raw = await s3
          .getObject({
            Bucket: bucket,
            Key: key,
          })
          .promise();
        const parsed = JSON.parse(raw.Body.toString('utf8'));
        return {
          ...parsed,
          slug: parsed.slug || extractSlugFromKey(key),
        };
      } catch (error) {
        if (error.code !== 'NoSuchKey') {
          console.warn('[site-store] Failed to load site config from list', {
            key,
            err: error.message,
          });
        }
        return null;
      }
    })
  );

  return records.filter(Boolean);
};

const listSitesForUser = async ({ user, limit } = {}) => {
  const allowedSlugs = resolveSlugsForUser(user);
  const records = await listSiteConfigs({ limit, slugs: allowedSlugs || undefined });
  const items = records.map((record) => ({
    slug: record.slug,
    bucket: record.metadata?.bucket,
    prefix: record.metadata?.prefix,
    publicUrl: record.metadata?.publicUrl,
    requestId: record.metadata?.requestId,
    sourceUrl: record.metadata?.sourceUrl,
    description: record.metadata?.description,
    status: 'completed',
    createdAt: record.metadata?.lastBuildAt,
    updatedAt: record.metadata?.updatedAt || record.metadata?.lastBuildAt,
  }));
  return items;
};

const loadSiteConfig = async (slug) => {
  if (!slug) return null;
  const bucket = resolveBucket();
  if (!bucket) return null;
  try {
    const result = await s3
      .getObject({
        Bucket: bucket,
        Key: buildSiteKey(slug),
      })
      .promise();
    const parsed = JSON.parse(result.Body.toString('utf8'));
    return parsed;
  } catch (error) {
    if (error.code !== 'NoSuchKey') {
      console.warn('[site-store] Failed to load site config', error.message);
    }
    return null;
  }
};

module.exports = {
  saveSiteConfig,
  loadSiteConfig,
  listSiteConfigs,
  listSitesForUser,
};
