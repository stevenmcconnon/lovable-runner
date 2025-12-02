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

module.exports = { saveSiteConfig, loadSiteConfig };
