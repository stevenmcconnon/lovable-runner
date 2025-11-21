const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const AWS = require('aws-sdk');
const { LovableClient } = require('./client');
const { downloadProjectFiles } = require('./downloader');
const { buildAndUpload } = require('./deploy');
const { waitForProjectReady } = require('./project-readiness');
const {
  putDraftRecord,
  updateDraftStatus,
  getDraftRecord,
  listDraftsForProject,
} = require('./draft-store');

const slugify = (input) => {
  if (!input) return '';
  return input
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
};

const ensureS3 = () => {
  if (!AWS.config.region && process.env.AWS_REGION) {
    AWS.config.update({ region: process.env.AWS_REGION });
  }
  return new AWS.S3();
};

const sanitizePrefix = (prefix) => {
  if (!prefix) return '';
  return prefix.replace(/^\/+/, '').replace(/\/+$/, '');
};

const buildPrompt = ({ url, instructions }) => {
  const base = instructions?.trim()
    ? instructions.trim()
    : 'Apply improvements to the existing project';
  return `${base}\nReference: ${url}`;
};

const buildLovableClient = ({ token, base, workspace }) => {
  const idToken = token || process.env.LOVABLE_ID_TOKEN;
  if (!idToken) throw new Error('LOVABLE_ID_TOKEN is required');
  return new LovableClient({
    idToken,
    apiBase: base || process.env.LOVABLE_API_BASE,
    workspaceId: workspace || process.env.LOVABLE_WORKSPACE_ID,
  });
};

const createDraftId = () => {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `draft-${Date.now().toString(36)}`;
};

const runUpdate = async ({
  projectId,
  url,
  instructions,
  token,
  base,
  createPath,
  workspace,
  waitSeconds = 10,
  attempts = 60,
  bucket,
  prefix,
  profile,
  skipInstall,
  placeholderLimit,
  requestedBy,
}) => {
  if (!projectId) throw new Error('projectId is required for updates.');
  if (!url) throw new Error('url is required for updates.');
  const resolvedBucket = bucket || process.env.LOVABLE_DEPLOY_BUCKET;
  if (!resolvedBucket) throw new Error('bucket is required for updates.');
  const basePrefix = prefix || process.env.LOVABLE_DEPLOY_PREFIX || slugify(url);
  const sanitizedBasePrefix = sanitizePrefix(basePrefix);
  if (!sanitizedBasePrefix) {
    throw new Error('Unable to determine base prefix for update.');
  }

  const draftId = createDraftId();
  const tempPrefix = `${sanitizedBasePrefix}/drafts/${draftId}`;
  const waitMs = Number(waitSeconds) * 1000 || 10000;
  const maxAttempts = Number(attempts) || 60;

  const client = buildLovableClient({ token, base, workspace });
  const prompt = buildPrompt({ url, instructions });

  const createResponse = await client.createProjectFromUrl(url, {
    createPath: createPath || process.env.LOVABLE_CREATE_PATH,
    workspaceId: workspace || process.env.LOVABLE_WORKSPACE_ID,
    prompt,
  });

  const newProjectId =
    createResponse?.id ||
    createResponse?.projectId ||
    createResponse?.project?.id ||
    null;
  if (!newProjectId) {
    throw new Error('Unable to determine Lovable project id for update.');
  }

  await putDraftRecord({
    projectId,
    draftId,
    status: 'pending',
    createdAt: new Date().toISOString(),
    instructions,
    tempPrefix,
    livePrefix: sanitizedBasePrefix,
    requestedBy: requestedBy?.sub || null,
    requestedByEmail: requestedBy?.email || null,
    lovProjectId: newProjectId,
  });

  try {
    const projectData = await waitForProjectReady({
      client,
      projectId: newProjectId,
      attempts: maxAttempts,
      waitMs,
      placeholderAttemptsBeforeAccept: placeholderLimit,
      onRetry: ({ type, attempt, attempts: total, waitSeconds: retryWait, error }) => {
        if (type === 'placeholder') {
          console.log(
            `Update placeholder detected (attempt ${attempt}/${total}). Waiting ${retryWait}s...`
          );
        } else if (type === 'placeholder-limit') {
          console.log(
            `Update placeholder limit reached after ${attempt} attempts. Continuing with temp draft.`
          );
        } else {
          console.log(
            `Update source not ready (attempt ${attempt}/${total}, status ${error?.status}). Retrying in ${retryWait}s...`
          );
        }
      },
    });

    const baseDownloadDir =
      process.env.LOVABLE_DOWNLOAD_BASE || path.join(os.tmpdir(), 'downloads');
    const downloadDir = path.join(baseDownloadDir, String(newProjectId));
    await downloadProjectFiles(client, newProjectId, {
      outputDir: downloadDir,
      zip: false,
      projectData,
    });

    const { distPath, target } = await buildAndUpload(downloadDir, {
      bucket: resolvedBucket,
      prefix: tempPrefix,
      profile,
      skipInstall: Boolean(skipInstall),
    });

    await updateDraftStatus({
      projectId,
      draftId,
      status: 'ready',
      metadata: {
        distPath,
        target,
        lovProjectId: newProjectId,
      },
    });

    return {
      projectId,
      draftId,
      status: 'ready',
      target,
      tempPrefix,
    };
  } catch (error) {
    await updateDraftStatus({
      projectId,
      draftId,
      status: 'failed',
      message: error.message,
    });
    throw error;
  }
};

