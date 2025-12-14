const fs = require('node:fs');
const path = require('node:path');
const AWS = require('aws-sdk');
const { randomUUID } = require('node:crypto');
const fetch = global.fetch;
const { generateSiteWithOpenAI } = require('./openai');
const { refineThemePalette } = require('./color-agent');
const { saveSiteConfig } = require('./site-store');
const { uploadToS3 } = require('./deploy');
const { pickUnsplashImages } = require('./unsplash');
const crypto = require('node:crypto');

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
  const s3 = new AWS.S3();
  const sanitizedBase = slugCandidate && slugCandidate.length ? slugCandidate : 'site';
  let attempt = 0;

  const buildPrefixPath = (slugValue) => {
    if (!slugValue) return '';
    return basePrefix
      ? `${basePrefix.replace(/\/$/, '')}/${slugValue}`
      : slugValue;
  };

  while (attempt < 20) {
    const candidate = attempt === 0 ? sanitizedBase : `${sanitizedBase}-${attempt}`;
    const prefixPath = buildPrefixPath(candidate);
    const existing = await s3
      .listObjectsV2({
        Bucket: bucket,
        Prefix: `${prefixPath}/`,
        MaxKeys: 1,
      })
      .promise();
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

const buildGeneralImageQuery = ({ site = {}, businessDetails = {}, slug = '', description = '' }) => {
  const phrases = [];
  const push = (value) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      phrases.push(value.trim());
    }
  };

  push(businessDetails.businessType);
  push(businessDetails.additionalDetails);
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

