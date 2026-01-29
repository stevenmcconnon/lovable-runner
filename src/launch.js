const fs = require('node:fs');
const path = require('node:path');
const { ListObjectsV2Command, HeadObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { randomUUID } = require('node:crypto');
const fetch = global.fetch;
const { generateSiteWithOpenAI, generateSitePatchWithOpenAI } = require('./openai');
const { applyJsonPatch } = require('./json-patch');
const { validateAndRepairSite } = require('./site-repair');
const { refineThemePalette } = require('./color-agent');
const { saveSiteConfig } = require('./site-store');
const { uploadToS3 } = require('./deploy');
const { pickUnsplashImages } = require('./unsplash');
const { STYLE_PROFILE_IDS } = require('./style-profiles');
const crypto = require('node:crypto');
const { s3Client } = require('./aws-clients');

const MIN_IMAGES = 4;
const DEFAULT_STYLE_PROFILE = 'rounded-elevated';
const STYLE_PROFILE_DEFAULTS = {
  'rounded-elevated': { cornerStyle: 'rounded' },
  'sharp-minimal': { cornerStyle: 'sharp' },
  'full-bleed': { cornerStyle: 'sharp' },
};
const VIBE_STYLE_SUGGESTIONS = {
  luxury: 'rounded-elevated',
  playful: 'rounded-elevated',
  tech: 'sharp-minimal',
  earthy: 'full-bleed',
};
const UNSPLASH_REQUEST_LIMIT =
  Number.parseInt(process.env.UNSPLASH_REQUEST_LIMIT || '', 10) || 10;
const MAX_PROMPT_QUERIES = 3;
const MAX_KEYWORD_QUERIES = 3;
const MAX_ADAPTIVE_QUERIES = 4;

const loadDotEnvIfPresent = () => {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .forEach((line) => {
      const idx = line.indexOf('=');
      if (idx === -1) return;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    });
};

const slugify = (input) => {
  if (!input) return '';
  return input
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
};

const ensureUniqueSlug = async ({ bucket, basePrefix, slugCandidate }) => {
  const s3 = s3Client;
  const sanitizedBase = slugCandidate && slugCandidate.length ? slugCandidate : 'site';
  let attempt = 0;

  const buildPrefixPath = (slugValue) => {
    if (!slugValue) return '';
    return basePrefix
      ? `${basePrefix.replace(/\/$/, '')}/${slugValue}`
      : slugValue;
  };

  while (attempt < 10) {
    const candidate = attempt === 0 ? sanitizedBase : `${sanitizedBase}-${attempt}`;
    const prefixPath = buildPrefixPath(candidate);
    const existing = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${prefixPath}/`,
        MaxKeys: 1,
      })
    );
    if (!existing.Contents || existing.Contents.length === 0) {
      return { slug: candidate, prefixPath };
    }
    attempt += 1;
  }

  const fallback = `${sanitizedBase}-${Date.now()}`;
  return { slug: fallback, prefixPath: buildPrefixPath(fallback) };
};

const buildSlugCandidate = ({ businessDetails, url, description, requestId }) => {
  if (businessDetails?.businessName) return slugify(businessDetails.businessName);
  if (url) return slugify(url);
  if (description) return slugify(description.slice(0, 50));
  if (requestId) return slugify(requestId);
  return slugify(`site-${Date.now()}`);
};

const fetchSourceContext = async (url) => {
  if (!url) return null;
  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) {
      console.warn('[launch] Failed to fetch source url', { url, status: response.status });
      return null;
    }
    const html = await response.text();
    const withoutScripts = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ');

    const titleMatch = withoutScripts.match(/<title[^>]*>([^<]*)<\/title>/i);
    const metaDescriptionMatch = withoutScripts.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i
    );
    const ogTitleMatch = withoutScripts.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i
    );
    const ogDescriptionMatch = withoutScripts.match(
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i
    );
    const headings = Array.from(withoutScripts.matchAll(/<(h1|h2|h3)[^>]*>([^<]*)<\/\1>/gi))
      .map((m) => m[2])
      .filter(Boolean)
      .slice(0, 12)
      .join(' | ');

    const text = withoutScripts.replace(/<[^>]+>/g, ' ');
    const cleanedBody = text.replace(/\s+/g, ' ').trim();

    const chunks = [
      titleMatch?.[1] ? `Title: ${titleMatch[1]}` : '',
      metaDescriptionMatch?.[1] ? `Meta Description: ${metaDescriptionMatch[1]}` : '',
      ogTitleMatch?.[1] ? `OG Title: ${ogTitleMatch[1]}` : '',
      ogDescriptionMatch?.[1] ? `OG Description: ${ogDescriptionMatch[1]}` : '',
      headings ? `Headings: ${headings}` : '',
      cleanedBody ? `Body: ${cleanedBody}` : '',
    ].filter(Boolean);

    const combined = chunks.join(' | ').slice(0, 6000);
    if (!combined) return null;
    console.log('[launch] Fetched source summary', {
      url,
      length: combined.length,
    });
    return combined;
  } catch (error) {
    console.warn('[launch] Error fetching source url (continuing)', { url, err: error?.message });
    return null;
  }
};

const buildTestSiteConfig = ({ url, description }) => {
  const safeUrl = url || 'https://example.com';
  const safeDescription = description || 'Sample site generated in test mode.';
  const timestamp = new Date().toISOString();
  return {
    meta: {
      brandName: 'AI SiteMaker Test',
      headline: 'Edge-ready preview harness',
      subheadline: 'Validates the deploy loop without contacting Gemini.',
      location: 'San Francisco, CA',
      phone: '(555) 000-1000',
      email: 'lab@ai-sitemaker.com',
    },
    seo: {
      title: 'AI SiteMaker Pipeline Test',
      description: 'Automated verification for the AI SiteMaker preview + deploy workflow.',
      keywords: ['ai sitemaker', 'preview harness', 'lovable replacement', 'vite template', 'tailwind marketing'],
    },
    theme: {
      primaryColor: '#6366f1',
      accentColor: '#f97316',
      backgroundStyle: 'mesh',
      vibe: 'tech',
      cornerStyle: 'rounded',
    },
    sections: [
      {
        id: 'hero',
        componentId: 'hero-with-image',
        props: {
          eyebrow: 'Internal QA',
          title: 'This is a synthetic hero for smoke testing',
          subtitle: `${safeDescription} Reference: ${safeUrl}. Generated ${timestamp}.`,
          primaryCta: { label: 'View source', href: safeUrl },
          secondaryCta: { label: 'Inspect logs', href: '#logs' },
          stats: [
            { label: 'Latest run', value: new Date().toLocaleDateString() },
            { label: 'Deploy ms', value: '3200' },
            { label: 'Confidence', value: '99.8%' },
          ],
          imagePrompt: 'Isometric dashboard with deployment metrics and neon gradients',
        },
      },
      {
        id: 'features',
        componentId: 'features-grid',
      props: {
        title: 'What this test checks',
        subtitle: 'Ensures the base template builds, the dist bundle uploads to S3, and preview URLs resolve as HTML.',
        imagePrompt: 'Neon dashboard with tiles representing services/features and glowing icons',
        features: [
            {
              name: 'Template hydration',
              description: 'Copies the Vite + shadcn base project, injects site.json, and runs npm install/build on Lambda.',
              benefit: 'catch build regressions early',
            },
            {
              name: 'Preview integrity',
              description: 'Uploads hashed assets with accurate Content-Type headers so preview.ai-sitemaker.com renders inline.',
              benefit: 'no download prompts',
            },
            {
              name: 'Git export (optional)',
              description: 'Archives the generated project into the sites monorepo for auditing.',
              benefit: 'traceability',
            },
            {
              name: 'Status tracker',
              description: 'Writes status JSON into site-builds/status for CLI polling fallbacks.',
              benefit: 'observability',
            },
          ],
        },
      },
      {
        id: 'process',
        componentId: 'process-timeline',
        props: {
          title: 'Pipeline flow',
          subtitle: 'Every launch follows this sequence.',
          steps: [
            {
              id: '1',
              title: 'Generate site config',
              description: 'Either prompt Gemini or use the static harness JSON.',
              timeline: '00:00',
            },
            {
              id: '2',
              title: 'Build template',
              description: 'Install dependencies, run npm run build, collect dist.',
              timeline: '00:45',
            },
            {
              id: '3',
              title: 'Upload + warm cache',
              description: 'Push dist to S3 with correct headers and clear CloudFront caches.',
              timeline: '01:10',
            },
            {
              id: '4',
              title: 'Publish status',
              description: 'Record completion + preview URL for CLI and dashboard consumers.',
              timeline: '01:20',
            },
          ],
        },
      },
      {
        id: 'stats',
        componentId: 'stats-showcase',
      props: {
        title: 'Baseline telemetry',
        subtitle: 'Synthetic numbers to validate layout spacing.',
        imagePrompt: 'Glassmorphism analytics board with floating statistic cards in deep navy gradients',
          stats: [
            { label: 'Deploy/minute', value: '12', helper: 'with warm cache' },
            { label: 'Template age', value: '72 hrs', helper: 'since last reset' },
            { label: 'Preview TTFB', value: '420ms' },
            { label: 'Confidence', value: '99.8%' },
          ],
        },
      },
      {
        id: 'testimonials',
        componentId: 'testimonials-cards',
        props: {
          title: 'Why this harness exists',
          subtitle: 'Quotes from the AI SiteMaker platform team.',
          testimonials: [
            {
              name: 'Automation Bot',
              role: 'CI/CD',
              quote: 'If this template builds, we know the entire deploy stack is healthy.',
              highlight: 'Platform reliability',
            },
            {
              name: 'Preview Edge',
              role: 'Edge cache',
              quote: 'The new preview format keeps HTML streaming fast and never forces downloads.',
              highlight: 'Edge ready',
            },
            {
              name: 'Site Archive',
              role: 'Git storage',
              quote: 'Saving source + site.json per slug makes customer rollbacks trivial.',
              highlight: 'Audit trail',
            },
          ],
        },
      },
      {
        id: 'faq',
        componentId: 'faq-accordion',
        props: {
          title: 'FAQ',
          subtitle: 'Answers for anyone peeking at this harness output.',
          faqs: [
            {
              id: 'f1',
              question: 'Why am I seeing placeholder copy?',
              answer: 'Because the CLI was run with --simple test mode, bypassing Gemini to validate infrastructure only.',
            },
            {
              id: 'f2',
              question: 'Does this hit my AI quota?',
              answer: 'No. All copy is deterministic; no API calls were made to creative models.',
            },
            {
              id: 'f3',
              question: 'Where is the source saved?',
              answer: 'Under the AI SiteMaker template directory with a generated site.json for auditing.',
            },
            {
              id: 'f4',
              question: 'How do I run it locally?',
              answer: 'Clone the exported folder, npm install, npm run dev, and edit src/content/site.json.',
            },
          ],
        },
      },
      {
        id: 'pricing',
        componentId: 'pricing-table',
        props: {
          title: 'Internal plan comparison',
          subtitle: 'Illustrates the pricing layout inside the template.',
          tiers: [
            {
              name: 'Starter',
              description: 'Manual QA, single preview slug.',
              price: '$0',
              features: ['Gemini disabled', 'Single run', 'No git export'],
              ctaLabel: 'Use harness',
            },
            {
              name: 'Pro',
              description: 'Full pipeline with AI + git archive.',
              price: '$89',
              features: ['Gemini 3 Pro', 'Git export', 'Custom domains'],
              ctaLabel: 'Upgrade',
            },
            {
              name: 'Enterprise',
              description: 'Dedicated runners + SOC2 logging.',
              price: 'Contact',
              features: ['24/7 support', 'Audit logging', 'Rollbacks'],
              ctaLabel: 'Book call',
            },
          ],
        },
      },
      {
        id: 'cta',
        componentId: 'cta-banner',
        props: {
          title: 'Ready to trigger a real build?',
          body: 'Re-run the CLI without --simple and provide a real domain. Gemini will fill this same template with live copy.',
          primaryCta: { label: 'Launch production run', href: '#launch' },
          secondaryCta: { label: 'View docs', href: safeUrl },
          imagePrompt: 'Clean command palette with deploy button, neon glow, developer desk aesthetic',
        },
      },
    ],
  };
};

const BASE_BUNDLE_DIR =
  process.env.BASE_BUNDLE_DIR ||
  path.join(__dirname, '..', 'templates', 'site-base', 'dist');
const BASE_BUNDLE_CANONICAL_PREFIX = (process.env.BASE_BUNDLE_PREFIX || 'site-base/latest').replace(
  /\/+$/,
  ''
);

const buildJsonKeys = ({ prefix }) => {
  const base = (prefix || '').replace(/\/+$/, '');
  const contentKey = base ? `${base}/content.json` : 'content.json';
  const templateKey = base ? `${base}/template.json` : 'template.json';
  return { contentKey, templateKey };
};

const IMAGE_STOP_WORDS = new Set([
  'and',
  'the',
  'with',
  'your',
  'from',
  'into',
  'that',
  'this',
  'their',
  'best',
  'more',
  'than',
  'are',
  'our',
  'you',
  'for',
  'near',
  'area',
  'local',
]);

const tokenizeKeywords = (text = '') =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !IMAGE_STOP_WORDS.has(word));

const buildKeywordSet = (...phrases) => {
  const keywords = new Set();
  phrases
    .filter((phrase) => typeof phrase === 'string' && phrase.trim().length > 0)
    .forEach((phrase) => {
      tokenizeKeywords(phrase).forEach((token) => keywords.add(token));
    });
  return keywords;
};

const ABSTRACT_IMAGE_TERMS = [
  'abstract',
  'gradient',
  'pattern',
  'texture',
  'render',
  'rendered',
  '3d',
  'digital art',
  'wallpaper',
  'background',
  'mesh',
  'illustration',
  'graphic',
  'vector',
  'shape',
];

const OFF_TOPIC_IMAGE_TERMS = [
  'cat',
  'kitten',
  'dog',
  'puppy',
  'animal',
  'pet',
  'horse',
  'bird',
  'space',
  'galaxy',
  'nebula',
  'anime',
  'cartoon',
];

const ADAPTIVE_QUERY_SUFFIXES = [
  'services',
  'solutions',
  'team',
  'crew',
  'project',
  'worksite',
  'portfolio',
  'studio',
  'workshop',
  'installation',
  'local business',
];

const buildAdaptiveImageQueries = ({
  heroKeywords = new Set(),
  serviceKeywords = new Set(),
  businessDetails = {},
  site = {},
  description = '',
  generalQuery = '',
  heroSection = null,
}) => {
  const queries = new Set();
  const push = (value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed.length < 3) return;
    queries.add(trimmed);
  };

  [
    generalQuery,
    businessDetails.businessType,
    businessDetails.additionalDetails,
    site.meta?.headline,
    site.meta?.subheadline,
    site.meta?.location,
    site.theme?.vibe ? `${site.theme.vibe} aesthetic` : '',
    description,
  ].forEach(push);

  [heroSection?.props?.title, heroSection?.props?.subtitle, heroSection?.props?.eyebrow].forEach(push);

  const baseTokens = Array.from(new Set([...heroKeywords, ...serviceKeywords])).filter(
    (token) => token.length > 2
  );
  const businessDescriptor =
    businessDetails.businessType ||
    businessDetails.industry ||
    site.meta?.brandName ||
    site.meta?.headline ||
    '';

  baseTokens.slice(0, 12).forEach((token) => {
    if (businessDescriptor) push(`${token} ${businessDescriptor}`);
    ADAPTIVE_QUERY_SUFFIXES.forEach((suffix) => push(`${token} ${suffix}`));
  });

  const location = businessDetails.location || site.meta?.location || '';
  if (location) {
    baseTokens.slice(0, 8).forEach((token) => push(`${token} ${location}`));
    if (businessDescriptor) push(`${businessDescriptor} ${location}`);
  }

  for (let i = 0; i < Math.min(baseTokens.length, 6); i += 1) {
    for (let j = i + 1; j < Math.min(baseTokens.length, i + 4); j += 1) {
      const combo = `${baseTokens[i]} ${baseTokens[j]} ${businessDescriptor}`.trim();
      push(combo);
    }
  }

  return Array.from(queries).slice(0, 30);
};

const describePhotoText = (photo) => {
  if (!photo) return '';
  return [
    photo.alt || '',
    photo.description || '',
    Array.isArray(photo.tags) ? photo.tags.join(' ') : '',
  ]
    .join(' ')
    .toLowerCase();
};

const isAbstractImage = (photo) => {
  const text = describePhotoText(photo);
  if (!text.trim()) return false;
  return ABSTRACT_IMAGE_TERMS.some((term) => text.includes(term));
};

const isOffTopicPhoto = (photo) => {
  const text = describePhotoText(photo);
  if (!text.trim()) return false;
  return OFF_TOPIC_IMAGE_TERMS.some((term) => text.includes(term));
};

const buildGeneralImageQuery = ({ site = {}, businessDetails = {}, slug = '', description = '' }) => {
  const details = businessDetails && typeof businessDetails === 'object' ? businessDetails : {};
  const phrases = [];
  const push = (value) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      phrases.push(value.trim());
    }
  };

  push(details.businessType);
  push(details.additionalDetails);
  push(site.meta?.headline);
  push(site.meta?.subheadline);
  push(site.meta?.location);
  push(site.seo?.title);
  push(site.seo?.description);
  push(site.theme?.vibe ? `${site.theme.vibe} aesthetic` : '');
  push(description);
  if (slug) push(slug.replace(/-/g, ' '));

  const tokens = [];
  const seen = new Set();
  for (const phrase of phrases) {
    tokenizeKeywords(phrase).forEach((token) => {
      if (!seen.has(token)) {
        seen.add(token);
        tokens.push(token);
      }
    });
  }

  if (tokens.length >= 3) {
    return tokens.slice(0, 8).join(' ');
  }
  const fallback = phrases.find((value) => value && value.length > 3);
  return fallback || slug || null;
};

const collectImagePrompts = (site = {}) => {
  const prompts = new Set();
  const collectFromSection = (section) => {
    if (!section?.props) return;
    if (typeof section.props.imagePrompt === 'string' && section.props.imagePrompt.trim().length) {
      prompts.add(section.props.imagePrompt.trim());
    }
    ['items', 'features', 'tiers'].forEach((key) => {
      const arr = section.props[key];
      if (Array.isArray(arr)) {
        arr.forEach((entry) => {
          if (typeof entry?.imagePrompt === 'string' && entry.imagePrompt.trim().length) {
            prompts.add(entry.imagePrompt.trim());
          }
        });
      }
    });
  };
  (site.sections || []).forEach(collectFromSection);
  (site.pages || []).forEach((page) => (page.sections || []).forEach(collectFromSection));
  return Array.from(prompts);
};

const estimateImageDemand = (site = {}) => {
  let count = 0;
  const inspect = (section) => {
    if (!section?.props) return;
    if (section.props.image) count += 1;
    if (Array.isArray(section.props.items)) count += section.props.items.length;
    if (Array.isArray(section.props.features)) count += section.props.features.length;
    if (Array.isArray(section.props.tiers)) count += section.props.tiers.length;
    if (section.componentId === 'gallery-carousel') count += 4;
  };
  (site.sections || []).forEach(inspect);
  (site.pages || []).forEach((page) => (page.sections || []).forEach(inspect));
  return Math.max(count, 8);
};

const findHeroSection = (site = {}) => {
  if (Array.isArray(site.sections)) {
    const hero = site.sections.find((section) => section.componentId === 'hero-with-image');
    if (hero) return hero;
  }
  if (Array.isArray(site.pages)) {
    for (const page of site.pages) {
      if (!Array.isArray(page.sections)) continue;
      const hero = page.sections.find((section) => section.componentId === 'hero-with-image');
      if (hero) return hero;
    }
  }
  return null;
};

const scoreHeroPhoto = (photo, { heroKeywords, serviceKeywords }) => {
  if (!photo) return -Infinity;
  const text = describePhotoText(photo);
  let score = 0;
  heroKeywords.forEach((keyword) => {
    if (text.includes(keyword)) score += 4;
  });
  serviceKeywords.forEach((keyword) => {
    if (text.includes(keyword)) score += 2;
  });
  if (isAbstractImage(photo)) score -= 10;
  if (isOffTopicPhoto(photo)) score -= 8;
  if (photo.alt && /team|crew|people|family|project|studio/.test(photo.alt.toLowerCase())) {
    score += 1;
  }
  return score;
};

const selectHeroPhotoIndex = (photos, { heroKeywords, serviceKeywords }) => {
  if (!photos.length) return 0;
  let bestIdx = 0;
  let bestScore = -Infinity;
  photos.forEach((photo, idx) => {
    const score = scoreHeroPhoto(photo, { heroKeywords, serviceKeywords });
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });
  if (bestScore <= 0) {
    const nonAbstractIdx = photos.findIndex((photo) => !isAbstractImage(photo));
    if (nonAbstractIdx !== -1) return nonAbstractIdx;
  }
  return bestIdx;
};

const scorePhotoForSite = (photo, { heroKeywords, serviceKeywords }) => {
  if (!photo) return -Infinity;
  const text = describePhotoText(photo);
  let score = 0;
  serviceKeywords.forEach((keyword) => {
    if (text.includes(keyword)) score += 3;
  });
  heroKeywords.forEach((keyword) => {
    if (text.includes(keyword)) score += 2;
  });
  if (isAbstractImage(photo)) score -= 6;
  if (isOffTopicPhoto(photo)) score -= 10;
  return score;
};

const filterRelevantPhotos = (photos, { heroKeywords, serviceKeywords }) => {
  if (!photos.length) return photos;
  const keywordWeight = heroKeywords.size + serviceKeywords.size;
  const threshold = keywordWeight > 0 ? 1 : -2;
  const evaluated = photos
    .map((photo, idx) => ({
      photo,
      idx,
      score: scorePhotoForSite(photo, { heroKeywords, serviceKeywords }),
    }))
    .filter((entry) => entry.score >= threshold);
  if (!evaluated.length) {
    const nonAbstract = photos.filter((photo) => !isAbstractImage(photo) && !isOffTopicPhoto(photo));
    return nonAbstract.length ? nonAbstract : photos;
  }
  evaluated.sort((a, b) => b.score - a.score || a.idx - b.idx);
  return evaluated.map((entry) => entry.photo);
};

const elevateGallerySection = (sections = []) => {
  if (!Array.isArray(sections)) return sections;
  const galleryIdx = sections.findIndex((section) => section.componentId === 'gallery-carousel');
  if (galleryIdx > 0 && galleryIdx > 3) {
    const [gallery] = sections.splice(galleryIdx, 1);
    const targetIndex = Math.min(3, sections.length);
    sections.splice(targetIndex, 0, gallery);
  }
  return sections;
};

const attachStockImages = async ({ site, slug, businessDetails, description }) => {
  if (!site || !slug) return site;
  const bucket =
    process.env.LOVABLE_DEPLOY_BUCKET ||
    process.env.DEPLOY_BUCKET ||
    process.env.TEMPLATE_UPLOAD_BUCKET;
  const s3 = bucket ? s3Client : null;

  const downloadAndCache = async (src) => {
    if (!s3 || !bucket) return src;
    const url = typeof src === 'string' ? src.trim() : '';
    if (!url || !/^https?:/i.test(url)) return url;
    try {
      const parsed = new URL(url);
      if (parsed.hostname && parsed.hostname.includes('unsplash.com')) {
        return url;
      }
    } catch (error) {
      // fall through to caching attempt for non-Unsplash URLs
    }
    try {
      const extMatch = url.match(/\.(jpg|jpeg|png|webp)(\?.*)?$/i);
      const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
      const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 20);
      const key = `${BASE_BUNDLE_CANONICAL_PREFIX}/assets/stock/${hash}.${ext}`;

      try {
        await s3.send(
          new HeadObjectCommand({
            Bucket: bucket,
            Key: key,
          })
        );
        return `/assets/stock/${hash}.${ext}`;
      } catch (err) {
        if (
          err?.code &&
          !['NotFound', 'NoSuchKey'].includes(err.code) &&
          err?.$metadata?.httpStatusCode !== 404
        ) {
          throw err;
        }
      }

      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Fetch failed ${resp.status}`);
      const arrayBuffer = await resp.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentType =
        resp.headers.get('content-type') ||
        (ext === 'png'
          ? 'image/png'
          : ext === 'webp'
          ? 'image/webp'
          : 'image/jpeg');

      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        })
      );

      return `/assets/stock/${hash}.${ext}`;
    } catch (error) {
      console.warn('[images] Failed to cache stock image', { url, err: error?.message });
      // Fallback to a local placeholder so the UI never shows broken images.
      return '/placeholder.svg';
    }
  };

  const seed = `${slug}-${site.meta?.brandName || site.meta?.headline || ''}`;
  const generalQuery = buildGeneralImageQuery({ site, businessDetails, slug, description });
  const promptQueries = collectImagePrompts(site);
  const estimatedNeed = estimateImageDemand(site);
  const heroSourceSection = findHeroSection(site);
  const heroKeywords = buildKeywordSet(
    heroSourceSection?.props?.title,
    heroSourceSection?.props?.subtitle,
    heroSourceSection?.props?.eyebrow,
    site.meta?.brandName,
    businessDetails?.businessName,
    description
  );
  const serviceKeywords = buildKeywordSet(
    generalQuery,
    site.meta?.headline,
    site.meta?.subheadline,
    site.meta?.location,
    businessDetails?.businessType,
    businessDetails?.additionalDetails,
    slug ? slug.replace(/-/g, ' ') : ''
  );

  const collectedPhotos = [];
  const seen = new Set();
  const attemptedQueries = new Set();
  const desiredPhotoCount = Math.max(estimatedNeed * 3, MIN_IMAGES * 5);
  const unsplashBudget = Math.max(1, UNSPLASH_REQUEST_LIMIT || 10);
  let unsplashRequests = 0;
  let unsplashRateLimited = false;
  const shouldFetchMore = () =>
    !unsplashRateLimited &&
    collectedPhotos.length < desiredPhotoCount &&
    unsplashRequests < unsplashBudget;
  const addPhotos = (items = []) => {
    items.forEach((photo) => {
      if (!photo?.src) return;
      const key = photo.id || photo.src;
      if (key && seen.has(key)) return;
      if (key) seen.add(key);
      collectedPhotos.push(photo);
    });
  };
  const fetchAndAddPhotos = async ({ query, count = 4, seedValue = '' }) => {
    const trimmed = typeof query === 'string' ? query.trim() : '';
    if (!trimmed || attemptedQueries.has(trimmed)) return;
    if (!shouldFetchMore()) return;
    attemptedQueries.add(trimmed);
    try {
      unsplashRequests += 1;
      const photos = await pickUnsplashImages({
        query: trimmed,
        count,
        seedValue,
      });
      addPhotos(photos);
    } catch (error) {
      if (error?.rateLimited || error?.status === 403) {
        unsplashRateLimited = true;
        console.warn('[images] Unsplash rate limit reached; skipping remaining fetches');
      } else {
        console.warn('[images] Unsplash fetch failed', { query: trimmed, err: error?.message });
      }
    }
  };

  const heroImagePrompt =
    typeof heroSourceSection?.props?.imagePrompt === 'string'
      ? heroSourceSection.props.imagePrompt.trim()
      : '';
  const prioritizedPrompts = [];
  if (heroImagePrompt) prioritizedPrompts.push(heroImagePrompt);
  promptQueries.forEach((prompt) => {
    if (typeof prompt !== 'string') return;
    const trimmed = prompt.trim();
    if (!trimmed) return;
    if (!prioritizedPrompts.includes(trimmed)) {
      prioritizedPrompts.push(trimmed);
    }
  });
  const promptQueue = prioritizedPrompts.slice(0, MAX_PROMPT_QUERIES);

  if (generalQuery) {
    await fetchAndAddPhotos({
      query: generalQuery,
      count: Math.min(Math.max(estimatedNeed * 3, 18), 30),
      seedValue: `${seed}-general`,
    });
  }

  let promptIndex = 0;
  for (const prompt of promptQueue) {
    promptIndex += 1;
    await fetchAndAddPhotos({
      query: prompt,
      count: 4,
      seedValue: `${seed}-prompt-${promptIndex}`,
    });
  }

  const ensureKeywordPhotoCoverage = async () => {
    const minimumTargets = Math.max(estimatedNeed, 8);
    if (collectedPhotos.length >= minimumTargets || !shouldFetchMore()) return;
    const keywordPool = Array.from(new Set([...heroKeywords, ...serviceKeywords])).filter(
      (token) => token && token.length > 2
    );
    let keywordIndex = 0;
    for (const keyword of keywordPool.slice(0, MAX_KEYWORD_QUERIES)) {
      keywordIndex += 1;
      const combinedQuery = [
        keyword,
        businessDetails?.businessType,
        site.meta?.brandName,
      ]
        .filter(Boolean)
        .join(' ');
      await fetchAndAddPhotos({
        query: combinedQuery || keyword,
        count: 3,
        seedValue: `${seed}-keyword-${keywordIndex}`,
      });
      if (collectedPhotos.length >= minimumTargets * 1.5 || !shouldFetchMore()) break;
    }
  };

  await ensureKeywordPhotoCoverage();

  const ensureAdaptiveImageSweep = async () => {
    const desired = Math.max(estimatedNeed * 2, MIN_IMAGES * 4);
    if (collectedPhotos.length >= desired || !shouldFetchMore()) return;
    const adaptiveQueries = buildAdaptiveImageQueries({
      heroKeywords,
      serviceKeywords,
      businessDetails,
      site,
      description,
      generalQuery,
      heroSection: heroSourceSection,
    }).slice(0, MAX_ADAPTIVE_QUERIES);
    let adaptiveIndex = 0;
    for (const query of adaptiveQueries) {
      adaptiveIndex += 1;
      await fetchAndAddPhotos({
        query,
        count: 4,
        seedValue: `${seed}-adaptive-${adaptiveIndex}`,
      });
      if (collectedPhotos.length >= desired || !shouldFetchMore()) break;
    }
  };

  await ensureAdaptiveImageSweep();

  let rawPhotos = collectedPhotos.length ? collectedPhotos : [];

  // If the external image provider is empty/rate-limited, fall back to whatever
  // stock images we already have cached in the canonical bundle.
  if (!rawPhotos.length && s3 && bucket) {
    try {
      const stockPrefix = `${BASE_BUNDLE_CANONICAL_PREFIX}/assets/stock/`;
      const listing = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: stockPrefix,
          MaxKeys: 250,
        })
      );
      const keys = (listing.Contents || [])
        .map((item) => item.Key)
        .filter((key) => key && /\.(jpe?g|png|webp)$/i.test(key));

      rawPhotos = keys.map((key) => ({
        id: key,
        src: `/assets/stock/${key.slice(stockPrefix.length)}`,
        alt: site.meta?.headline || site.meta?.brandName || 'Stock image',
        photographer: null,
        creditUrl: null,
      }));

      if (rawPhotos.length) {
        console.log('[images] Using cached stock fallback pool', { count: rawPhotos.length });
      }
    } catch (error) {
      console.warn('[images] Failed to list cached stock images', { err: error?.message });
    }
  }

  let photos = filterRelevantPhotos(rawPhotos, { heroKeywords, serviceKeywords });
  if (!photos.length) photos = rawPhotos;

  let pool = photos.length ? [...photos] : [];
  let availablePhotos = [...pool];
  let recycledPhotos = [];
  const usedSrc = new Set();

  const takePhoto = (selectIndexFn, options = {}) => {
    if (!availablePhotos.length) {
      availablePhotos = recycledPhotos;
      recycledPhotos = [];
    }
    if (!availablePhotos.length) return null;

    let index;

    // Prefer images we haven't used yet on this site to avoid “canned” repeats.
    const unusedIndex = availablePhotos.findIndex((p) => p?.src && !usedSrc.has(p.src));
    if (unusedIndex !== -1) {
      index = unusedIndex;
    } else if (typeof selectIndexFn === 'function') {
      index = selectIndexFn(availablePhotos);
    } else {
      index = 0;
    }

    if (!Number.isFinite(index)) index = 0;
    index = Math.max(0, Math.min(index, availablePhotos.length - 1));

    const [photo] = availablePhotos.splice(index, 1);
    if (!photo) return null;

    if (photo.src) usedSrc.add(photo.src);
    // Allow reuse after the unique pool is exhausted (recycledPhotos) so we always have *something*.
    if (options.preventReuse !== true) {
      recycledPhotos.push(photo);
    }

    return photo;
  };

  let heroFilled = false;
  const maybeAttach = (section) => {
    if (!section?.props) return section;
    const updated = { ...section, props: { ...(section.props || {}) } };
    const isHero = section.componentId === 'hero-with-image' && !heroFilled;
    const needsImage =
      isHero || section.componentId === 'cta-banner' || section.componentId === 'process-timeline';
    if ((needsImage || updated.props.imagePrompt) && !updated.props.image?.src) {
      const photo = isHero
        ? takePhoto(
            (list) => selectHeroPhotoIndex(list, { heroKeywords, serviceKeywords }),
            { preventReuse: true }
          )
        : takePhoto();
      if (photo) {
        updated.props.image = {
          src: photo.src,
          alt: isHero
            ? updated.props.title || updated.props.subtitle || photo.alt
            : photo.alt,
          credit: photo.photographer,
          creditUrl: photo.creditUrl,
        };
        if (isHero) heroFilled = true;
      }
    }
    if (updated.componentId === 'gallery-carousel' && Array.isArray(updated.props.items)) {
      updated.props.items = updated.props.items.map((item) => {
        if (item?.image?.src) return item;
        const photo = takePhoto();
        if (!photo) return item;
        return {
          ...item,
          image: {
            src: photo.src,
            alt: item?.title || photo.alt,
            credit: photo.photographer,
            creditUrl: photo.creditUrl,
          },
        };
      });
    }
    return updated;
  };

  const harvestGalleryItems = (count = 4) => {
    const items = [];
    for (let i = 0; i < count; i += 1) {
      const photo = takePhoto();
      if (!photo) break;
      items.push({
        title: `Snapshot ${i + 1}`,
        description: 'Recent work and client moments.',
        badge: 'Highlights',
        image: {
          src: photo.src,
          alt: photo.alt,
          credit: photo.photographer,
          creditUrl: photo.creditUrl,
        },
      });
    }
    return items;
  };

  const flattenSections = (siteObj) => {
    const arr = [];
    if (Array.isArray(siteObj.sections)) arr.push(...siteObj.sections);
    if (Array.isArray(siteObj.pages)) {
      siteObj.pages.forEach((page) => {
        if (Array.isArray(page.sections)) arr.push(...page.sections);
      });
    }
    return arr;
  };

  let hasGallery = false;
  let imagesAssigned = 0;

  if (Array.isArray(site.sections)) {
    site.sections = site.sections.map((section) => {
      if (section.componentId === 'gallery-carousel') hasGallery = true;
      const updated = maybeAttach(section);
      if (updated.props?.image?.src) imagesAssigned += 1;
      return updated;
    });
  }
  if (Array.isArray(site.pages)) {
    site.pages = site.pages.map((page) => ({
      ...page,
      sections: Array.isArray(page.sections)
        ? page.sections.map((section) => {
            if (section.componentId === 'gallery-carousel') hasGallery = true;
            const updated = maybeAttach(section);
            if (updated.props?.image?.src) imagesAssigned += 1;
            return updated;
          })
        : page.sections,
    }));
  }

  if (!hasGallery && pool.length) {
    const galleryItems = harvestGalleryItems(4);
    if (galleryItems.length) {
      site.sections = site.sections || [];
      site.sections.push({
        id: 'gallery',
        componentId: 'gallery-carousel',
        props: {
          title: 'Recent highlights',
          subtitle: 'A few glimpses from recent client work and planning sessions.',
          items: galleryItems,
        },
      });
      imagesAssigned += galleryItems.length;
    }
  }

  // Ensure at least 3 images are sprinkled across sections by attaching to eligible sections lacking imagery.
  const eligibleForImages = new Set([
    'hero-with-image',
    'cta-banner',
    'process-timeline',
    'features-grid',
    'pricing-table',
    'stats-showcase',
    'faq-accordion',
  ]);
  const allSections = flattenSections(site);
  for (const section of allSections) {
    if (imagesAssigned >= MIN_IMAGES) break;
    if (!eligibleForImages.has(section.componentId)) continue;
    if (section.props?.image?.src) continue;
    const photo = takePhoto();
    if (!photo) break;
    section.props = {
      ...(section.props || {}),
      image: {
        src: photo.src,
        alt: photo.alt,
        credit: photo.photographer,
        creditUrl: photo.creditUrl,
      },
    };
    imagesAssigned += 1;
  }

  // Rehost images into canonical bundle to avoid hotlink failures.
  const rewriteImage = async (image) => {
    if (!image?.src) return image;
    if (!/^https?:/i.test(image.src)) return image;
    const cachedSrc = await downloadAndCache(image.src);
    return { ...image, src: cachedSrc };
  };

  const rewriteSectionImages = async (section) => {
    if (!section?.props) return section;
    const updated = { ...section, props: { ...(section.props || {}) } };
    if (updated.props.image) {
      updated.props.image = await rewriteImage(updated.props.image);
    }
    if (Array.isArray(updated.props.items)) {
      updated.props.items = await Promise.all(
        updated.props.items.map(async (item) => {
          if (item?.image) {
            return { ...item, image: await rewriteImage(item.image) };
          }
          return item;
        })
      );
    }
    if (Array.isArray(updated.props.features)) {
      updated.props.features = await Promise.all(
        updated.props.features.map(async (item) => {
          if (item?.image) {
            return { ...item, image: await rewriteImage(item.image) };
          }
          return item;
        })
      );
    }
    if (Array.isArray(updated.props.tiers)) {
      updated.props.tiers = await Promise.all(
        updated.props.tiers.map(async (item) => {
          if (item?.image) {
            return { ...item, image: await rewriteImage(item.image) };
          }
          return item;
        })
      );
    }
    return updated;
  };

  if (Array.isArray(site.sections)) {
    site.sections = await Promise.all(site.sections.map(rewriteSectionImages));
  }
  if (Array.isArray(site.pages)) {
    site.pages = await Promise.all(
      site.pages.map(async (page) => ({
        ...page,
        sections: Array.isArray(page.sections)
          ? await Promise.all(page.sections.map(rewriteSectionImages))
          : page.sections,
      }))
    );
  }

  return site;
};

