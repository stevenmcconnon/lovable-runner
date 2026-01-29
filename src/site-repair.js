const { validateSiteQuality } = require('./site-schema');

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const stripBannedPhrases = (value) => {
  if (typeof value !== 'string') return value;
  // Keep this conservative: just remove obvious branding leaks.
  return value
    .replace(/ai[- ]?sitemaker/gi, '')
    .replace(/ai[- ]?site[- ]?maker/gi, '')
    .replace(/lovable/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

const walkAndRepairStrings = (node) => {
  if (typeof node === 'string') return stripBannedPhrases(node);
  if (Array.isArray(node)) return node.map(walkAndRepairStrings);
  if (!isPlainObject(node)) return node;
  const out = {};
  Object.entries(node).forEach(([key, value]) => {
    out[key] = walkAndRepairStrings(value);
  });
  return out;
};

const ensureObject = (value) => (isPlainObject(value) ? value : {});

const ensureNonEmptyString = (value, fallback) => {
  if (typeof value === 'string' && value.trim()) return value;
  return fallback;
};

const repairCtasInProps = (props) => {
  // Heuristic pass: find common CTA shapes and ensure label/href are present.
  const repairCta = (cta) => {
    if (!isPlainObject(cta)) return cta;
    const next = { ...cta };
    const label = ensureNonEmptyString(next.label, undefined);
    const href = ensureNonEmptyString(next.href, undefined);

    // If one is present but the other is missing, fill in safe defaults.
    if (!label && href) next.label = 'Get started';
    if (label && !href) next.href = '#contact';

    // If both missing but CTA object exists, set a minimal CTA.
    if (!ensureNonEmptyString(next.label, '') && !ensureNonEmptyString(next.href, '')) {
      next.label = 'Get started';
      next.href = '#contact';
    }

    return next;
  };

  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (!isPlainObject(node)) return node;

    const out = { ...node };
    Object.entries(out).forEach(([key, value]) => {
      const lower = key.toLowerCase();
      if (lower.includes('cta') && isPlainObject(value)) {
        out[key] = repairCta(value);
      } else {
        out[key] = walk(value);
      }
    });
    return out;
  };

  return walk(props);
};

const pruneEmptySections = (sections) => {
  if (!Array.isArray(sections)) return [];
  return sections
    .filter((section) => section && typeof section === 'object')
    .filter((section) => Boolean(section.componentId))
    .map((section) => ({
      ...section,
      props: ensureObject(section.props),
    }));
};

const repairSiteConfig = (site, { fallbackBrandName } = {}) => {
  const working = deepClone(site || {});

  // Ensure top-level shape.
  working.meta = ensureObject(working.meta);
  working.seo = ensureObject(working.seo);
  working.theme = ensureObject(working.theme);

  // Basic copy defaults.
  working.meta.brandName = ensureNonEmptyString(working.meta.brandName, fallbackBrandName);
  working.seo.title = ensureNonEmptyString(working.seo.title, working.meta.brandName || fallbackBrandName);
  working.seo.description = ensureNonEmptyString(
    working.seo.description,
    working.meta.subheadline || working.meta.headline || 'Professional services you can trust.'
  );

  // Sections/pages normalization.
  if (Array.isArray(working.pages) && working.pages.length) {
    working.pages = working.pages.map((page) => {
      const next = { ...page };
      next.sections = pruneEmptySections(page.sections);
      return next;
    });
  } else {
    working.sections = pruneEmptySections(working.sections);
  }

  // Repair strings + CTAs.
  const repaired = walkAndRepairStrings(working);
  const finalSite = deepClone(repaired);

  // Ensure each section has props and repair CTAs inside props.
  const repairSectionProps = (section) => ({
    ...section,
    props: repairCtasInProps(ensureObject(section.props)),
  });

  if (Array.isArray(finalSite.pages) && finalSite.pages.length) {
    finalSite.pages = finalSite.pages.map((page) => ({
      ...page,
      sections: (page.sections || []).map(repairSectionProps),
    }));
  } else {
    finalSite.sections = (finalSite.sections || []).map(repairSectionProps);
  }

  return finalSite;
};

const validateAndRepairSite = (site, opts = {}) => {
  const repaired = repairSiteConfig(site, opts);
  const validation = validateSiteQuality(repaired);
  return { repaired, validation };
};

module.exports = {
  repairSiteConfig,
  validateAndRepairSite,
};