const attachStockImages = async ({ site, slug, businessDetails, description }) => {
  if (!site || !slug) return site;
  const bucket =
    process.env.LOVABLE_DEPLOY_BUCKET ||
    process.env.DEPLOY_BUCKET ||
    process.env.TEMPLATE_UPLOAD_BUCKET;
  const s3 = bucket ? new AWS.S3() : null;

  const downloadAndCache = async (url) => {
    if (!s3 || !bucket || !url) return url;
    try {
      const extMatch = url.match(/\.(jpg|jpeg|png|webp)(\?.*)?$/i);
      const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
      const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 20);
      const key = `${BASE_BUNDLE_CANONICAL_PREFIX}/assets/stock/${hash}.${ext}`;

      try {
        await s3
          .headObject({
            Bucket: bucket,
            Key: key,
          })
          .promise();
        return `/assets/stock/${hash}.${ext}`;
      } catch (err) {
        if (err.code && !['NotFound', 'NoSuchKey'].includes(err.code)) throw err;
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

      await s3
        .putObject({
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        })
        .promise();

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

  const collectedPhotos = [];
  const seen = new Set();
  const addPhotos = (items = []) => {
    items.forEach((photo) => {
      if (!photo?.src) return;
      const key = photo.id || photo.src;
      if (key && seen.has(key)) return;
      if (key) seen.add(key);
      collectedPhotos.push(photo);
    });
  };

  let promptIndex = 0;
  for (const prompt of promptQueries.slice(0, 6)) {
    promptIndex += 1;
    const promptPhotos = await pickUnsplashImages({
      query: prompt,
      count: 4,
      seedValue: `${seed}-prompt-${promptIndex}`,
    });
    addPhotos(promptPhotos);
  }

  if (generalQuery) {
    const generalPhotos = await pickUnsplashImages({
      query: generalQuery,
      count: Math.min(Math.max(estimatedNeed * 2, 12), 24),
      seedValue: `${seed}-general`,
    });
    addPhotos(generalPhotos);
  }

  const photos = collectedPhotos.length ? collectedPhotos : [];
  const fallbackPool = [
    {
      id: 'outdoor-1',
      src: 'https://images.pexels.com/photos/953249/pexels-photo-953249.jpeg?auto=compress&cs=tinysrgb&w=1600',
      alt: 'Crew using chainsaw on a fallen tree trunk',
      photographer: 'Pexels',
      creditUrl: 'https://www.pexels.com/photo/person-cutting-tree-953249/',
    },
    {
      id: 'outdoor-2',
      src: 'https://images.pexels.com/photos/1782268/pexels-photo-1782268.jpeg?auto=compress&cs=tinysrgb&w=1600',
      alt: 'Worker grinding a stump in a backyard',
      photographer: 'Pexels',
      creditUrl: 'https://www.pexels.com/photo/person-using-stump-grinder-1782268/',
    },
    {
      id: 'outdoor-3',
      src: 'https://images.pexels.com/photos/953219/pexels-photo-953219.jpeg?auto=compress&cs=tinysrgb&w=1600',
      alt: 'Hands holding work gloves and small tool outdoors',
      photographer: 'Pexels',
      creditUrl: 'https://www.pexels.com/photo/person-holding-gray-gloves-953219/',
    },
    {
      id: 'outdoor-4',
      src: 'https://images.pexels.com/photos/442297/pexels-photo-442297.jpeg?auto=compress&cs=tinysrgb&w=1600',
      alt: 'Palm trees under a clear sky',
      photographer: 'Pexels',
      creditUrl: 'https://www.pexels.com/photo/green-palm-trees-under-blue-sky-442297/',
    },
    {
      id: 'outdoor-5',
      src: 'https://images.pexels.com/photos/629158/pexels-photo-629158.jpeg?auto=compress&cs=tinysrgb&w=1600',
      alt: 'Cut wood stacked on the ground',
      photographer: 'Pexels',
      creditUrl: 'https://www.pexels.com/photo/stack-of-firewoods-629158/',
    },
    {
      id: 'outdoor-6',
      src: 'https://images.pexels.com/photos/1301856/pexels-photo-1301856.jpeg?auto=compress&cs=tinysrgb&w=1600',
      alt: 'Sunlit path through greenery',
      photographer: 'Pexels',
      creditUrl: 'https://www.pexels.com/photo/landscape-photo-of-pathway-surrounded-by-green-leaf-trees-1301856/',
    },
  ];

  const pool = photos.length ? photos : fallbackPool;

  const nextPhoto = (() => {
    let idx = 0;
    return () => {
      const photo = pool[idx % pool.length];
      idx += 1;
      return photo;
    };
  })();

  const maybeAttach = (section) => {
    if (!section?.props) return section;
    const needsImage =
      section.componentId === 'hero-with-image' ||
      section.componentId === 'cta-banner' ||
      section.componentId === 'process-timeline';
    if ((needsImage || section.props.imagePrompt) && !section.props.image?.src) {
      const photo = nextPhoto();
      section.props.image = {
        src: photo.src,
        alt: photo.alt,
        credit: photo.photographer,
        creditUrl: photo.creditUrl,
      };
    }
    if (section.componentId === 'gallery-carousel' && Array.isArray(section.props.items)) {
      section.props.items = section.props.items.map((item) => {
        if (item?.image?.src) return item;
        const photo = nextPhoto();
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
    return section;
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
      const updated = maybeAttach({ ...section });
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
            const updated = maybeAttach({ ...section });
            if (updated.props?.image?.src) imagesAssigned += 1;
            return updated;
          })
        : page.sections,
    }));
  }

    if (!hasGallery && pool.length) {
      const galleryItems = pool.slice(0, 4).map((photo, idx) => ({
        title: `Snapshot ${idx + 1}`,
        description: 'Recent work and client moments.',
        badge: 'Highlights',
      image: {
        src: photo.src,
        alt: photo.alt,
        credit: photo.photographer,
        creditUrl: photo.creditUrl,
      },
    }));
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
  }

  // Ensure at least 3 images are sprinkled across sections by attaching to eligible sections lacking imagery.
  const MIN_IMAGES = 4;
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
    const photo = nextPhoto();
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
    site.sections = normalize(site.sections);
  }
  if (Array.isArray(site.pages)) {
    site.pages = site.pages.map((page) => ({
      ...page,
      sections: Array.isArray(page.sections) ? normalize(page.sections) : page.sections,
    }));
  }
  const allowedVibes = new Set(['luxury', 'tech', 'playful', 'earthy']);
  if (site.theme) {
    if (!allowedVibes.has(site.theme.vibe)) {
      site.theme.vibe = 'tech';
    }
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
  const s3 = new AWS.S3();
  const canonicalPrefix = BASE_BUNDLE_CANONICAL_PREFIX ? `${BASE_BUNDLE_CANONICAL_PREFIX}/` : '';
  const canonicalIndex = `${canonicalPrefix}index.html`;

  const canonicalExists = async () => {
    try {
      await s3
        .headObject({
          Bucket: bucket,
          Key: canonicalIndex,
        })
        .promise();
      return true;
    } catch (error) {
      if (error.code && ['NotFound', 'NoSuchKey'].includes(error.code)) return false;
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

  onProgress?.('running');
  let siteConfig;
  if (testMode) {
    console.log('[launch] Generating test site (Gemini skipped)', { requestId, sourceUrl: url });
    siteConfig = buildTestSiteConfig({ url, description });
  } else {
    const sourceSummary = await fetchSourceContext(url);
    if (!sourceSummary) {
      console.warn('[launch] No source summary extracted', { requestId, sourceUrl: url });
    }
    console.log('[launch] Generating site with OpenAI', { requestId, sourceUrl: url });
    const result = await generateSiteWithOpenAI({
      sourceUrl: url,
      description,
      businessDetails,
      sourceSummary,
    });
    // Skip async palette refinement to keep launch latency low; use generated theme directly.
    siteConfig = result.site;
    if (!siteConfig.templateId) {
      siteConfig.templateId = 'consulting-b2b';
    }
    console.log('[launch] Gemini generation complete', {
      requestId,
      sectionCount: siteConfig.sections?.length || 0,
    });
  }

  const basePrefix =
    process.env.LOVABLE_DEPLOY_PREFIX ||
    process.env.DEPLOY_PREFIX ||
    process.env.PREVIEW_ROOT_PREFIX ||
    '';

  let finalSlug = slug;
  let targetPrefix = prefix || '';

  const desiredSlug = slug || buildSlugCandidate({ businessDetails, url, description, requestId });
  const { slug: ensuredSlug, prefixPath: resolvedPrefix } = await ensureUniqueSlug({
    bucket: resolvedBucket,
    basePrefix,
    slugCandidate: desiredSlug,
  });
  finalSlug = ensuredSlug;
  targetPrefix = resolvedPrefix;

  console.log('[launch] Using slug', { requestId, slug: finalSlug, prefix: targetPrefix });

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
