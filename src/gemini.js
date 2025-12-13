const DEFAULT_MODEL =
  process.env.GEMINI_MODEL ||
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent';

const { validateSiteQuality } = require('./site-schema');
const { SECTION_MANIFEST, SECTION_IDS } = require('./sections/registry');

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    meta: {
      type: 'object',
      properties: {
        brandName: { type: 'string' },
        headline: { type: 'string' },
        subheadline: { type: 'string' },
        location: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
      },
      required: ['brandName', 'headline', 'subheadline'],
    },
    seo: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        keywords: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'description', 'keywords'],
    },
    theme: {
      type: 'object',
      properties: {
        primaryColor: { type: 'string' },
        accentColor: { type: 'string' },
        backgroundStyle: { type: 'string', enum: ['gradient', 'mesh', 'texture'] },
        vibe: { type: 'string', enum: ['luxury', 'tech', 'playful', 'earthy'] },
      },
      required: ['primaryColor', 'accentColor', 'backgroundStyle', 'vibe'],
    },
    sections: {
      type: 'array',
      minItems: 6,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          componentId: { type: 'string', enum: SECTION_IDS },
        },
        required: ['id', 'componentId'],
      },
    },
  },
  required: ['meta', 'seo', 'theme', 'sections'],
};

const extractJson = (text) => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    /* fallthrough */
  }
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (match?.[1]) {
    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  }
  return null;
};

const pickFirstCandidate = (response) => {
  const candidate = response?.candidates?.[0];
  const part = candidate?.content?.parts?.find((p) => typeof p.text === 'string');
  return part?.text || null;
};

const buildSectionsInventory = () =>
  SECTION_MANIFEST.map((section) => {
    const props = section.requiredProps?.length ? `Required props: ${section.requiredProps.join(', ')}.` : '';
    return `- ${section.id}: ${section.description} ${props}`.trim();
  }).join('\n');

const buildPrompt = ({ sourceUrl, description, businessDetails, sourceSummary }) => {
  const details = [];
  if (businessDetails?.businessName) details.push(`Business name: ${businessDetails.businessName}`);
  if (businessDetails?.businessType) details.push(`Business type: ${businessDetails.businessType}`);
  if (businessDetails?.address) details.push(`Address: ${businessDetails.address}`);
  if (businessDetails?.phone) details.push(`Phone: ${businessDetails.phone}`);
  if (businessDetails?.additionalDetails) details.push(`Notes: ${businessDetails.additionalDetails}`);

  const sectionsInventory = buildSectionsInventory();

  const overview = [
    'You are a senior marketing copywriter rebuilding the referenced business website for our Vite + shadcn template.',
    'Do NOT mention AI SiteMaker or generic generators; ground every line in the reference business and provided businessDetails.',
    'Anchor the brand/offer in the provided sourceUrl text (sourceSummary) and keep the same business name (e.g., stevenmcconnon.com stays stevenmcconnon.com).',
    'Default to bright, friendly, high-contrast palettes; avoid dark/neo-purple themes unless the user explicitly requests a dark look.',
    'Select layouts by industry: proof-heavy for B2B/consulting, visual-forward for hospitality/creative, trust + service cards for home services.',
    'If the user asks for multiple pages or you are cloning a multi-page site, emit up to 5 pages with path/title/sections; otherwise use a single-page sections array.',
    'Output a single JSON object that matches the Site schema (meta, seo, theme, sections/pages) for our base Vite + shadcn project.',
    'Do NOT include HTML, JSX, Markdown, or file payloads. All copy must live inside the JSON fields.',
    '',
    'Available section components (componentId -> behavior):',
    sectionsInventory,
    '',
    'Requirements:',
    '- Include at least 8 sections covering hero, services/features, process, social proof, FAQ, pricing, CTA, and stats/proof.',
    '- Each section should contain 3+ persuasive sentences (>=80 words for hero/services, >=40 words elsewhere).',
    '- Provide vivid `imagePrompt` guidance for hero, features, stats, and CTA sections so Midjourney/Imagen can recreate the look.',
    '- meta.brandName/headline/subheadline must reflect the actual reference business (use businessDetails.businessName if provided; otherwise derive from sourceSummary/URL).',
    '- Copy must weave in the provided business details and source URL insights (sourceSummary); no lorem ipsum, no AI-SiteMaker messaging, and no generic AI boilerplate.',
    '- Treat sourceSummary as the ground truth: mirror its services, tone, and value props. If sourceSummary is missing, infer the brand from the URL words/businessDetails instead of inventing an AI platform.',
    '- Theme colors should mirror the brand/industry palette and avoid default dark-purple schemes; choose high-conversion, legible combinations that match the reference vibe and never default to ai-sitemaker purple.',
    '- Include a gallery-carousel section when imagery is important (portfolio, venues, products) with clear captions/badges; add a contact-form section with reassuring copy, clear CTA, and fields (including radio/checkbox options) plus contactEmail to mailto:example@test.com when provided.',
    '- When multiple pages are requested, include a pages array with up to 5 entries (each path/title/sections); otherwise use the sections array.',
    '- Use `componentId` values exactly as listed. Use unique `id` strings per section.',
    '- Keywords array must include at least 5 SEO phrases.',
    '- Absolute rule: every foreground color must meet WCAG AA contrast against its background. If background is light, use dark text (#0f172a–#1f2937); if background is dark, use light text (#f8fafc–#e2e8f0). Never white text on white or light gray. Adjust the palette until AA contrast is satisfied for text, buttons, and links. Include visible hover/focus states (underline or darker background) for links/buttons.',
    '- After selecting the palette, quickly self-check contrast for hero, body, buttons, and links; if any fail AA, tweak colors and only then return the JSON.',
    '- Respond with valid, minified JSON. No comments or backticks.',
    sourceUrl ? `Study this reference and beat it: ${sourceUrl}` : '',
    sourceSummary ? `Reference site text (truncated): ${sourceSummary}` : '',
    description ? `Additional instructions: ${description}` : '',
    details.length ? `Business inputs:\n- ${details.join('\n- ')}` : '',
  ];

  return overview.filter(Boolean).join('\n');
};

const generateSiteWithGemini = async ({ sourceUrl, description, businessDetails, sourceSummary }) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is required');
  const prompt = buildPrompt({ sourceUrl, description, businessDetails, sourceSummary });
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.5,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  let response;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    response = await fetch(DEFAULT_MODEL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });
    if (response.status !== 429 || attempt === maxAttempts) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }

  const raw = await response.text();
  if (!response.ok) {
    const error = new Error(`Gemini request failed: ${response.status} ${response.statusText}`);
    error.status = response.status;
    error.body = raw;
    throw error;
  }

  let parsedResponse = null;
  try {
    parsedResponse = JSON.parse(raw);
  } catch {
    /* ignore */
  }
  const text = pickFirstCandidate(parsedResponse) || raw;
  const json = extractJson(text);
  if (!json) {
    const error = new Error('Gemini response did not contain JSON');
    error.body = text;
    throw error;
  }

  const validation = validateSiteQuality(json.meta ? json : json.site || json.siteConfig || {});
  if (!validation.valid || !validation.site) {
    const error = new Error(`Site JSON failed validation: ${validation.errors?.join('; ')}`);
    error.body = text;
    throw error;
  }

  return { site: validation.site, rawText: text };
};

module.exports = { generateSiteWithGemini };
