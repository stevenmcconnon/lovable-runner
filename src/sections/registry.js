const fs = require('node:fs');
const path = require('node:path');

const manifestPath = path.join(__dirname, '..', '..', 'templates', 'site-base', 'section-meta.json');

const readSectionManifest = () => {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  return JSON.parse(raw);
};

const SECTION_MANIFEST = readSectionManifest();
const SECTION_IDS = SECTION_MANIFEST.map((item) => item.id);

const SECTION_GROUPS = SECTION_MANIFEST.reduce((acc, item) => {
  if (!acc[item.group]) acc[item.group] = [];
  acc[item.group].push(item.id);
  return acc;
}, {});

module.exports = { SECTION_MANIFEST, SECTION_IDS, SECTION_GROUPS };