const enforceSingleStatsBlock = (sections = []) => {
  let seenStats = false;
  return sections.filter((section) => {
    if (section.componentId === 'stats-showcase') {
      if (seenStats) return false;
      seenStats = true;
    }
    return true;
  });
};

const pickDeterministicCornerStyle = (seed = '') => {
  if (!seed) return 'rounded';
  let total = 0;
  for (let i = 0; i < seed.length; i += 1) {
    total += seed.charCodeAt(i);
  }
  return total % 2 === 0 ? 'rounded' : 'sharp';
};

const ensureCornerStyle = ({ site, slug }) => {
  if (!site?.theme) return;
  if (site.theme.cornerStyle === 'rounded' || site.theme.cornerStyle === 'sharp') return;
  const seed =
    site.meta?.brandName ||
    site.meta?.headline ||
    slug ||
    site.theme?.vibe ||
    site.meta?.subheadline ||
    'rounded';
  site.theme.cornerStyle = pickDeterministicCornerStyle(seed);
};

const ensureStyleProfile = ({ site, slug }) => {
  if (!site?.theme) return;
  const current = site.theme.styleProfile;
  const isValid = STYLE_PROFILE_IDS.includes(current);

  if (!isValid) {
    const vibeDefault = VIBE_STYLE_SUGGESTIONS[site.theme.vibe];
    const cornerDefault = site.theme.cornerStyle === 'sharp' ? 'sharp-minimal' : null;

    if (!vibeDefault && slug) {
      // Deterministically vary by slug so new sites don't all look the same.
      let hash = 0;
      for (let i = 0; i < slug.length; i += 1) hash = (hash + slug.charCodeAt(i)) % 1000000;
      site.theme.styleProfile = STYLE_PROFILE_IDS[hash % STYLE_PROFILE_IDS.length] || DEFAULT_STYLE_PROFILE;
    } else {
      site.theme.styleProfile = vibeDefault || cornerDefault || DEFAULT_STYLE_PROFILE;
    }
  }

  const profileMeta = STYLE_PROFILE_DEFAULTS[site.theme.styleProfile];
  if (profileMeta?.cornerStyle) {
    site.theme.cornerStyle = profileMeta.cornerStyle;
  }
};

