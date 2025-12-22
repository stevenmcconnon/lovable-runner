#!/usr/bin/env node
const path = require('node:path');
const { HeadObjectCommand, CopyObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { s3Client } = require('../src/aws-clients');

const rootRequire = (relativePath) =>
  // eslint-disable-next-line global-require, import/no-dynamic-require
  require(path.join(__dirname, '..', relativePath));

const { buildDraftStoragePrefix } = rootRequire('src/site-store.js');

const s3 = s3Client;

const resolveBucket = () =>
  process.env.SITE_STORE_BUCKET ||
  process.env.LAUNCH_STATUS_BUCKET ||
  process.env.LOVABLE_DEPLOY_BUCKET ||
  process.env.DEPLOY_BUCKET ||
  process.env.TEMPLATE_UPLOAD_BUCKET ||
  null;

const bucket = resolveBucket();

if (!bucket) {
  console.error('SITE_STORE_BUCKET (or equivalent) is required to run this script.');
  process.exit(1);
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const slugFilters = args.filter((arg) => !arg.startsWith('--'));

const encodeCopySource = (key) =>
  `/${bucket}/${encodeURIComponent(key).replace(/%2F/g, '/')}`;

const headObjectExists = async (key) => {
  try {
    await s3.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
    return true;
  } catch (error) {
    if (
      error.code === 'NotFound' ||
      error.code === 'NoSuchKey' ||
      error?.$metadata?.httpStatusCode === 404
    ) {
      return false;
    }
    throw error;
  }
};

const copyIfNeeded = async ({ slug, sourceKey, destinationKey }) => {
  const sourceExists = await headObjectExists(sourceKey);
  if (!sourceExists) {
    console.warn(`[draft-backfill] Missing source ${sourceKey} for slug ${slug}, skipping`);
    return { copied: false, skipped: true };
  }
  if (!force) {
    const destExists = await headObjectExists(destinationKey);
    if (destExists) {
      return { copied: false, skipped: true };
    }
  }
  await s3.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: destinationKey,
      CopySource: encodeCopySource(sourceKey),
      MetadataDirective: 'COPY',
    })
  );
  return { copied: true, skipped: false };
};

const listAvailableSlugs = async () => {
  const prefix = 'site-builds/sites/';
  const slugs = new Set();
  let continuationToken;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    (page.Contents || []).forEach((object) => {
      const key = object.Key || '';
      const match = key.match(/^site-builds\/sites\/([^/]+)\/content\.json$/);
      if (match) {
        slugs.add(match[1]);
      }
    });
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return Array.from(slugs);
};

const backfillSlug = async (slug) => {
  const draftPrefix = buildDraftStoragePrefix(slug);
  const normalizedPrefix = draftPrefix.replace(/\/+$/, '');
  const targets = [
    {
      sourceKey: `site-builds/sites/${slug}/content.json`,
      destinationKey: `${normalizedPrefix}/content.json`,
      label: 'content',
    },
    {
      sourceKey: `site-builds/sites/${slug}/template.json`,
      destinationKey: `${normalizedPrefix}/template.json`,
      label: 'template',
    },
  ];
  let copied = 0;
  for (const target of targets) {
    const result = await copyIfNeeded({
      slug,
      sourceKey: target.sourceKey,
      destinationKey: target.destinationKey,
    });
    if (result.copied) copied += 1;
  }
  return copied;
};

const run = async () => {
  const slugs = slugFilters.length ? slugFilters : await listAvailableSlugs();
  if (!slugs.length) {
    console.log('[draft-backfill] No slugs found, nothing to backfill.');
    return;
  }
  console.log(
    `[draft-backfill] Starting backfill for ${slugs.length} slug${slugs.length === 1 ? '' : 's'}${
      force ? ' (force enabled)' : ''
    }`
  );
  let totalCopies = 0;
  for (const slug of slugs) {
    try {
      const copied = await backfillSlug(slug);
      totalCopies += copied;
      console.log(`[draft-backfill] ${slug}: copied ${copied} object${copied === 1 ? '' : 's'}`);
    } catch (error) {
      console.error(`[draft-backfill] Failed to backfill slug ${slug}`, error.message);
    }
  }
  console.log(`[draft-backfill] Completed. Total objects copied: ${totalCopies}.`);
};

run().catch((error) => {
  console.error('[draft-backfill] Unhandled error', error);
  process.exit(1);
});
