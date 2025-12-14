const fs = require('node:fs');
const path = require('node:path');
const AWS = require('aws-sdk');
const { randomUUID } = require('node:crypto');
const fetch = global.fetch;
const { generateSiteWithOpenAI } = require('./openai');
const { refineThemePalette } = require('./color-agent');
const { saveSiteConfig } = require('./site-store');
const { uploadToS3 } = require('./deploy');
const { pickPexelsImages } = require('./pexels');

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

const attachPexelsImages = async ({ site, slug }) => {
  if (!site || !slug) return site;
  const seed = `${slug}-${site.meta?.brandName || site.meta?.headline || ''}`;
  const query =
    site.meta?.brandName ||
    site.meta?.headline ||
    site.meta?.subheadline ||
    site.seo?.title ||
    slug;

  const photos = await pickPexelsImages({ query, count: 10, seedValue: seed });
  const fallbackPool = [
    {
      id: 'work-1',
      src: 'https://images.pexels.com/photos/3184292/pexels-photo-3184292.jpeg?auto=compress&cs=tinysrgb&w=1600',
      alt: 'Conversation with clients',
      photographer: 'Pexels',
      creditUrl: 'https://www.pexels.com/photo/man-and-woman-having-a-conversation-3184292/',
    },
    {
      id: 'work-2',
      src: 'https://images.pexels.com/photos/1181406/pexels-photo-1181406.jpeg?auto=compress&cs=tinysrgb&w=1600',
      alt: 'Team collaborating with laptop',
      photographer: 'Pexels',
      creditUrl: 'https://www.pexels.com/photo/two-women-sitting-on-sofa-while-looking-at-macbook-1181406/',
    },
    {
      id: 'work-3',
      src: 'https://images.pexels.com/photos/3182774/pexels-photo-3182774.jpeg?auto=compress&cs=tinysrgb&w=1600',
      alt: 'Advisor with notebook and coffee',
      photographer: 'Pexels',
      creditUrl: 'https://www.pexels.com/photo/person-holding-white-ceramic-teacup-saucer-on-brown-wooden-table-3182774/',
    },
    {
      id: 'work-4',
      src: 'https://images.pexels.com/photos/3771097/pexels-photo-3771097.jpeg?auto=compress&cs=tinysrgb&w=1600',
      alt: 'Hands with tablet and charts',
      photographer: 'Pexels',
      creditUrl: 'https://www.pexels.com/photo/crop-people-using-digital-tablet-at-table-3771097/',
    },
    {
      id: 'work-5',
      src: 'https://images.pexels.com/photos/936137/pexels-photo-936137.jpeg?auto=compress&cs=tinysrgb&w=1600',
      alt: 'Notebook, glasses, and laptop on desk',
      photographer: 'Pexels',
      creditUrl: 'https://www.pexels.com/photo/turned-off-macbook-pro-beside-iphone-936137/',
    },
    {
      id: 'work-6',
      src: 'https://images.pexels.com/photos/3184465/pexels-photo-3184465.jpeg?auto=compress&cs=tinysrgb&w=1600',
      alt: 'Group discussion in office',
      photographer: 'Pexels',
      creditUrl: 'https://www.pexels.com/photo/colleagues-talking-at-table-3184465/',
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
  if (!fs.existsSync(BASE_BUNDLE_DIR)) {
    throw new Error(`Base bundle not found at ${BASE_BUNDLE_DIR}. Run the build or set BASE_BUNDLE_DIR.`);
  }
  const s3 = new AWS.S3();
  const normalizedPrefix = prefix ? `${prefix.replace(/\/+$/, '')}/` : '';
  const indexKey = `${normalizedPrefix}index.html`;
  const canonicalPrefix = BASE_BUNDLE_CANONICAL_PREFIX ? `${BASE_BUNDLE_CANONICAL_PREFIX}/` : '';
  const canonicalIndex = `${canonicalPrefix}index.html`;

  const listBundleFiles = () => {
    const files = [];
    const walk = (dir, base = '') => {
      fs.readdirSync(dir).forEach((entry) => {
        const full = path.join(dir, entry);
        const rel = base ? `${base}/${entry}` : entry;
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          walk(full, rel);
        } else {
          files.push(rel);
        }
      });
    };
    walk(BASE_BUNDLE_DIR, '');
    return files;
  };

  const copyBundleFromCanonical = async () => {
    const files = listBundleFiles();
    await Promise.all(
      files.map((file) =>
        s3
          .copyObject({
            Bucket: bucket,
            CopySource: `/${bucket}/${canonicalPrefix}${file}`,
            Key: `${normalizedPrefix}${file}`,
            MetadataDirective: 'COPY',
          })
          .promise()
      )
    );
  };

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

  const uploadCanonical = async () => uploadToS3(BASE_BUNDLE_DIR, { bucket, prefix: canonicalPrefix });

  try {
    await s3
      .headObject({
        Bucket: bucket,
        Key: indexKey,
      })
      .promise();
    return false;
  } catch (error) {
    if (error.code && !['NotFound', 'NoSuchKey'].includes(error.code)) {
      throw error;
    }
  }

  if (!(await canonicalExists())) {
    await uploadCanonical();
  }
  await copyBundleFromCanonical();
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
    siteConfig =
      (await refineThemePalette({
        site: result.site,
        sourceUrl: url,
        sourceSummary,
        description,
        businessDetails,
      })) || result.site;
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
  siteConfig = await attachPexelsImages({ site: siteConfig, slug: finalSlug });
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