const ensureThemeFonts = ({ site }) => {
  if (!site?.theme) return;
  if (!site.theme.displayFont) {
    site.theme.displayFont = site.theme.vibe === 'luxury' ? 'playfair-display' : 'space-grotesk';
  }
  if (!site.theme.bodyFont) {
    site.theme.bodyFont = site.theme.vibe === 'luxury' ? 'lora' : 'inter';
  }
};

const normalizeSiteSections = (site = {}) => {
  const normalizePrice = (value) => {
    if (typeof value !== 'string') return value;
    return value
      .replace(/[£€¥₽₩₹₫₱₦₴]/g, '$')
      .replace(/\b(USD?|CAD|AUD|EUR|GBP|JPY|CHF|CNY|HKD|SGD|NZD)\b/gi, '$')
      .replace(/^\s*\$/, '$')
      .trim();
  };

  const normalize = (sections = []) =>
    enforceSingleStatsBlock(
      sections.map((section) => {
        if (section.componentId === 'hero-with-image' && section.props?.stats) {
          return { ...section, props: { ...section.props, stats: [] } };
        }
        if (section.componentId === 'stats-showcase' && Array.isArray(section.props?.stats)) {
          return {
            ...section,
            props: {
              ...section.props,
              stats: section.props.stats.slice(0, 2),
            },
          };
        }
        if (section.componentId === 'features-grid' && Array.isArray(section.props?.features)) {
          return {
            ...section,
            props: {
              ...section.props,
              features: section.props.features.slice(0, 4),
            },
          };
        }
        if (section.componentId === 'pricing-table' && Array.isArray(section.props?.tiers)) {
          return {
            ...section,
            props: {
              ...section.props,
              currency: 'USD',
              tiers: section.props.tiers.map((tier) => ({
                ...tier,
                price: normalizePrice(tier.price),
              })),
            },
          };
        }
        return section;
      })
    );
  if (Array.isArray(site.sections)) {
    site.sections = elevateGallerySection(normalize(site.sections));
  }
  if (Array.isArray(site.pages)) {
    site.pages = site.pages.map((page) => ({
      ...page,
      sections: Array.isArray(page.sections)
        ? elevateGallerySection(normalize(page.sections))
        : page.sections,
    }));
  }
  const allowedVibes = new Set(['luxury', 'tech', 'playful', 'earthy']);
  if (site.theme) {
    if (!allowedVibes.has(site.theme.vibe)) {
      site.theme.vibe = 'tech';
    }
    if (site.theme.cornerStyle !== 'sharp' && site.theme.cornerStyle !== 'rounded') {
      site.theme.cornerStyle = 'rounded';
    }
    ensureStyleProfile({ site });
    ensureThemeFonts({ site });
  }
  if ((!site.sections || site.sections.length === 0) && Array.isArray(site.pages) && site.pages[0]?.sections) {
    site.sections = site.pages[0].sections;
  }
  return site;
};

