const AWS = require('aws-sdk');

const resolveBucket = () =>
  process.env.SITE_STORE_BUCKET ||
  process.env.LAUNCH_STATUS_BUCKET ||
  process.env.LOVABLE_DEPLOY_BUCKET ||
  process.env.DEPLOY_BUCKET ||
  process.env.TEMPLATE_UPLOAD_BUCKET ||
  null;

const buildContentKey = (slug) => `site-builds/sites/${slug}/content.json`;
const buildTemplateKey = (slug) => `site-builds/sites/${slug}/template.json`;
const buildLegacyKey = (slug) => `site-builds/sites/${slug}/site.json`;
const buildHistoryBase = (slug, timestamp) =>
  `site-builds/sites/${slug}/history/${timestamp.replace(/[:.]/g, '-')}`;

const s3 = new AWS.S3();

const parseAccountSiteMap = () => {
  const raw = process.env.ACCOUNT_SITE_MAP;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    console.warn('[site-store] Failed to parse ACCOUNT_SITE_MAP (expected JSON object)', error.message);
    return null;
  }
};

const resolveSlugsForUser = (user) => {
  const map = parseAccountSiteMap();
  if (!map) return null;
  const keys = [
    user?.accountId,
    user?.sub,
    user?.email,
    ...(user?.groups || []),
  ].filter(Boolean);
  const resolved = new Set();
  keys.forEach((key) => {
    const entry = map[key];
    if (Array.isArray(entry)) {
      entry.forEach((slug) => resolved.add(slug));
    }
  });
  const fallback = map['*'] || map.default;
  if (Array.isArray(fallback)) {
    fallback.forEach((slug) => resolved.add(slug));
  }
  return resolved.size ? Array.from(resolved) : null;
};

const writeJson = async ({ bucket, key, payload }) => {
  await s3
    .putObject({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(payload, null, 2),
      ContentType: 'application/json',
    })
    .promise();
};

const listHistoryEntries = async ({ slug, limit = 50 }) => {
  const bucket = resolveBucket();
  if (!bucket || !slug) return [];
  const prefix = `site-builds/sites/${slug}/history/`;
  const listing = await s3
    .listObjectsV2({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: '/',
    })
    .promise();
  const entries =
    listing.CommonPrefixes?.map((entry) => entry.Prefix.replace(prefix, '').replace(/\/$/, '')) || [];
  const sorted = entries
    .map((val) => ({
      id: val,
      timestamp: val.replace(/-/g, ':'),
    }))
    .sort((a, b) => (a.id < b.id ? 1 : -1))
    .slice(0, limit);
  return sorted;
};

const loadHistoryEntry = async ({ slug, historyId }) => {
  const bucket = resolveBucket();
  if (!bucket || !slug || !historyId) return null;
  const base = `site-builds/sites/${slug}/history/${historyId}`;
  try {
    const [contentRaw, templateRaw] = await Promise.all([
      s3
        .getObject({
          Bucket: bucket,
          Key: `${base}/content.json`,
        })
        .promise(),
      s3
        .getObject({
          Bucket: bucket,
          Key: `${base}/template.json`,
        })
        .promise()
        .catch((err) => {
          if (err.code !== 'NoSuchKey') throw err;
          return null;
        }),
    ]);
    return {
      content: JSON.parse(contentRaw.Body.toString('utf8')),
      template: templateRaw ? JSON.parse(templateRaw.Body.toString('utf8')) : null,
      bucket,
      base,
    };
  } catch (error) {
    console.warn('[site-store] Failed to load history entry', { slug, historyId, err: error.message });
    return null;
  }
};

const deriveImageSlots = (section = {}) => {
  const slots = [];
  const sectionId = section.id || section.componentId || 'section';
  const addSlot = (slot) => slots.push(slot);

  switch (section.componentId) {
    case 'hero-with-image':
      addSlot({
        id: `${sectionId}-image`,
        type: 'image',
        path: 'props.image',
        prompt: section.props?.imagePrompt,
        required: true,
      });
      break;
    case 'gallery-carousel':
      addSlot({
        id: `${sectionId}-items`,
        type: 'image',
        path: 'props.items[].image',
        mode: 'scroll',
        required: true,
      });
      break;
    case 'cta-banner':
      addSlot({
        id: `${sectionId}-image`,
        type: 'image',
        path: 'props.image',
        prompt: section.props?.imagePrompt,
      });
      break;
    case 'process-timeline':
      addSlot({
        id: `${sectionId}-supporting`,
        type: 'image',
        path: 'props.image',
        prompt: section.props?.imagePrompt,
      });
      break;
    case 'features-grid':
      addSlot({
        id: `${sectionId}-features`,
        type: 'image',
        path: 'props.features[].image',
      });
      break;
    case 'pricing-table':
      addSlot({
        id: `${sectionId}-tiers`,
        type: 'image',
        path: 'props.tiers[].image',
      });
      break;
    default:
      break;
  }

  if (section.props?.imagePrompt && !slots.length) {
    addSlot({
      id: `${sectionId}-image`,
      type: 'image',
      path: 'props.image',
      prompt: section.props.imagePrompt,
    });
  }

  return slots;
};

