const fetch = global.fetch;
const fs = require('node:fs');
const path = require('node:path');
const { validateSiteQuality } = require('./site-schema');
const { SECTION_MANIFEST, SECTION_IDS } = require('./sections/registry');

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-5.1';
const OPENAI_URL = 'https://api.openai.com/v1/responses';

const TEMPLATE_INDEX_PATH = path.join(__dirname, '..', 'templates', 'template-library.json');
const TEMPLATE_LIBRARY_DIR = path.join(__dirname, '..', 'templates', 'library');

const readJsonIfExists = (filePath) => {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const buildTemplateInventory = (limit = 40) => {
  const index = readJsonIfExists(TEMPLATE_INDEX_PATH);
  const entries = Array.isArray(index?.templatesIndex) ? index.templatesIndex.slice(0, limit) : [];
  return entries
    .map((entry) => {
      const specPath = path.join(TEMPLATE_LIBRARY_DIR, `${entry.id}.json`);
      const spec = readJsonIfExists(specPath);
      const sectionList = (spec?.sections || []).map((s) => s.componentId).filter(Boolean);
      return `- ${entry.id} (${entry.name}; ${entry.vertical || ''}${entry.subcategory ? `/${entry.subcategory}` : ''}) sections: ${sectionList.join(
        ', '
      )}; tags: ${(entry.tags || []).join(', ')}; useCases: ${(entry.useCases || []).join(', ')}`;
    })
    .join('\n');
};

const buildSectionsInventory = () =>
  SECTION_MANIFEST.map((section) => {
    const required = section.requiredProps?.length ? `Required props: ${section.requiredProps.join(', ')}.` : '';
    return `- ${section.id}: ${section.description} ${required}`.trim();
  }).join('\n');

const buildPrompt = ({ sourceUrl, description, businessDetails, sourceSummary }) => {
  const details = [];
  if (businessDetails?.businessName) details.push(`Business name: ${businessDetails.businessName}`);
  if (businessDetails?.businessType) details.push(`Business type: ${businessDetails.businessType}`);
  if (businessDetails?.address) details.push(`Address: ${businessDetails.address}`);
  if (businessDetails?.phone) details.push(`Phone: ${businessDetails.phone}`);
  if (businessDetails?.additionalDetails) details.push(`Notes: ${businessDetails.additionalDetails}`);

  const templateInventory = buildTemplateInventory();

  return [
    'You are a senior marketing copywriter rebuilding the referenced business website. Return ONLY JSON (no Markdown) describing a premium marketing site layout for our Vite + shadcn template.',
    'Do NOT mention AI SiteMaker/Lovable or any AI generator. All copy must stay grounded in the reference business and the provided businessDetails.',
    'Default to bright, friendly, high-contrast palettes; only deliver a dark theme when explicitly requested.',
    'When cloning an existing site, lightly remix the copy instead of inventing new messaging—preserve the offers, voice, and structure from the reference text.',
    'Reuse strong hero/services language from the source; avoid generic AI boilerplate.',
    'If the reference spans multiple pages or the user asks, emit up to 5 pages (path/title/sections). Otherwise, use a single-page sections array.',
    'Set meta.brandName/headline/subheadline to the real business (prefer businessDetails.businessName; otherwise derive from the reference site text or the URL domain words).',
    'The JSON must follow the Site schema (meta, seo, theme, sections[] or pages[]) and every section entry must include a props object with all copy, CTAs, lists, and imagePrompt text needed to render that block.',
    'Template library (choose the closest fit and set site.templateId accordingly, follow its section order, and extend with additional sections to reach a full-length site):',
    templateInventory,
    'Available sections and their behaviors:',
    buildSectionsInventory(),
    '',
    'Rules:',
    '- Choose a templateId from the library above, set site.templateId to it, and follow its section order. If it has fewer than 12 sections, add CTA/FAQ/stats/testimonials/gallery/contact to reach a full-length page.',
    '- Always include a CTA banner (`cta-banner`) near the end in addition to the contact form.',
    '- Assume a US audience: use US spellings, US phone/address formatting, and price everything in USD with the $ symbol (no other currencies).',
    '- Match the templateId to the business type inferred from sourceSummary and businessDetails (e.g., plumber/roofer/home-services, blue-collar trades, photographers/artists, ecommerce/online store, personal brand/portfolio, hospitality/restaurant, SaaS).',
    '- For trades/blue-collar/home-services/photography/personal brand/ecommerce templates, avoid B2B SaaS tone/structure; make the layout and copy feel like that industry (service areas, offers, packages, galleries/portfolios, trust, hours, location).',
    '- Include 8–10 rich sections covering hero, services/features, process, testimonials/social proof, FAQ, pricing or CTA, stats/proof, gallery/media, and contact. Add more only when the source text is long.',
    '- Limit stats/proof/outcome metrics to 3 items per stats section unless the user explicitly asks for more. Prefer a single stats block by default.',
    '- Each section needs depth: hero/services >=80–90 words; other sections >=70–80 words; use vivid, business-specific `imagePrompt` guidance where visuals matter.',
    '- meta.brandName/headline/subheadline must reflect the real business (use businessDetails.businessName if provided; otherwise derive from sourceSummary/URL) and the brand name must appear in the on-page copy.',
    '- Copy must be grounded in the provided source site text or businessDetails—use the real services/products, locations, offers, and differentiators. Include local/service-area cues for trades and hospitality; include products/offers for ecommerce; include portfolio language for photographers/artists/personal brands.',
    '- Always generate SEO fields: write seo.title/seo.description from the source text and add 5+ specific seo.keywords; if the user provided overrides in the instructions, honor those overrides.',
    '- Copy must be rewritten from the reference site text (sourceSummary) and business details; no placeholders or AI-SiteMaker messaging.',
    '- Treat the sourceSummary as truth: mirror its offerings, tone, locations, and differentiators. If sourceSummary is empty, infer the business from the URL words and businessDetails rather than inventing an AI platform.',
    '- Theme colors must reflect the real brand or industry palette—avoid default dark purple schemes; pick high-conversion, legible colors that match the reference site vibe.',
    '- Absolute rule: every foreground color (text, buttons, links) must meet WCAG AA contrast against its background. If the background is light, use dark text (#0f172a–#1f2937); if the background is dark, use light text (#f8fafc–#e2e8f0). Never white text on white or light gray. Add visible hover/focus states (underline or darker background) for links/buttons. After picking colors, self-check contrast for hero/body/buttons/links and adjust the palette until AA is met before returning JSON.',
    '- Include a gallery-carousel when imagery is important and a contact-form with relevant fields; set contactEmail when given so the form can mailto the business.',
    '- Add SEO/perf details: canonical URL, redirects if applicable, OG/social preview (title/description/imagePrompt), and schemaMarkup (JSON-LD string) when the business type is clear.',
    '- Add integrations when requested: analytics pixels (GA/Meta), chat widget slot, and newsletter signup settings.',
    '- Keywords array in seo must contain 5+ phrases.',
    '- Respond with compact JSON only; no commentary.',
    sourceUrl ? `Reference site to outperform: ${sourceUrl}` : '',
    sourceSummary ? `Reference site text (truncated): ${sourceSummary}` : '',
    description ? `Additional instructions: ${description}` : '',
    details.length ? `Business context:\n- ${details.join('\n- ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
};

const buildTextFormat = () => ({
  type: 'json_schema',
  name: 'site_plan',
  strict: false,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['meta', 'seo', 'theme', 'templateId'],
    properties: {
      meta: {
            type: 'object',
            additionalProperties: false,
            required: ['brandName', 'headline', 'subheadline'],
            properties: {
              brandName: { type: 'string', minLength: 2 },
          headline: { type: 'string', minLength: 10 },
          subheadline: { type: 'string', minLength: 10 },
        },
      },
      seo: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'description', 'keywords'],
        properties: {
          title: { type: 'string', minLength: 10 },
          description: { type: 'string', minLength: 20 },
          keywords: {
            type: 'array',
            minItems: 5,
            items: { type: 'string', minLength: 2 },
          },
        },
      },
      theme: {
        type: 'object',
        additionalProperties: false,
        required: ['primaryColor', 'accentColor', 'backgroundStyle', 'vibe'],
        properties: {
          primaryColor: { type: 'string', minLength: 4 },
          accentColor: { type: 'string', minLength: 4 },
          backgroundStyle: { type: 'string', enum: ['gradient', 'mesh', 'texture'] },
          vibe: { type: 'string', enum: ['luxury', 'tech', 'playful', 'earthy'] },
        },
      },
      templateId: { type: 'string' },
      canonical: { type: 'string' },
      redirects: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            type: { type: 'number', enum: [301, 302] },
          },
        },
      },
      openGraph: {
        type: 'object',
        additionalProperties: true,
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          imagePrompt: { type: 'string' },
        },
      },
      schemaMarkup: { type: 'string' },
      integrations: {
        type: 'object',
        additionalProperties: true,
        properties: {
          analytics: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                type: { type: 'string', enum: ['ga', 'meta', 'gtm', 'other'] },
                id: { type: 'string' },
              },
            },
          },
          chat: {
            type: 'object',
            additionalProperties: true,
            properties: {
              provider: { type: 'string' },
              key: { type: 'string' },
            },
          },
          newsletter: {
            type: 'object',
            additionalProperties: true,
            properties: {
              provider: { type: 'string' },
              listId: { type: 'string' },
              formAction: { type: 'string' },
            },
          },
        },
      },
      sections: {
        type: 'array',
        minItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'componentId', 'props'],
          properties: {
            id: { type: 'string', minLength: 2 },
            componentId: { type: 'string', enum: SECTION_IDS },
            props: {
              type: 'object',
              description:
                'All copy, CTAs, and prompts needed for this component. Include imagePrompt text where visuals are expected.',
              additionalProperties: true,
            },
          },
        },
      },
      pages: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'title', 'sections'],
          properties: {
            path: { type: 'string', minLength: 1 },
            title: { type: 'string', minLength: 2 },
            sections: {
              type: 'array',
              minItems: 4,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'componentId', 'props'],
                properties: {
                  id: { type: 'string', minLength: 2 },
                  componentId: { type: 'string', enum: SECTION_IDS },
                  props: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
        },
      },
    },
  },
});

const extractOutputText = (responseJson) => {
  const content = responseJson?.output?.[0]?.content;
  if (Array.isArray(content)) {
    const textChunk = content.find((chunk) => chunk.type === 'output_text');
    if (textChunk?.text) return textChunk.text;
  }
  if (Array.isArray(responseJson?.content)) {
    const textChunk = responseJson.content.find((chunk) => chunk.type === 'output_text');
    if (textChunk?.text) return textChunk.text;
  }
  return '';
};

const buildPatchFormat = () => ({
  type: 'json_schema',
  name: 'site_edit_patch',
  strict: false,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['patch'],
    properties: {
      summary: {
        type: 'string',
        description: 'One paragraph recap of what changed and why.',
      },
      patch: {
        type: 'object',
        additionalProperties: false,
        properties: {
          meta: { type: 'object', additionalProperties: true },
          seo: { type: 'object', additionalProperties: true },
          theme: { type: 'object', additionalProperties: true },
          sections: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                componentId: { type: 'string', enum: SECTION_IDS },
                action: { type: 'string', enum: ['update', 'insert', 'remove'], default: 'update' },
                props: { type: 'object', additionalProperties: true },
                position: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    beforeId: { type: 'string' },
                    afterId: { type: 'string' },
                    index: { type: 'integer', minimum: 0 },
                  },
                },
              },
            },
            minItems: 1,
          },
        },
      },
    },
  },
});

const formatAssetsForPrompt = (assets = []) => {
  if (!assets.length) return '';
  const lines = assets
    .slice(0, 20)
    .map((asset, index) => {
      const label = asset.name || asset.filename || `asset-${index + 1}`;
      const url = asset.url || asset.assetUrl || asset.href || asset.key || '';
      const note = asset.description || asset.alt || '';
      return `- ${label}${url ? ` (${url})` : ''}${note ? ` — ${note}` : ''}`;
    })
    .join('\n');
  return `Assets available:\n${lines}`;
};

const buildEditPrompt = ({ siteJson, instructions, assets }) =>
  [
    'You are the creative director + product manager for AI-SiteMaker.',
    'A human described edits they want on the existing site.',
    'Return compact JSON describing a SitePatch we can apply. Only touch sections relevant to the request; keep prior copy when not mentioned.',
    'Use insert/remove/update actions for sections, keep CTAs concrete, and remember tone/voice expectations from the current page.',
    assets?.length ? formatAssetsForPrompt(assets) : '',
    '',
    'Existing site JSON:',
    siteJson,
    '',
    'Requested changes:',
    instructions,
  ]
    .filter(Boolean)
    .join('\n');

const generateSiteWithOpenAI = async ({ sourceUrl, description, businessDetails, sourceSummary }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required');

  const prompt = buildPrompt({ sourceUrl, description, businessDetails, sourceSummary });
  const body = {
    model: DEFAULT_MODEL,
    temperature: 0.4,
    input: [
      {
        role: 'system',
        content:
          'You produce elite marketing site layouts. Output must be valid JSON matching the provided schema and include props for every section.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    text: {
      format: buildTextFormat(),
    },
  };

  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const json = await response.json();
  if (!response.ok) {
    const error = new Error(`OpenAI request failed: ${response.status} ${response.statusText}`);
    error.body = json;
    throw error;
  }

  const text = extractOutputText(json);
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const err = new Error('OpenAI response was not valid JSON');
    err.body = text;
    throw err;
  }

  const validation = validateSiteQuality(parsed);
  if (!validation.valid || !validation.site) {
    const err = new Error(`Site JSON failed validation: ${JSON.stringify(validation.errors || [], null, 2)}`);
    err.body = text;
    throw err;
  }

  return { site: validation.site, rawText: text };
};

const generateSitePatchWithOpenAI = async ({ site, instructions, assets }) => {
  if (!instructions || !instructions.trim()) {
    throw new Error('instructions are required');
  }
  if (!site) throw new Error('site is required');
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required');

  const siteJson = JSON.stringify(site, null, 2);
  const prompt = buildEditPrompt({ siteJson, instructions, assets });
  const body = {
    model: DEFAULT_MODEL,
    temperature: 0.3,
    input: [
      {
        role: 'system',
        content:
          'Translate high-level marketing site edit requests into precise JSON patches. Preserve existing structure unless explicitly told to change it. Tone: polished agency copywriter.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    text: {
      format: buildPatchFormat(),
    },
  };

  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) {
    const error = new Error(`OpenAI edit request failed: ${response.status} ${response.statusText}`);
    error.body = json;
    throw error;
  }
  const text = extractOutputText(json);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const err = new Error('OpenAI edit response was not valid JSON');
    err.body = text;
    throw err;
  }
  if (!parsed?.patch) {
    throw new Error('OpenAI edit response missing patch property');
  }
  return {
    patch: parsed.patch,
    summary: parsed.summary,
    rawText: text,
  };
};

module.exports = { generateSiteWithOpenAI, generateSitePatchWithOpenAI };
