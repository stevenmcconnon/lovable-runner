const { z } = require('zod');
const { SECTION_MANIFEST, SECTION_IDS, SECTION_GROUPS } = require('./sections/registry');

const ImageSchema = z.object({
  src: z.string().min(1),
  alt: z.string().optional(),
  generatedAt: z.string().optional(),
});

const SectionSchema = z.object({
  id: z.string().min(2),
  componentId: z.enum(SECTION_IDS),
  props: z.record(z.any()),
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
  }),
  sections: z.array(SectionSchema).min(6),
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

const MIN_IMAGE_PROMPTS = 2;
const REQUIRED_GROUPS = ['hero', 'services', 'social-proof', 'process', 'support', 'cta'];

const validateSectionQuality = (section) => {
  const manifest = SECTION_MANIFEST.find((item) => item.id === section.componentId);
  if (!manifest) return `Unknown section component: ${section.componentId}`;
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

const validateSiteQuality = (siteJson) => {
  const errors = [];
  const success = SiteSchema.safeParse(siteJson);
  if (!success.success) {
    errors.push(success.error.message);
    return { valid: false, errors };
  }
  const site = success.data;
  REQUIRED_GROUPS.forEach((group) => {
    const ids = SECTION_GROUPS[group] || [];
    const hasGroup = site.sections.some((section) => ids.includes(section.componentId));
    if (!hasGroup) {
      errors.push(`Missing required section group: ${group}`);
    }
  });
  const imagePrompts = site.sections.reduce((acc, section) => acc + countImagePrompts(section.props), 0);
  if (imagePrompts < MIN_IMAGE_PROMPTS) {
    errors.push(`Not enough imagery prompts (${imagePrompts}/${MIN_IMAGE_PROMPTS}). Include clear imagePrompt text in hero/features/cta sections.`);
  }
  const totalWords = site.sections.reduce((acc, section) => {
    const strings = flattenStrings(section.props);
    return acc + strings.reduce((sum, text) => sum + countWords(text), 0);
  }, 0);
  if (totalWords < 500) {
    errors.push(`Overall copy too short (${totalWords}/500 words).`);
  }
  site.sections.forEach((section) => {
    const error = validateSectionQuality(section);
    if (error) errors.push(error);
  });
  return { valid: errors.length === 0, errors, site };
};

module.exports = { SiteSchema, validateSiteQuality };