const buildTemplateSummary = (site = {}, metadata = {}) => {
  // Summaries (component + field map) are kept for quick menus,
  // but we also preserve full sections/pages with props so the renderer
  // can hydrate without losing data.
  const mapSections = (sections = []) =>
    sections
      .map((section) => ({
        id: section?.id || null,
        componentId: section?.componentId || null,
        slots: deriveImageSlots(section),
        fields: Object.keys(section?.props || {}),
      }))
      .filter((entry) => entry.componentId);

  const pageSummaries = Array.isArray(site.pages)
    ? site.pages.map((page) => ({
        path: page?.path,
        title: page?.title,
        sections: mapSections(page?.sections || []),
      }))
    : null;

  const sectionSummary = mapSections(site.sections || []);

  const components = new Set();
  sectionSummary.forEach((item) => components.add(item.componentId));
  (pageSummaries || []).forEach((page) => {
    (page.sections || []).forEach((section) => components.add(section.componentId));
  });

  return {
    templateId: site.templateId || metadata.templateId || null,
    // Full definitions (including props) for rendering/hydration
    sections: site.sections || [],
    pages: site.pages || [],
    // Summaries remain for selection/menus
    summary: {
      sections: sectionSummary,
      pages: pageSummaries || undefined,
    },
    components: Array.from(components),
    layout: {
      sections: sectionSummary,
      pages: pageSummaries || undefined,
    },
  };
};

const snapshotExistingArtifacts = async ({ bucket, slug }) => {
  if (!bucket || !slug) return;
  try {
    const [existingContent, existingTemplate] = await Promise.all([
      s3
        .getObject({
          Bucket: bucket,
          Key: buildContentKey(slug),
        })
        .promise()
        .catch((err) => {
          if (err.code !== 'NoSuchKey') throw err;
          return null;
        }),
      s3
        .getObject({
          Bucket: bucket,
          Key: buildTemplateKey(slug),
        })
        .promise()
        .catch((err) => {
          if (err.code !== 'NoSuchKey') throw err;
          return null;
        }),
    ]);
    if (!existingContent && !existingTemplate) return;
    const timestamp = new Date().toISOString();
    const historyBase = buildHistoryBase(slug, timestamp);
    const uploads = [];
    if (existingContent) {
      uploads.push(
        s3
          .putObject({
            Bucket: bucket,
            Key: `${historyBase}/content.json`,
            Body: existingContent.Body,
            ContentType: 'application/json',
          })
          .promise()
      );
    }
    if (existingTemplate) {
      uploads.push(
        s3
          .putObject({
            Bucket: bucket,
            Key: `${historyBase}/template.json`,
            Body: existingTemplate.Body,
            ContentType: 'application/json',
          })
          .promise()
      );
    }
    await Promise.all(uploads);
  } catch (error) {
    console.warn('[site-store] Failed to snapshot previous version', {
      slug,
      err: error?.message,
    });
  }
};

const saveSiteConfig = async ({ slug, site, metadata, storagePrefix }) => {
  const bucket = resolveBucket();
  if (!bucket || !slug || !site) return;

  await snapshotExistingArtifacts({ bucket, slug });

  const timestamp = new Date().toISOString();
  const mergedMetadata = {
    ...(metadata || {}),
    updatedAt: timestamp,
  };

  const contentRecord = { slug, site };
  const templateRecord = {
    slug,
    template: buildTemplateSummary(site, mergedMetadata),
    metadata: mergedMetadata,
  };

  const uploads = [
    { key: buildContentKey(slug), payload: contentRecord },
    { key: buildTemplateKey(slug), payload: templateRecord },
  ];

  if (storagePrefix) {
    const base = storagePrefix.replace(/\/+$/, '');
    uploads.push(
      { key: base ? `${base}/content.json` : 'content.json', payload: contentRecord },
      { key: base ? `${base}/template.json` : 'template.json', payload: templateRecord }
    );
  }

  for (const entry of uploads) {
    try {
      await writeJson({ bucket, key: entry.key, payload: entry.payload });
    } catch (error) {
      console.warn('[site-store] Failed to persist site config', {
        key: entry.key,
        err: error?.message,
      });
    }
  }
};

const extractSlugFromKey = (key) => {
  const match = key.match(/site-builds\/sites\/([^/]+)\/content\.json$/);
  return match ? match[1] : null;
};

