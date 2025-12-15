const { z } = require('zod');
const { SECTION_MANIFEST, SECTION_IDS, SECTION_GROUPS } = require('./sections/registry');
const { STYLE_PROFILE_IDS } = require('./style-profiles');

const ImageSchema = z.object({
  src: z.string().min(1),
  alt: z.string().optional(),
  generatedAt: z.string().optional(),
});

const MIN_IMAGE_PROMPTS = 2;
const REQUIRED_GROUPS = ['hero', 'services', 'social-proof', 'process', 'support', 'cta', 'proof'];
const MIN_SECTIONS_TOTAL = 8;
const MIN_TOTAL_WORDS = 400;
const BANNED_PHRASES = ['ai sitemaker', 'ai site maker', 'ai-sitemaker', 'lovable'];
const MAX_STATS_ITEMS = 3;

const SectionSchema = z.object({
  id: z.string().min(2),
  componentId: z.enum(SECTION_IDS),
  props: z.record(z.any()),
});

const PageSchema = z.object({
  path: z.string().min(1),
  title: z.string().min(2),
  sections: z.array(SectionSchema).min(5),
});

const IntegrationsSchema = z.object({
  analytics: z
    .array(
      z.object({
        type: z.enum(['ga', 'meta', 'gtm', 'other']).optional(),
        id: z.string().optional(),
      })
    )
    .optional(),
  chat: z
    .object({
      provider: z.string().optional(),
      key: z.string().optional(),
    })
    .optional(),
  newsletter: z
    .object({
      provider: z.string().optional(),
      listId: z.string().optional(),
      formAction: z.string().optional(),
    })
    .optional(),
});

