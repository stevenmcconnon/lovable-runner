const fs = require('node:fs');
const path = require('node:path');

const fetch = global.fetch;

const templateRoot = path.join(__dirname, '..', 'templates');
const manifestPath = path.join(templateRoot, 'template-library.json');
const presetsPath = path.join(templateRoot, 'template-copy-presets.json');
const libraryDir = path.join(templateRoot, 'library');

const catalogConfig = {
  baseUrl: (process.env.TEMPLATE_LIBRARY_BASE_URL || process.env.TEMPLATE_API_BASE || '').replace(/\/+$/, ''),
  token: process.env.TEMPLATE_LIBRARY_TOKEN || process.env.SITE_DOCS_TOKEN || '',
};

const CACHE_TTL_MS = Number(process.env.TEMPLATE_LIBRARY_CACHE_MS || 5 * 60 * 1000);

let manifestCache = { data: null, fetchedAt: 0 };
let presetsCache = { data: null, fetchedAt: 0 };
const specCache = new Map();

const readJsonFile = (filePath) => {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const fetchJson = async (pathname) => {
  const base = (catalogConfig.baseUrl || '').replace(/\/+$/, '');
  const token = (catalogConfig.token || '').trim();
  if (!base || !token || typeof fetch !== 'function') return null;
  const url = `${base}${pathname.startsWith('/') ? '' : '/'}${pathname}`;
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'x-templates-token': token,
      },
    });
    if (!response.ok) {
      return null;
    }
    return response.json();
  } catch {
    return null;
  }
};

const getManifest = async () => {
  if (manifestCache.data && Date.now() - manifestCache.fetchedAt < CACHE_TTL_MS) {
    return manifestCache.data;
  }
  let manifest = await fetchJson('/templates');
  if (!manifest) {
    manifest = readJsonFile(manifestPath);
  }
  if (manifest) {
    manifestCache = { data: manifest, fetchedAt: Date.now() };
  }
  return manifest;
};

const getTemplatePresets = async () => {
  if (presetsCache.data && Date.now() - presetsCache.fetchedAt < CACHE_TTL_MS) {
    return presetsCache.data;
  }
  let presets = await fetchJson('/templates/presets');
  if (!presets) {
    presets = readJsonFile(presetsPath);
  }
  if (presets) {
    presetsCache = { data: presets, fetchedAt: Date.now() };
  }
  return presets;
};

const getTemplateSpec = async (templateId) => {
  const cached = specCache.get(templateId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }
  let spec = await fetchJson(`/templates/${templateId}`);
  if (!spec) {
    const specPath = path.join(libraryDir, `${templateId}.json`);
    spec = readJsonFile(specPath);
  }
  if (spec) {
    specCache.set(templateId, { data: spec, fetchedAt: Date.now() });
  }
  return spec;
};

const buildTemplateInventory = async (limit = 40) => {
  const manifest = await getManifest();
  const entries = Array.isArray(manifest?.templatesIndex) ? manifest.templatesIndex.slice(0, limit) : [];
  const specs = await Promise.all(
    entries.map(async (entry) => {
      const spec = await getTemplateSpec(entry.id);
      return { entry, spec };
    })
  );
  return specs
    .filter(({ entry, spec }) => entry && spec)
    .map(({ entry, spec }) => {
      const sectionList = Array.isArray(spec.sections) ? spec.sections.map((section) => section.componentId).filter(Boolean) : [];
      const tags = Array.isArray(entry.tags) ? entry.tags.join(', ') : '';
      const useCases = Array.isArray(entry.useCases) ? entry.useCases.join(', ') : '';
      return `- ${entry.id} (${entry.name}; ${entry.vertical || ''}${entry.subcategory ? `/${entry.subcategory}` : ''}) sections: ${sectionList.join(
        ', '
      )}; tags: ${tags}; useCases: ${useCases}`;
    })
    .join('\n');
};

module.exports = {
  getTemplateInventory: buildTemplateInventory,
  getTemplateManifest: getManifest,
  getTemplateSpec,
  getTemplatePresets,
};