const buildPublicUrlFromKey = ({ bucket, key }) => {
  const previewDomain = (process.env.PREVIEW_DOMAIN || '').replace(/\/+$/, '');
  const cleanedKey = key.replace(/^\/+/, '');
  if (previewDomain) {
    return `https://${previewDomain}/${cleanedKey}`;
  }
  return `https://${bucket}.s3.amazonaws.com/${cleanedKey}`;
};

const deriveTemplateSummary = (site = {}) => {
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

const ensureBaseBundleUploaded = async ({ bucket, prefix }) => {
  // No per-slug bundle uploads; rely on canonical bundle being present at BASE_BUNDLE_CANONICAL_PREFIX
  const s3 = s3Client;
  const canonicalPrefix = BASE_BUNDLE_CANONICAL_PREFIX ? `${BASE_BUNDLE_CANONICAL_PREFIX}/` : '';
  const canonicalIndex = `${canonicalPrefix}index.html`;

  const canonicalExists = async () => {
    try {
      await s3.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: canonicalIndex,
        })
      );
      return true;
    } catch (error) {
      if (
        (error.code && ['NotFound', 'NoSuchKey'].includes(error.code)) ||
        error?.$metadata?.httpStatusCode === 404
      ) {
        return false;
      }
      throw error;
    }
  };

  const uploadCanonical = async () => {
    if (!fs.existsSync(BASE_BUNDLE_DIR)) {
      throw new Error(`Base bundle not found locally at ${BASE_BUNDLE_DIR}. Build site-base first.`);
    }
    await uploadToS3(BASE_BUNDLE_DIR, { bucket, prefix: BASE_BUNDLE_CANONICAL_PREFIX });
  };

  const canonicalReady = await canonicalExists();
  if (!canonicalReady) {
    await uploadCanonical();
  }
  return true;
};