const SiteSchema = z.object({
  meta: z.object({
    brandName: z.string().min(2),
    headline: z.string().min(10),
    subheadline: z.string().min(10),
  }),
  seo: z.object({
    title: z.string().min(10),
    description: z.string().min(20),
    keywords: z.array(z.string().min(2)).min(5),
  }),
  theme: z.object({
    primaryColor: z.string().min(4),
    accentColor: z.string().min(4),
    backgroundStyle: z.enum(['gradient', 'mesh', 'texture']),
    vibe: z.enum(['luxury', 'tech', 'playful', 'earthy']),
    textColor: z.string().min(4).optional(),
    cornerStyle: z.enum(['rounded', 'sharp']).optional(),
    displayFont: z.string().max(64).optional(),
    bodyFont: z.string().max(64).optional(),
    styleProfile: z.enum(STYLE_PROFILE_IDS).optional(),
  }),
  templateId: z.string().min(2),
  canonical: z.string().url().optional(),
  redirects: z
    .array(
      z.object({
        from: z.string().optional(),
        to: z.string().optional(),
        type: z.number().optional(),
      })
    )
    .optional(),
  openGraph: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      imagePrompt: z.string().optional(),
    })
    .optional(),
  schemaMarkup: z.string().optional(),
  integrations: IntegrationsSchema.optional(),
  sections: z.array(SectionSchema).min(8).optional(),
  pages: z.array(PageSchema).max(5).optional(),
}).superRefine((value, ctx) => {
  const sectionsCount = Array.isArray(value.sections) ? value.sections.length : 0;
  const pagesCount = Array.isArray(value.pages)
    ? value.pages.reduce((total, page) => total + (Array.isArray(page.sections) ? page.sections.length : 0), 0)
    : 0;
  const hasSections = sectionsCount >= MIN_SECTIONS_TOTAL;
  const hasPages = pagesCount >= MIN_SECTIONS_TOTAL;
  if (!hasSections && !hasPages) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Provide either sections (>=${MIN_SECTIONS_TOTAL}) or pages whose combined sections reach ${MIN_SECTIONS_TOTAL}.`,
      path: ['sections'],
    });
  }
});

const countWords = (value) => {
  if (!value) return 0;
  const text = String(value).trim();
  if (!text) return 0;
  return text.split(/\s+/).length;
};

const flattenStrings = (value) => {
  const strings = [];
  const visit = (node, key) => {
    if (node == null) return;
    if (typeof node === 'string') {
      if (key && key.toLowerCase().includes('image')) return;
      strings.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, key));
      return;
    }
    if (typeof node === 'object') {
      Object.entries(node).forEach(([childKey, childValue]) => visit(childValue, childKey));
    }
  };
  visit(value);
  return strings;
};

const validateSectionQuality = (section) => {
  const manifest = SECTION_MANIFEST.find((item) => item.id === section.componentId);
  if (!manifest) return `Unknown section component: ${section.componentId}`;
  if (
    section.componentId === 'stats-showcase' &&
    Array.isArray(section.props?.stats) &&
    section.props.stats.length > MAX_STATS_ITEMS
  ) {
    return `stats-showcase should include at most ${MAX_STATS_ITEMS} metrics by default`;
  }
  const strings = flattenStrings(section.props);
  const totalWords = strings.reduce((acc, str) => acc + countWords(str), 0);
  if (totalWords < manifest.minWordCount) {
    return `${section.componentId} copy too short (${totalWords}/${manifest.minWordCount} words)`;
  }
  for (const prop of manifest.requiredProps || []) {
    if (!(prop in (section.props || {}))) {
      return `${section.componentId} missing required prop: ${prop}`;
    }
  }
  if (section.props?.image) {
    const imageCheck = ImageSchema.safeParse(section.props.image);
    if (!imageCheck.success) {
      return `${section.componentId} image invalid: ${imageCheck.error.message}`;
    }
  }
  return null;
};

const countImagePrompts = (props) => {
  let total = 0;
  const walk = (node, currentKey = '') => {
    if (node == null) return;
    if (typeof node === 'string') {
      if (currentKey && currentKey.toLowerCase().includes('prompt') && node.trim().length > 8) {
        total += 1;
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((value) => walk(value, currentKey));
      return;
    }
    if (typeof node === 'object') {
      Object.entries(node).forEach(([key, value]) => walk(value, key));
    }
  };
  walk(props);
  return total;
};

const collectSections = (site) => {
  if (site.pages?.length) {
    return site.pages.flatMap((page) => page.sections || []);
  }
  return site.sections || [];
};

const validateSiteQuality = (siteJson) => {
  const errors = [];
  const success = SiteSchema.safeParse(siteJson);
  if (!success.success) {
    errors.push(success.error.message);
    return { valid: false, errors };
  }
  const site = success.data;
  const allSections = collectSections(site);
  if (allSections.length < MIN_SECTIONS_TOTAL) {
    errors.push(`Not enough sections (${allSections.length}/${MIN_SECTIONS_TOTAL}).`);
  }
  REQUIRED_GROUPS.forEach((group) => {
    const ids = SECTION_GROUPS[group] || [];
    const hasGroup = allSections.some((section) => ids.includes(section.componentId));
    if (!hasGroup) {
      errors.push(`Missing required section group: ${group}`);
    }
  });
  const imagePrompts = allSections.reduce((acc, section) => acc + countImagePrompts(section.props), 0);
  if (imagePrompts < MIN_IMAGE_PROMPTS) {
    errors.push(`Not enough imagery prompts (${imagePrompts}/${MIN_IMAGE_PROMPTS}). Include clear imagePrompt text in hero/features/cta sections.`);
  }
  const totalWords = allSections.reduce((acc, section) => {
    const strings = flattenStrings(section.props);
    return acc + strings.reduce((sum, text) => sum + countWords(text), 0);
  }, 0);
  if (totalWords < MIN_TOTAL_WORDS) {
    errors.push(`Overall copy too short (${totalWords}/${MIN_TOTAL_WORDS} words).`);
  }
  allSections.forEach((section) => {
    const error = validateSectionQuality(section);
    if (error) errors.push(error);
  });
  const strings = flattenStrings(site);
  const normalizedStrings = strings.map((str) => str.toLowerCase());
  const bannedFound = BANNED_PHRASES.find((phrase) => normalizedStrings.some((s) => s.includes(phrase)));
  if (bannedFound) {
    errors.push(`Banned branding present: "${bannedFound}". Remove AI-SiteMaker/Lovable references.`);
  }
  if (site.meta?.brandName) {
    const brand = site.meta.brandName.trim().toLowerCase();
    const sectionStrings = allSections
      .map((section) => flattenStrings(section.props))
      .flat()
      .map((str) => str.toLowerCase());
    const brandCore = brand.split(/\s+/).slice(0, 2).join(' ');
    const matchesBrand =
      brand &&
      (sectionStrings.some((s) => s.includes(brand)) ||
        (brandCore.length > 3 && sectionStrings.some((s) => s.includes(brandCore))));
    if (brand && !matchesBrand) {
      errors.push('Brand name from meta.brandName is not present in body copy.');
    }
  }
  return { valid: errors.length === 0, errors, site };
};

module.exports = { SiteSchema, validateSiteQuality };
