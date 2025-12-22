const path = require('node:path');
const {
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  PutObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3Client } = require('./aws-clients');

const resolveBucket = () =>
  process.env.ASSET_UPLOAD_BUCKET ||
  process.env.SITE_STORE_BUCKET ||
  process.env.LOVABLE_DEPLOY_BUCKET ||
  process.env.DEPLOY_BUCKET ||
  process.env.TEMPLATE_UPLOAD_BUCKET ||
  null;

const sanitizeFilename = (value) => {
  if (!value) return 'asset';
  const base = path.basename(value);
  return base
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'asset';
};

const buildAssetKey = (slug, filename = '') => {
  const suffix = filename ? filename.replace(/^\/+/, '') : '';
  return `site-builds/assets/${slug}/${suffix}`;
};

const buildAssetUrl = ({ bucket, key }) => {
  const domain = (process.env.ASSET_CDN_DOMAIN || process.env.PREVIEW_DOMAIN || '').trim().replace(/\/+$/, '');
  if (domain) return `https://${domain}/${key}`;
  return `https://${bucket}.s3.amazonaws.com/${key}`;
};

const ensureBucket = () => {
  const bucket = resolveBucket();
  if (!bucket) throw new Error('ASSET_UPLOAD_BUCKET or equivalent bucket env is required');
  return bucket;
};

const resolveKeyForSlug = (slug, keyInput = '') => {
  const decoded = decodeURIComponent(keyInput || '');
  const prefix = buildAssetKey(slug, '');
  if (!decoded) throw new Error('key is required');
  if (decoded.startsWith(prefix)) return decoded;
  const trimmed = decoded.replace(/^\/+/, '');
  return `${prefix}${trimmed}`;
};

const ensureAssetExists = async ({ bucket, key }) => {
  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
    return true;
  } catch (error) {
    if (error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
};

const createSiteAssetUpload = async ({ slug, filename, contentType, expiresIn = 900 } = {}) => {
  if (!slug) throw new Error('slug is required');
  const bucket = ensureBucket();
  const safeName = sanitizeFilename(filename);
  const uniqueName = `${Date.now()}-${safeName}`;
  const key = buildAssetKey(slug, uniqueName);
  const type = contentType || 'application/octet-stream';
  const uploadUrl = await getSignedUrl(
    s3Client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: type,
    }),
    { expiresIn: Math.min(Math.max(expiresIn, 60), 3600) }
  );
  return {
    key,
    uploadUrl,
    assetUrl: buildAssetUrl({ bucket, key }),
    contentType: type,
    bucket,
  };
};

const listSiteAssets = async ({ slug, limit = 100 } = {}) => {
  if (!slug) throw new Error('slug is required');
  const bucket = ensureBucket();
  const prefix = buildAssetKey(slug, '');
  const response = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: Math.min(Math.max(limit, 10), 500),
    })
  );
  const items =
    response.Contents?.map((item) => ({
      key: item.Key,
      size: item.Size,
      lastModified: item.LastModified,
      etag: item.ETag,
      url: buildAssetUrl({ bucket, key: item.Key }),
    })) || [];
  return { items, bucket, prefix };
};

const deleteSiteAsset = async ({ slug, key }) => {
  if (!slug) throw new Error('slug is required');
  const bucket = ensureBucket();
  const resolvedKey = resolveKeyForSlug(slug, key);
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: resolvedKey,
    })
  );
  return { deleted: true };
};

const buildTransformedAssetUrl = async ({
  slug,
  key,
  width,
  height,
  format,
  quality,
  fit,
}) => {
  if (!slug) throw new Error('slug is required');
  const bucket = ensureBucket();
  const resolvedKey = resolveKeyForSlug(slug, key);
  const exists = await ensureAssetExists({ bucket, key: resolvedKey });
  if (!exists) {
    const error = new Error('Asset not found');
    error.statusCode = 404;
    throw error;
  }
  const baseUrl = buildAssetUrl({ bucket, key: resolvedKey });
  const url = new URL(baseUrl);
  if (width) url.searchParams.set('width', String(width));
  if (height) url.searchParams.set('height', String(height));
  if (format) url.searchParams.set('format', format);
  if (quality) url.searchParams.set('quality', String(quality));
  if (fit) url.searchParams.set('fit', fit);
  return {
    url: url.toString(),
    key: resolvedKey,
    bucket,
  };
};

module.exports = {
  createSiteAssetUpload,
  listSiteAssets,
  deleteSiteAsset,
  buildTransformedAssetUrl,
};
