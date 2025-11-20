const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const AWS = require('aws-sdk');
const { LovableClient } = require('./client');
const { downloadProjectFiles } = require('./downloader');
const { buildAndUpload } = require('./deploy');

const loadDotEnvIfPresent = () => {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .forEach((line) => {
      const idx = line.indexOf('=');
      if (idx === -1) return;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    });
};

const slugify = (input) => {
  if (!input) return '';
  return input
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
};

const PLACEHOLDER_PATTERNS = [
  /Welcome to Your Blank App/i,
  /Start building your amazing project here/i,
];

const containsPlaceholderContent = (projectData) => {
  if (!projectData?.files || !projectData.files.length) return true;
  return projectData.files.some((file) => {
    if (!file || typeof file.contents !== 'string') return false;
    return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(file.contents));
  });
};

const extractProjectId = (createResponse) => {
  if (!createResponse) return null;
  if (createResponse.id) return createResponse.id;
  if (createResponse.projectId) return createResponse.projectId;
  if (createResponse.project?.id) return createResponse.project.id;
  return null;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithRetry = async (client, projectId, attempts, waitMs) => {
  let lastError;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const data = await client.fetchSourceCode(projectId);
      if (containsPlaceholderContent(data)) {
        // eslint-disable-next-line no-console
        console.log(
          `Project content placeholder detected (attempt ${i}/${attempts}). Waiting ${waitMs / 1000}s...`
        );
        if (i === attempts) {
          return data;
        }
        await sleep(waitMs);
        continue;
      }
      return data;
    } catch (error) {
      lastError = error;
      const retryable =
        error?.status === 404 || error?.status === 400 || error?.status === 500;
      if (!retryable || i === attempts) throw error;
      // eslint-disable-next-line no-console
      console.log(
        `Source not ready (attempt ${i}/${attempts}, status ${error?.status}). Retrying in ${
          waitMs / 1000
        }s...`
      );
      await sleep(waitMs);
    }
  }
  throw lastError;
};

const ensureUniqueSlug = async ({ bucket, basePrefix, slugCandidate }) => {
  const s3 = new AWS.S3();
  const sanitizedBase = slugCandidate && slugCandidate.length ? slugCandidate : 'site';
  let attempt = 0;

  const buildPrefixPath = (slugValue) => {
    if (!slugValue) return '';
    return basePrefix
      ? `${basePrefix.replace(/\/$/, '')}/${slugValue}`
      : slugValue;
  };

  while (attempt < 20) {
    const candidate = attempt === 0 ? sanitizedBase : `${sanitizedBase}-${attempt}`;
    const prefixPath = buildPrefixPath(candidate);
    const existing = await s3
      .listObjectsV2({
        Bucket: bucket,
        Prefix: `${prefixPath}/`,
        MaxKeys: 1,
      })
      .promise();
    if (!existing.Contents || existing.Contents.length === 0) {
      return { slug: candidate, prefixPath };
    }
    attempt += 1;
  }

  const fallback = `${sanitizedBase}-${Date.now()}`;
  return { slug: fallback, prefixPath: buildPrefixPath(fallback) };
};

const runLaunch = async ({
  url,
  token,
  base,
  createPath,
  workspace,
  waitSeconds = 10,
  attempts = 60,
  bucket,
  prefix,
  slug,
  profile,
  skipInstall,
}) => {
  if (!url) throw new Error('url is required');
  const resolvedBucket = bucket || process.env.LOVABLE_DEPLOY_BUCKET;
  if (!resolvedBucket) throw new Error('bucket is required');

  const waitMs = Number(waitSeconds) * 1000 || 10000;
  const maxAttempts = Number(attempts) || 60;

  const idToken = token || process.env.LOVABLE_ID_TOKEN;
  if (!idToken) throw new Error('idToken is required (env or token).');

  const client = new LovableClient({
    idToken,
    apiBase: base || process.env.LOVABLE_API_BASE,
    workspaceId: workspace || process.env.LOVABLE_WORKSPACE_ID,
  });

  const createResponse = await client.createProjectFromUrl(url, {
    createPath: createPath || process.env.LOVABLE_CREATE_PATH,
    workspaceId: workspace || process.env.LOVABLE_WORKSPACE_ID,
  });

  const projectId = extractProjectId(createResponse);
  if (!projectId) {
    throw new Error('Could not determine project id from create response.');
  }

  // eslint-disable-next-line no-console
  console.log(`Created project ${projectId}. Waiting for generation...`);
  const projectData = await fetchWithRetry(client, projectId, maxAttempts, waitMs);

  const baseDownloadDir =
    process.env.LOVABLE_DOWNLOAD_BASE || path.join(os.tmpdir(), 'downloads');
  const { outputDir } = await downloadProjectFiles(client, projectId, {
    outputDir: path.join(baseDownloadDir, String(projectId)),
    zip: false,
    projectData,
  });

  const slugFromUrl = slugify(url);
  const basePrefix = prefix || process.env.LOVABLE_DEPLOY_PREFIX || '';
  const desiredSlug = slugify(slug || slugFromUrl) || slugify(projectId) || projectId;
  const { slug: finalSlug, prefixPath: resolvedPrefix } = await ensureUniqueSlug({
    bucket: resolvedBucket,
    basePrefix,
    slugCandidate: desiredSlug,
  });

  const { distPath, target } = await buildAndUpload(outputDir, {
    bucket: resolvedBucket,
    prefix: resolvedPrefix,
    profile,
    skipInstall: Boolean(skipInstall),
  });

  const publicUrl = `https://${resolvedBucket}.s3.amazonaws.com/${resolvedPrefix}/`;

  return {
    projectId,
    outputDir,
    distPath,
    target,
    publicUrl,
    slug: finalSlug,
  };
};

module.exports = { runLaunch, loadDotEnvIfPresent };