const copyDraftToLive = async ({ bucket, draftPrefix, livePrefix }) => {
  const s3 = ensureS3();
  const sourcePrefix = sanitizePrefix(draftPrefix);
  const destinationPrefix = sanitizePrefix(livePrefix);
  let continuationToken = undefined;

  do {
    const listing = await s3
      .listObjectsV2({
        Bucket: bucket,
        Prefix: sourcePrefix,
        ContinuationToken: continuationToken,
      })
      .promise();

    const copyOps = (listing.Contents || []).map((object) => {
      const destinationKey = destinationPrefix
        ? `${destinationPrefix}/${object.Key.slice(sourcePrefix.length).replace(/^\/+/, '')}`
        : object.Key.slice(sourcePrefix.length).replace(/^\/+/, '');
      return s3
        .copyObject({
          Bucket: bucket,
          CopySource: `${bucket}/${object.Key}`,
          Key: destinationKey || object.Key,
          MetadataDirective: 'COPY',
        })
        .promise();
    });

    await Promise.all(copyOps);
    continuationToken = listing.IsTruncated ? listing.NextContinuationToken : undefined;
  } while (continuationToken);
};

const approveUpdate = async ({
  projectId,
  draftId,
  bucket,
  livePrefix,
  approvedBy,
}) => {
  if (!projectId || !draftId) throw new Error('projectId and draftId are required.');
  const resolvedBucket = bucket || process.env.LOVABLE_DEPLOY_BUCKET;
  if (!resolvedBucket) throw new Error('bucket is required.');

  const draft = await getDraftRecord({ projectId, draftId });
  if (!draft) throw new Error('Draft not found.');
  if (draft.status !== 'ready') {
    throw new Error(`Draft is not ready for approval (status: ${draft.status}).`);
  }

  const live = livePrefix || draft.livePrefix || sanitizePrefix(process.env.LOVABLE_DEPLOY_PREFIX || '');
  if (!live) {
    throw new Error('live prefix is required to approve drafts.');
  }

  await copyDraftToLive({
    bucket: resolvedBucket,
    draftPrefix: draft.tempPrefix,
    livePrefix: live,
  });

  await updateDraftStatus({
    projectId,
    draftId,
    status: 'published',
    metadata: {
      approvedAt: new Date().toISOString(),
      approvedBy: approvedBy?.sub || null,
      livePrefix: live,
    },
  });

  return { projectId, draftId, status: 'published' };
};

const listUpdates = async ({ projectId, limit }) => {
  if (!projectId) throw new Error('projectId is required.');
  const drafts = await listDraftsForProject({ projectId, limit });
  return drafts;
};

module.exports = { runUpdate, approveUpdate, listUpdates };
