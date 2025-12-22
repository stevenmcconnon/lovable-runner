const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const {
  HeadObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  PutObjectCommand,
} = require('@aws-sdk/client-s3');
const { s3Client } = require('./aws-clients');
const { uploadToS3 } = require('./deploy');
const { LovableClient } = require('./client');
const { downloadProjectFiles } = require('./downloader');
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

const sanitizePrefix = (prefix) => {
  if (!prefix) return '';
  return prefix.replace(/^\/+/, '').replace(/\/+$/, '');
};

const buildS3Url = ({ bucket, key }) => {
  const cleanedKey = key.replace(/^\/+/, '');
  return `https://${bucket}.s3.amazonaws.com/${cleanedKey}`;
};

const buildPublicUrlFromKey = ({ bucket, key }) => {
  const previewDomain = (process.env.PREVIEW_DOMAIN || '').replace(/\/+$/, '');
  const cleanedKey = key.replace(/^\/+/, '');
  if (previewDomain) {
    return `https://${previewDomain}/${cleanedKey}`;
  }
  return buildS3Url({ bucket, key });
};

const writeJson = async ({ s3, bucket, key, payload }) => {
  const client = s3 || s3Client;
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(payload, null, 2),
      ContentType: 'application/json',
    })
  );
};

const readSiteContent = async (downloadDir) => {
  const filePath = path.join(downloadDir, 'src', 'content', 'site.json');
  const raw = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(raw);
};

const buildTemplateSummary = (site = {}) => {
  const mapSections = (sections = []) =>
    sections
      .map((section) => ({
        id: section?.id || null,
        componentId: section?.componentId || null,
      }))
      .filter((entry) => entry.componentId);

  const pages = Array.isArray(site.pages)
    ? site.pages.map((page) => ({
        path: page?.path,
        title: page?.title,
        sections: mapSections(page?.sections || []),
      }))
    : null;

  return {
    templateId: site.templateId || null,
    sections: mapSections(site.sections || []),
    pages: pages || undefined,
  };
};

const ensureBaseBundleUploaded = async ({ bucket, prefix, s3 }) => {
  if (!fs.existsSync(BASE_BUNDLE_DIR)) {
    throw new Error(`Base bundle not found at ${BASE_BUNDLE_DIR}. Run the build or set BASE_BUNDLE_DIR.`);
  }
  const client = s3 || s3Client;
  const normalizedPrefix = prefix ? `${prefix.replace(/\/+$/, '')}/` : '';
  const indexKey = `${normalizedPrefix}index.html`;

  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: indexKey,
      })
    );
    return false;
  } catch (error) {
    if (error.code && !['NotFound', 'NoSuchKey'].includes(error.code) && error?.$metadata?.httpStatusCode !== 404) {
      throw error;
    }
  }

  await uploadToS3(BASE_BUNDLE_DIR, { bucket, prefix, profile: undefined });
  return true;
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

const BASE_BUNDLE_DIR =
  process.env.BASE_BUNDLE_DIR ||
  path.join(__dirname, '..', 'templates', 'site-base', 'dist');

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

    const siteContent = await readSiteContent(downloadDir);
    const templateSummary = buildTemplateSummary(siteContent);
    const s3 = s3Client;
    const contentKey = `${tempPrefix}/content.json`;
    const templateKey = `${tempPrefix}/template.json`;
    const metadata = {
      lovProjectId: newProjectId,
      updatedAt: new Date().toISOString(),
      sourceUrl: url,
      instructions: instructions || '',
      requestedBy: requestedBy?.sub || null,
    };

    await writeJson({
      s3,
      bucket: resolvedBucket,
      key: contentKey,
      payload: { slug: projectId, site: siteContent },
    });
    await writeJson({
      s3,
      bucket: resolvedBucket,
      key: templateKey,
      payload: { slug: projectId, template: templateSummary, metadata },
    });

    await ensureBaseBundleUploaded({ bucket: resolvedBucket, prefix: tempPrefix, s3 });

    const contentUrl = buildPublicUrlFromKey({ bucket: resolvedBucket, key: contentKey });
    const templateUrl = buildPublicUrlFromKey({ bucket: resolvedBucket, key: templateKey });

    await updateDraftStatus({
      projectId,
      draftId,
      status: 'ready',
      metadata: {
        contentKey,
        templateKey,
        contentUrl,
        templateUrl,
        lovProjectId: newProjectId,
      },
    });

    return {
      projectId,
      draftId,
      status: 'ready',
      target: contentUrl,
      contentKey,
      templateKey,
      contentUrl,
      templateUrl,
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
  const sourcePrefix = sanitizePrefix(draftPrefix);
  const destinationPrefix = sanitizePrefix(livePrefix);
  let continuationToken = undefined;

  do {
    const listing = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: sourcePrefix,
        ContinuationToken: continuationToken,
      })
    );

    const copyOps = (listing.Contents || []).map((object) => {
      const destinationKey = destinationPrefix
        ? `${destinationPrefix}/${object.Key.slice(sourcePrefix.length).replace(/^\/+/, '')}`
        : object.Key.slice(sourcePrefix.length).replace(/^\/+/, '');
      return s3Client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: `${bucket}/${object.Key}`,
          Key: destinationKey || object.Key,
          MetadataDirective: 'COPY',
        })
      );
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
