const fs = require('node:fs');
const path = require('node:path');
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
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
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
      return await client.fetchSourceCode(projectId);
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
  await fetchWithRetry(client, projectId, maxAttempts, waitMs);

  const { outputDir } = await downloadProjectFiles(client, projectId, {
    outputDir: path.join(process.cwd(), 'downloads', String(projectId)),
    zip: false,
  });

  const slugFromUrl = slugify(url);
  const finalSlug = slug || slugFromUrl || projectId;
  const basePrefix = prefix || process.env.LOVABLE_DEPLOY_PREFIX || '';
  const resolvedPrefix = basePrefix
    ? `${basePrefix.replace(/\/$/, '')}/${finalSlug}`
    : finalSlug;

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
  };
};

module.exports = { runLaunch, loadDotEnvIfPresent };