const listSiteConfigs = async ({ limit = 50, slugs } = {}) => {
  const bucket = resolveBucket();
  if (!bucket) {
    throw new Error('SITE_STORE_BUCKET or equivalent bucket env is required');
  }
  const prefix = 'site-builds/sites/';
  const maxResults = Math.min(Math.max(limit, 1), 200);
  let continuationToken;
  const keys = [];

  do {
    const listing = await s3
      .listObjectsV2({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: maxResults,
      })
      .promise();
    const foundKeys =
      listing.Contents?.map((item) => item.Key).filter((key) => key.endsWith('/content.json')) ||
      [];
    keys.push(...foundKeys);
    if (keys.length >= maxResults || !listing.IsTruncated) break;
    continuationToken = listing.NextContinuationToken;
  } while (continuationToken);

  const filteredKeys = Array.isArray(slugs) && slugs.length
    ? keys.filter((key) => slugs.includes(extractSlugFromKey(key)))
    : keys;

  const limitedKeys = filteredKeys.slice(0, maxResults);
  const records = await Promise.all(
    limitedKeys.map(async (key) => {
      const slug = extractSlugFromKey(key);
      try {
        const [contentRaw, templateRaw] = await Promise.all([
          s3
            .getObject({
              Bucket: bucket,
              Key: key,
            })
            .promise()
            .catch((err) => {
              if (err.code !== 'NoSuchKey') throw err;
              return null;
            }),
          s3
            .getObject({
              Bucket: bucket,
              Key: buildTemplateKey(slug),
            })
            .promise()
            .catch((err) => {
              if (err.code !== 'NoSuchKey') throw err;
              return null;
            }),
        ]);

        const content = contentRaw ? JSON.parse(contentRaw.Body.toString('utf8')) : null;
        const template = templateRaw ? JSON.parse(templateRaw.Body.toString('utf8')) : null;

        if (!content?.site) return null;
        return {
          slug: content.slug || slug,
          site: content.site,
          template: template?.template || null,
          metadata: template?.metadata || content.metadata || null,
        };
      } catch (error) {
        console.warn('[site-store] Failed to load site config from list', {
          key,
          err: error.message,
        });
        return null;
      }
    })
  );

  return records.filter(Boolean);
};

const getAllowedSlugsForUser = (user) => resolveSlugsForUser(user) || null;

const listSitesForUser = async ({ user, limit } = {}) => {
  const allowedSlugs = resolveSlugsForUser(user);
  const records = await listSiteConfigs({ limit, slugs: allowedSlugs || undefined });
  const items = records.map((record) => ({
    slug: record.slug,
    bucket: record.metadata?.bucket,
    prefix: record.metadata?.prefix,
    publicUrl: record.metadata?.publicUrl,
    requestId: record.metadata?.requestId,
    sourceUrl: record.metadata?.sourceUrl,
    description: record.metadata?.description,
    status: 'completed',
    createdAt: record.metadata?.lastBuildAt,
    updatedAt: record.metadata?.updatedAt || record.metadata?.lastBuildAt,
  }));
  return items;
};

const loadSiteConfig = async (slug) => {
  if (!slug) return null;
  const bucket = resolveBucket();
  if (!bucket) return null;
  try {
    const [contentRaw, templateRaw] = await Promise.all([
      s3
        .getObject({
          Bucket: bucket,
          Key: buildContentKey(slug),
        })
        .promise(),
      s3
        .getObject({
          Bucket: bucket,
          Key: buildTemplateKey(slug),
        })
        .promise()
        .catch((err) => {
          if (err.code !== 'NoSuchKey') throw err;
          return null;
        }),
    ]);

    const content = JSON.parse(contentRaw.Body.toString('utf8'));
    const template = templateRaw ? JSON.parse(templateRaw.Body.toString('utf8')) : null;
    return {
      slug: content.slug || slug,
      site: content.site,
      template: template?.template || null,
      metadata: template?.metadata || content.metadata || null,
    };
  } catch (error) {
    if (error.code !== 'NoSuchKey') {
      console.warn('[site-store] Failed to load site config', error.message);
    }
    return null;
  }
};

const restoreSiteFromHistory = async ({ slug, historyId }) => {
  if (!slug || !historyId) {
    throw new Error('slug and historyId are required');
  }
  const history = await loadHistoryEntry({ slug, historyId });
  if (!history) {
    const error = new Error('History entry not found');
    error.statusCode = 404;
    throw error;
  }
  const bucket = history.bucket;
  const uploads = [];
  if (history.content) {
    uploads.push(
      writeJson({
        bucket,
        key: buildContentKey(slug),
        payload: history.content,
      })
    );
  }
  if (history.template) {
    uploads.push(
      writeJson({
        bucket,
        key: buildTemplateKey(slug),
        payload: history.template,
      })
    );
  }
  await Promise.all(uploads);
  return { slug, historyId };
};

module.exports = {
  saveSiteConfig,
  loadSiteConfig,
  listSiteConfigs,
  listSitesForUser,
  listHistoryEntries,
  restoreSiteFromHistory,
  getAllowedSlugsForUser,
};
