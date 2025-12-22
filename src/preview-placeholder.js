const { ListObjectsV2Command, PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client } = require('./aws-clients');

const toTitleCase = (value = '') => value.replace(/\s+/g, ' ').trim();

const escapeHtml = (value = '') =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildPlaceholderHtml = ({ brandName }) => {
  const title = escapeHtml(brandName || 'Site preview');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title} • Building preview</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="5" />
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #f8fafc; }
    .card { max-width: 520px; padding: 2.5rem; border-radius: 1.5rem; background: rgba(15, 23, 42, 0.92); box-shadow: 0 30px 60px rgba(15, 23, 42, 0.6); text-align: center; border: 1px solid rgba(248, 250, 252, 0.15); }
    h1 { font-size: 1.5rem; margin-bottom: 0.75rem; }
    p { line-height: 1.6; color: rgba(248, 250, 252, 0.8); margin: 0; }
    .spinner { width: 52px; height: 52px; margin: 0 auto 1.75rem; border-radius: 999px; border: 4px solid rgba(248, 250, 252, 0.25); border-top-color: #38bdf8; animation: spin 1s linear infinite; }
    small { display: block; margin-top: 1.5rem; color: rgba(248, 250, 252, 0.65); letter-spacing: 0.08em; text-transform: uppercase; font-size: 0.7rem; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner" aria-hidden="true"></div>
    <h1>Building ${title}</h1>
    <p>Your preview is being deployed. This page refreshes automatically—feel free to keep it open while we finish uploading assets.</p>
    <small>AI SiteMaker preview</small>
  </div>
</body>
</html>`;
};

const normalizePrefix = (prefix = '') => prefix.replace(/\/+$/, '');

const listPrefixHasObjects = async ({ bucket, prefix }) => {
  const normalizedPrefix = normalizePrefix(prefix);
  if (!normalizedPrefix) return true;
  const result = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: normalizedPrefix ? `${normalizedPrefix}/` : '',
      MaxKeys: 1,
    })
  );
  return Boolean(result.Contents && result.Contents.length);
};

const ensurePreviewPlaceholder = async ({ bucket, prefix, brandName, requestId }) => {
  if (!bucket || !prefix) return false;
  try {
    const normalizedPrefix = normalizePrefix(prefix);
    const hasExisting = await listPrefixHasObjects({ bucket, prefix: normalizedPrefix });
    if (hasExisting) return false;
    const html = buildPlaceholderHtml({ brandName: toTitleCase(brandName || '') });
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: normalizedPrefix ? `${normalizedPrefix}/index.html` : 'index.html',
        Body: html,
        CacheControl: 'no-cache, no-store, must-revalidate',
        ContentType: 'text/html; charset=utf-8',
      })
    );
    return true;
  } catch (error) {
    console.warn('[preview-placeholder] Failed to upload placeholder', {
      requestId,
      err: error?.message,
    });
    return false;
  }
};

module.exports = { ensurePreviewPlaceholder };