const deploySiteFromConfig = async ({
  slug,
  site,
  bucket,
  prefix,
  requestId,
  sourceUrl,
  description,
  onProgress,
  testMode = false,
}) => {
  if (!slug) throw new Error('slug is required');
  if (!bucket) throw new Error('bucket is required');
  if (!site) throw new Error('site config is required');

  const requestLabel = requestId || randomUUID();
  const { contentKey, templateKey } = buildJsonKeys({ prefix });
  const contentUrl = buildPublicUrlFromKey({ bucket, key: contentKey });
  const templateUrl = buildPublicUrlFromKey({ bucket, key: templateKey });

  onProgress?.('saving');
  console.log('[launch] Saving JSON payloads only (no build)', { requestId: requestLabel, slug, prefix });

  await saveSiteConfig({
    slug,
    site,
    metadata: {
      bucket,
      prefix,
      publicUrl: contentUrl,
      requestId: requestLabel,
      sourceUrl,
      description,
      lastBuildAt: new Date().toISOString(),
      testMode,
      templateId: site?.templateId || null,
    },
    storagePrefix: prefix,
  });

  await ensureBaseBundleUploaded({ bucket, prefix });

  const publicUrl = buildPublicUrlFromKey({
    bucket,
    key: prefix ? `${prefix.replace(/\/+$/, '')}/` : '',
  });

  return {
    slug,
    bucket,
    prefix,
    contentKey,
    templateKey,
    contentUrl,
    templateUrl,
    publicUrl,
    requestId: requestLabel,
    site,
    template: deriveTemplateSummary(site),
  };
};

