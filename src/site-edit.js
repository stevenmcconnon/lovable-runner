const { randomUUID } = require('node:crypto');
const { loadSiteConfig } = require('./site-store');
const { validateSiteQuality } = require('./site-schema');
const { deploySiteFromConfig } = require('./launch');

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const mergeObjects = (target = {}, source = {}) => {
  if (source == null) return target;
  if (Array.isArray(source)) return source.map((item) => (typeof item === 'object' ? deepClone(item) : item));
  if (typeof source !== 'object') return source;
  const base = { ...(target || {}) };
  Object.entries(source).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      base[key] = mergeObjects([], value);
    } else if (value && typeof value === 'object') {
      base[key] = mergeObjects(base[key] || {}, value);
    } else {
      base[key] = value;
    }
  });
  return base;
};

const findSectionIndex = (sections, matcher) => {
  if (!Array.isArray(sections)) return -1;
  if (matcher.id) {
    const byId = sections.findIndex((section) => section.id === matcher.id);
    if (byId !== -1) return byId;
  }
  if (matcher.componentId) {
    const byComponent = sections.findIndex((section) => section.componentId === matcher.componentId);
    if (byComponent !== -1) return byComponent;
  }
  return -1;
};

const insertAtPosition = (sections, section, position) => {
  if (!position) {
    sections.push(section);
    return;
  }
  if (typeof position.index === 'number') {
    const idx = Math.max(0, Math.min(sections.length, position.index));
    sections.splice(idx, 0, section);
    return;
  }
  if (position.beforeId) {
    const beforeIdx = sections.findIndex((item) => item.id === position.beforeId);
    if (beforeIdx !== -1) {
      sections.splice(beforeIdx, 0, section);
      return;
    }
  }
  if (position.afterId) {
    const afterIdx = sections.findIndex((item) => item.id === position.afterId);
    if (afterIdx !== -1) {
      sections.splice(afterIdx + 1, 0, section);
      return;
    }
  }
  sections.push(section);
};

const applySectionsPatch = (currentSections = [], updates = []) => {
  const nextSections = currentSections.map((section) => deepClone(section));
  if (!Array.isArray(updates) || !updates.length) return nextSections;

  updates.forEach((entry = {}) => {
    const action = entry.action || 'update';
    if (action === 'remove') {
      const removeIdx = findSectionIndex(nextSections, entry);
      if (removeIdx !== -1) {
        nextSections.splice(removeIdx, 1);
      }
      return;
    }

    if (action === 'insert' || (action === 'update' && findSectionIndex(nextSections, entry) === -1)) {
      if (!entry.componentId) {
        throw new Error('componentId is required when inserting a section');
      }
      const newSection = {
        id: entry.id || `${entry.componentId}-${randomUUID().slice(0, 6)}`,
        componentId: entry.componentId,
        props: mergeObjects({}, entry.props || {}),
      };
      insertAtPosition(nextSections, newSection, entry.position);
      return;
    }

    const targetIdx = findSectionIndex(nextSections, entry);
    if (targetIdx === -1) {
      throw new Error(`Section not found for update: ${entry.id || entry.componentId}`);
    }
    const existing = nextSections[targetIdx];
    const updated = {
      ...existing,
      componentId: entry.componentId || existing.componentId,
      id: entry.id || existing.id,
      props: mergeObjects(existing.props || {}, entry.props || {}),
    };
    nextSections[targetIdx] = updated;
    if (entry.position) {
      const [moved] = nextSections.splice(targetIdx, 1);
      insertAtPosition(nextSections, moved, entry.position);
    }
  });

  return nextSections;
};

const applySitePatch = (baseSite, patch = {}) => {
  const nextSite = deepClone(baseSite);
  if (patch.meta) {
    nextSite.meta = mergeObjects(nextSite.meta || {}, patch.meta);
  }
  if (patch.seo) {
    nextSite.seo = mergeObjects(nextSite.seo || {}, patch.seo);
  }
  if (patch.theme) {
    nextSite.theme = mergeObjects(nextSite.theme || {}, patch.theme);
  }
  if (patch.sections) {
    nextSite.sections = applySectionsPatch(nextSite.sections || [], patch.sections);
  }
  return nextSite;
};

const resolveBucketFromEnv = () =>
  process.env.LOVABLE_DEPLOY_BUCKET ||
  process.env.DEPLOY_BUCKET ||
  process.env.TEMPLATE_UPLOAD_BUCKET ||
  process.env.PREVIEW_BUCKET ||
  null;

const updateSite = async ({
  slug,
  patch,
  site,
  regenerateImages = true,
  requestId,
  onProgress,
  description,
  sourceUrl,
}) => {
  if (!slug) throw new Error('slug is required');
  const stored = await loadSiteConfig(slug);
  if (!stored?.site) {
    throw new Error(`No site configuration found for slug ${slug}`);
  }

  const workingSite = site ? deepClone(site) : applySitePatch(stored.site, patch || {});
  const validation = validateSiteQuality(workingSite);
  if (!validation.valid) {
    throw new Error(`Updated site failed validation: ${validation.errors.join('; ')}`);
  }
  const validatedSite = validation.site || workingSite;

  const bucket = stored.metadata?.bucket || resolveBucketFromEnv();
  if (!bucket) throw new Error('Unable to determine S3 bucket for deployment.');
  const prefix = stored.metadata?.prefix || slug;
  const requestLabel = requestId || `edit-${Date.now()}`;

  return deploySiteFromConfig({
    slug,
    site: validatedSite,
    bucket,
    prefix,
    requestId: requestLabel,
    sourceUrl: sourceUrl || patch?.sourceUrl || stored.metadata?.sourceUrl,
    description: description || patch?.description || stored.metadata?.description,
    onProgress,
    generateImages: regenerateImages !== false,
  });
};

module.exports = { applySitePatch, updateSite };
