const path = require('node:path');
const fsp = require('node:fs/promises');
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client } = require('./aws-clients');

const ensureDir = async (dir) => {
  await fsp.mkdir(dir, { recursive: true });
};

const streamToBuffer = async (body) => {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
};

const normalizeGeneratedPath = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withoutDot = trimmed.replace(/^\.\//, '');
  if (!withoutDot.startsWith('generated/')) return null;
  return withoutDot;
};

const collectGeneratedAssets = (site) => {
  if (!site?.sections) return [];
  const seen = new Set();
  site.sections.forEach((section) => {
    const candidate = normalizeGeneratedPath(section?.props?.image?.src);
    if (candidate) {
      seen.add(candidate);
    }
  });
  return Array.from(seen);
};

const contentTypeFor = (filePath = '') => {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
};

const uploadGeneratedAssets = async ({ site, projectDir, bucket, prefix, assets = [] }) => {
  const assetPaths = collectGeneratedAssets(site);
  if ((!assetPaths.length && !assets.length) || !bucket) return { uploaded: 0 };
  if (!projectDir && !assets.length) return { uploaded: 0 };
  const sanitizedPrefix = prefix ? prefix.replace(/\/$/, '') : '';
  let uploaded = 0;

  const manifest = [];
  const seen = new Set();

  assets.forEach((asset) => {
    if (!asset?.relativePath || seen.has(asset.relativePath)) return;
    seen.add(asset.relativePath);
    manifest.push({
      relativePath: asset.relativePath,
      buffer: asset.buffer,
      contentType: asset.contentType,
    });
  });

  assetPaths.forEach((relativePath) => {
    if (seen.has(relativePath)) return;
    seen.add(relativePath);
    manifest.push({
      relativePath,
      filePath: projectDir ? path.join(projectDir, 'public', relativePath) : null,
    });
  });

  for (const entry of manifest) {
    const relativePath = entry.relativePath;
    const targetKey = sanitizedPrefix ? `${sanitizedPrefix}/${relativePath}` : relativePath;
    try {
      const body =
        entry.buffer ||
        (entry.filePath ? await fsp.readFile(entry.filePath) : null);
      if (!body) {
        console.warn('[images] Missing generated asset source', { asset: relativePath });
        continue;
      }
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: targetKey,
          Body: body,
          ContentType: entry.contentType || contentTypeFor(relativePath),
        })
      );
      uploaded += 1;
    } catch (error) {
      console.warn('[images] Failed to upload generated asset', {
        asset: relativePath,
        err: error?.message,
      });
    }
  }

  return { uploaded };
};

const hydrateExistingGeneratedAssets = async ({ site, bucket, prefix, projectDir }) => {
  const assets = collectGeneratedAssets(site);
  if (!assets.length || !bucket || !projectDir) return { copied: 0 };
  const sanitizedPrefix = prefix ? prefix.replace(/\/$/, '') : '';
  const baseDir = path.join(projectDir, 'public');
  const generatedDir = path.join(baseDir, 'generated');
  await ensureDir(generatedDir);

  let copied = 0;
  for (const relativePath of assets) {
    const key = sanitizedPrefix ? `${sanitizedPrefix}/${relativePath}` : relativePath;
    const targetPath = path.join(baseDir, relativePath);
    try {
      const response = await s3Client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );
      await ensureDir(path.dirname(targetPath));
      await fsp.writeFile(targetPath, await streamToBuffer(response.Body));
      copied += 1;
    } catch (error) {
      console.warn('[images] Failed to hydrate asset from S3', {
        asset: relativePath,
        err: error?.message,
      });
    }
  }

  return { copied };
};

module.exports = { uploadGeneratedAssets, hydrateExistingGeneratedAssets };
