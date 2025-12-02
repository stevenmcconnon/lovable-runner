const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const AWS = require('aws-sdk');
const { randomUUID } = require('node:crypto');
const { generateSiteWithOpenAI } = require('./openai');
const { uploadToS3, buildProject } = require('./deploy');
const { exportProjectToGit } = require('./git-archive');
const { copyTemplateTo, writeSiteJson } = require('./site-template');
const { enhanceSiteWithImages } = require('./image-generator');
const { saveSiteConfig } = require('./site-store');
const { uploadGeneratedAssets, hydrateExistingGeneratedAssets } = require('./generated-assets');

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

const buildTempDir = (...parts) => path.join(os.tmpdir(), ...parts, randomUUID());

const createProjectFromTemplate = async ({ slug, requestSuffix }) => {
  const outputDir = buildTempDir('site', slug, requestSuffix);
  await copyTemplateTo(outputDir);
  return outputDir;
};

const buildSlugCandidate = ({ businessDetails, url, description, requestId }) => {
  if (businessDetails?.businessName) return slugify(businessDetails.businessName);
  if (url) return slugify(url);
  if (description) return slugify(description.slice(0, 50));
  if (requestId) return slugify(requestId);
  return slugify(`site-${Date.now()}`);
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

const clearS3Prefix = async ({ bucket, prefix }) => {
  if (!prefix) return;
  const normalizedPrefix = prefix.replace(/\/+$/, '');
  const s3 = new AWS.S3();
  let continuationToken = undefined;
  do {
    const listed = await s3
      .listObjectsV2({
        Bucket: bucket,
        Prefix: `${normalizedPrefix}/`,
        ContinuationToken: continuationToken,
      })
      .promise();
    if (listed.Contents?.length) {
      await s3
        .deleteObjects({
          Bucket: bucket,
          Delete: { Objects: listed.Contents.map((item) => ({ Key: item.Key })) },
        })
        .promise();
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
};

const buildPublicUrl = ({ bucket, prefix }) => {
  const normalizedPrefix = prefix ? `${prefix.replace(/\/+$/, '')}/` : '';
  const previewDomain = (process.env.PREVIEW_DOMAIN || '').trim().replace(/\/+$/, '');
  if (previewDomain) return `https://${previewDomain}/${normalizedPrefix}`;
  return `https://${bucket}.s3.amazonaws.com/${normalizedPrefix}`;
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
  generateImages = true,
  testMode = false,
}) => {
  if (!slug) throw new Error('slug is required');
  if (!bucket) throw new Error('bucket is required');
  if (!site) throw new Error('site config is required');

  const requestLabel = requestId || randomUUID();
  const requestSuffix = requestLabel.slice(0, 8);

  console.log('[launch] Site template preparation starting', { requestId: requestLabel, slug, prefix });
  const outputDir = await createProjectFromTemplate({
    slug,
    requestSuffix,
  });
  console.log('[launch] Site template prepared', { requestId: requestLabel, outputDir });

  if (!generateImages) {
    await hydrateExistingGeneratedAssets({
      site,
      bucket,
      prefix,
      projectDir: outputDir,
    }).catch((error) => {
      console.warn('[launch] Failed to hydrate existing generated assets', {
        err: error?.message,
      });
    });
  }

  let workingSite = site;
  let generatedAssets = [];
  if (generateImages) {
    try {
      const result = await enhanceSiteWithImages({
        site,
        projectDir: outputDir,
        slug,
        requestId: requestLabel,
      });
      workingSite = result.site;
      generatedAssets = result.assets || [];
    } catch (error) {
      console.warn('[launch] Failed to generate AI imagery', { err: error?.message, requestId: requestLabel });
      workingSite = site;
    }
  } else {
    console.log('[launch] Skipping AI imagery generation', { requestId: requestLabel, slug, testMode });
  }
  await writeSiteJson(outputDir, workingSite);

  const gitArchive = await exportProjectToGit({
    projectDir: outputDir,
    slug,
    requestId: requestLabel,
    sourceUrl,
    description,
  });
  if (gitArchive) {
    console.log('[launch] Exported project to git', gitArchive);
  }

  onProgress?.('building');
  console.log('[launch] Installing and building site project', { requestId: requestLabel, outputDir });
  const distPath = await buildProject(outputDir);
  console.log('[launch] Build complete', { requestId: requestLabel, distPath });

  onProgress?.('deploying');
  console.log('[launch] Clearing existing preview prefix', {
    requestId: requestLabel,
    bucket,
    prefix,
  });
  await clearS3Prefix({ bucket, prefix }).catch((error) => {
    console.warn('[launch] Failed to clear prefix (continuing)', {
      err: error?.message,
      prefix,
    });
  });

  console.log('[launch] Uploading to S3', {
    requestId: requestLabel,
    bucket,
    prefix,
  });
  const target = await uploadToS3(distPath, { bucket, prefix });
  console.log('[launch] Upload complete', { requestId: requestLabel, target });

  await uploadGeneratedAssets({
    site: workingSite,
    projectDir: outputDir,
    bucket,
    prefix,
    assets: generatedAssets,
  }).catch((error) => {
    console.warn('[launch] Failed to upload generated assets (continuing)', {
      err: error?.message,
    });
  });

  const publicUrl = buildPublicUrl({ bucket, prefix });

  await saveSiteConfig({
    slug,
    site: workingSite,
    metadata: {
      bucket,
      prefix,
      publicUrl,
      requestId: requestLabel,
      sourceUrl,
      description,
      lastBuildAt: new Date().toISOString(),
      testMode,
    },
  });

  return {
    slug,
    bucket,
    prefix,
    outputDir,
    hostingDir: distPath,
    builtFromProject: true,
    target,
    publicUrl,
    gitArchive,
    requestId: requestLabel,
    site: workingSite,
  };
};

const runLaunch = async ({
  url,
  description,
  businessDetails,
  requestId,
  onProgress,
  testMode = false,
}) => {
  if (!url && !description) throw new Error('url or description is required');
  const resolvedBucket =
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
    console.log('[launch] Generating site with OpenAI', { requestId, sourceUrl: url });
    const result = await generateSiteWithOpenAI({
      sourceUrl: url,
      description,
      businessDetails,
    });
    siteConfig = result.site;
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
  const desiredSlug = buildSlugCandidate({ businessDetails, url, description, requestId });
  const { slug: finalSlug, prefixPath: resolvedPrefix } = await ensureUniqueSlug({
    bucket: resolvedBucket,
    basePrefix,
    slugCandidate: desiredSlug,
  });
  const targetPrefix = resolvedPrefix;

  console.log('[launch] Using slug', { requestId, slug: finalSlug, prefix: resolvedPrefix });

  return deploySiteFromConfig({
    slug: finalSlug,
    site: siteConfig,
    bucket: resolvedBucket,
    prefix: targetPrefix,
    requestId,
    sourceUrl: url,
    description,
    onProgress,
    generateImages: !testMode,
    testMode,
  });
};

module.exports = { runLaunch, loadDotEnvIfPresent, deploySiteFromConfig };
