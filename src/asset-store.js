const path = require('node:path');
const AWS = require('aws-sdk');

const s3 = new AWS.S3();

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

const buildAssetKey = (slug, filename) => `site-builds/assets/${slug}/${filename}`;

const buildAssetUrl = ({ bucket, key }) => {
  const domain = (process.env.ASSET_CDN_DOMAIN || process.env.PREVIEW_DOMAIN || '').trim().replace(/\/+$/, '');
  if (domain) return `https://${domain}/${key}`;
  return `https://${bucket}.s3.amazonaws.com/${key}`;
};

const createSiteAssetUpload = async ({ slug, filename, contentType, expiresIn = 900 } = {}) => {
  if (!slug) throw new Error('slug is required');
  const bucket = resolveBucket();
  if (!bucket) throw new Error('ASSET_UPLOAD_BUCKET or equivalent bucket env is required');
  const safeName = sanitizeFilename(filename);
  const uniqueName = `${Date.now()}-${safeName}`;
  const key = buildAssetKey(slug, uniqueName);
  const type = contentType || 'application/octet-stream';
  const uploadUrl = await s3.getSignedUrlPromise('putObject', {
    Bucket: bucket,
    Key: key,
    ContentType: type,
    Expires: Math.min(Math.max(expiresIn, 60), 3600),
  });
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
  const bucket = resolveBucket();
  if (!bucket) throw new Error('ASSET_UPLOAD_BUCKET or equivalent bucket env is required');
  const prefix = buildAssetKey(slug, '');
  const response = await s3
    .listObjectsV2({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: Math.min(Math.max(limit, 10), 500),
    })
    .promise();
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

module.exports = { createSiteAssetUpload, listSiteAssets };