const runLaunch = async ({
  url,
  description,
  businessDetails,
  requestId,
  onProgress,
  testMode = false,
  slug,
  prefix,
  bucket,
}) => {
  if (!url && !description) throw new Error('url or description is required');
  const resolvedBucket =
    bucket ||
    process.env.LOVABLE_DEPLOY_BUCKET ||
    process.env.DEPLOY_BUCKET ||
    process.env.TEMPLATE_UPLOAD_BUCKET;
  if (!resolvedBucket) throw new Error('bucket is required (set LOVABLE_DEPLOY_BUCKET or DEPLOY_BUCKET).');

  const PROGRESS_INTERVAL_MS = Number(process.env.SITE_LAUNCH_PROGRESS_INTERVAL_MS || 3000);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const publishProgress = async (partialSite, stage) => {
    try {
      onProgress?.(stage);
      // Keep deploy fast: JSON-only save + base bundle ensure.
      await deploySiteFromConfig({
        slug: finalSlugForPublish,
        site: partialSite,
        bucket: resolvedBucket,
        prefix: targetPrefixForPublish,
        requestId,
        sourceUrl: url,
        description,
        testMode,
      });
    } catch (error) {
      console.warn('[launch] Failed to publish progressive update (continuing)', {
        requestId,
        stage,
        err: error?.message,
      });
    }
  };

  onProgress?.('running');
  let siteConfig;
  const hasOpenAIKey = Boolean((process.env.OPENAI_API_KEY || '').trim());

  // NOTE: We need slug/prefix early so we can publish incremental content.json updates.
  const basePrefix =
    process.env.LOVABLE_DEPLOY_PREFIX ||
    process.env.DEPLOY_PREFIX ||
    process.env.PREVIEW_ROOT_PREFIX ||
    '';

  let finalSlugForPublish = slug;
  let targetPrefixForPublish = prefix || '';

  const desiredSlug = slug || buildSlugCandidate({ businessDetails, url, description, requestId });
  const { slug: ensuredSlug, prefixPath: resolvedPrefix } = await ensureUniqueSlug({
    bucket: resolvedBucket,
    basePrefix,
    slugCandidate: desiredSlug,
  });
  finalSlugForPublish = ensuredSlug;
  targetPrefixForPublish = resolvedPrefix;

  console.log('[launch] Using slug', { requestId, slug: finalSlugForPublish, prefix: targetPrefixForPublish });

  if (testMode) {
    console.log('[launch] Generating test site (LLM skipped)', { requestId, sourceUrl: url });
    siteConfig = buildTestSiteConfig({ url, description });
  } else if (!hasOpenAIKey) {
    // Safety net: if runner is misconfigured (no API key), don't leave users stuck.
    console.warn('[launch] OPENAI_API_KEY missing; falling back to deterministic site config', {
      requestId,
      slug: finalSlugForPublish,
      sourceUrl: url,
    });
    const fallback = buildTestSiteConfig({ url, description });
    fallback.meta = {
      ...fallback.meta,
      brandName:
        businessDetails?.businessName ||
        businessDetails?.businessType ||
        (finalSlugForPublish ? finalSlugForPublish.replace(/-/g, ' ') : fallback.meta.brandName),
      headline: businessDetails?.businessType || fallback.meta.headline,
      phone: businessDetails?.phone || fallback.meta.phone,
      location: businessDetails?.address || fallback.meta.location,
    };
    fallback.seo = {
      ...fallback.seo,
      title: fallback.meta.brandName,
      description: description || fallback.seo.description,
    };
    fallback.templateId = fallback.templateId || 'fallback-static';
    siteConfig = fallback;
  } else {
    // Progressive generation: publish a real baseline immediately, then evolve every ~3s.
    const baseline = buildTestSiteConfig({ url, description });
    baseline.meta = {
      ...baseline.meta,
      brandName:
        businessDetails?.businessName ||
        businessDetails?.businessType ||
        (finalSlugForPublish ? finalSlugForPublish.replace(/-/g, ' ') : baseline.meta.brandName),
      headline: businessDetails?.businessType || baseline.meta.headline,
      phone: businessDetails?.phone || baseline.meta.phone,
      location: businessDetails?.address || baseline.meta.location,
      email: businessDetails?.email || baseline.meta.email,
    };
    baseline.seo = {
      ...baseline.seo,
      title: baseline.meta.brandName,
      description: description || baseline.seo.description,
    };
    baseline.templateId = baseline.templateId || 'consulting-b2b';

    // Guardrails: cap total drafts (incl. baseline) to <= 10 (prefer <= 6).
    const maxDrafts = Math.min(
      Number.parseInt(process.env.SITE_LAUNCH_MAX_DRAFTS || '6', 10) || 6,
      10
    );

    // Normalize + repair + validate before first publish.
    siteConfig = normalizeSiteSections(baseline);
    ensureCornerStyle({ site: siteConfig, slug: finalSlugForPublish });
    ensureStyleProfile({ site: siteConfig, slug: finalSlugForPublish });
    const baselineCheck = validateAndRepairSite(siteConfig, {
      fallbackBrandName: baseline.meta.brandName,
    });
    siteConfig = baselineCheck.repaired;

    let lastKnownGood = siteConfig;
    if (baselineCheck.validation.valid) {
      lastKnownGood = baselineCheck.validation.site || siteConfig;
      siteConfig = lastKnownGood;
    } else {
      console.warn('[launch] Baseline failed validation (continuing with repaired baseline)', {
        requestId,
        errors: baselineCheck.validation.errors,
      });
    }

    await publishProgress(siteConfig, 'draft-1');

    // Build short, focused improvement steps. Each step should be small enough to land within ~3s.
    const steps = [
      {
        stage: 'draft-2',
        instructions:
          'Improve the hero section for conversion. Use the business name, location, and phone. Make the CTA compelling. Keep structure stable; only adjust copy and CTA props.',
      },
      {
        stage: 'draft-3',
        instructions:
          'Improve the services/features section copy: clearer benefits, fewer buzzwords, specific to the business. Keep layout; only refine text fields and feature descriptions.',
      },
      {
        stage: 'draft-4',
        instructions:
          'Add or refine testimonials/FAQ content if those sections exist. If missing, add one appropriate social proof section using existing componentIds already present in the site config.',
      },
      {
        stage: 'draft-5',
        instructions:
          'Polish SEO: title/description, add relevant keywords, ensure brand consistency. No layout changes.',
      },
      {
        stage: 'draft-6',
        instructions:
          'Final pass: check for missing CTA labels/hrefs, placeholder copy, and inconsistencies. Fix copy only; do not change layout.',
      },
    ].slice(0, Math.max(0, maxDrafts - 1));

    for (const step of steps) {
      const startedAt = Date.now();
      let candidate = siteConfig;

      try {
        const { patch } = await generateSitePatchWithOpenAI({
          site: siteConfig,
          instructions: step.instructions,
          assets: [],
        });
        if (patch) {
          candidate = applyJsonPatch(siteConfig, patch);
        }
      } catch (error) {
        console.warn('[launch] Progressive step failed (continuing)', {
          requestId,
          stage: step.stage,
          err: error?.message,
        });
      }

      // Always normalize/repair/validate before publishing.
      candidate = normalizeSiteSections(candidate);
      ensureCornerStyle({ site: candidate, slug: finalSlugForPublish });
      ensureStyleProfile({ site: candidate, slug: finalSlugForPublish });
      const check = validateAndRepairSite(candidate, {
        fallbackBrandName: baseline.meta.brandName,
      });

      if (check.validation.valid) {
        siteConfig = check.validation.site || check.repaired;
        lastKnownGood = siteConfig;
      } else {
        console.warn('[launch] Validation failed; reverting to last-known-good for publish', {
          requestId,
          stage: step.stage,
          errors: check.validation.errors,
        });
        siteConfig = lastKnownGood;
      }

      await publishProgress(siteConfig, step.stage);

      const elapsed = Date.now() - startedAt;
      const remaining = PROGRESS_INTERVAL_MS - elapsed;
      if (remaining > 0) {
        await sleep(remaining);
      }
    }

    // Final repair stage: ensure the published site is schema-valid + self-healed.
    const finalCheck = validateAndRepairSite(siteConfig, {
      fallbackBrandName: baseline.meta.brandName,
    });
    if (finalCheck.validation.valid) {
      siteConfig = finalCheck.validation.site || finalCheck.repaired;
      lastKnownGood = siteConfig;
    } else {
      console.warn('[launch] Final repair failed; publishing last-known-good', {
        requestId,
        errors: finalCheck.validation.errors,
      });
      siteConfig = lastKnownGood;
    }
    await publishProgress(siteConfig, 'draft-final-repair');

    // Optional final full-generation pass (disabled by default). This can be slow.
    const doFinal = String(process.env.SITE_LAUNCH_FINAL_PASS || '').toLowerCase() === 'true';
    if (doFinal) {
      const sourceSummary = await fetchSourceContext(url);
      console.log('[launch] Final pass: generating site with OpenAI', { requestId, sourceUrl: url });
      const result = await generateSiteWithOpenAI({
        sourceUrl: url,
        description,
        businessDetails,
        sourceSummary,
      });
      siteConfig = result.site;
      if (!siteConfig.templateId) {
        siteConfig.templateId = 'consulting-b2b';
      }
    }
  }

  const finalSlug = finalSlugForPublish;
  const targetPrefix = targetPrefixForPublish;

  console.log('[launch] Finalizing launch', { requestId, slug: finalSlug, prefix: targetPrefix });

  ensureCornerStyle({ site: siteConfig, slug: finalSlug });
  ensureStyleProfile({ site: siteConfig, slug: finalSlug });
  // Attach stock imagery from Pexels (if available) and normalize sections before saving
  siteConfig = await attachStockImages({
    site: siteConfig,
    slug: finalSlug,
    businessDetails,
    description,
  });
  siteConfig = normalizeSiteSections(siteConfig);

  return deploySiteFromConfig({
    slug: finalSlug,
    site: siteConfig,
    bucket: resolvedBucket,
    prefix: targetPrefix,
    requestId,
    sourceUrl: url,
    description,
    onProgress,
    testMode,
  });
};

module.exports = { runLaunch, loadDotEnvIfPresent, deploySiteFromConfig };
