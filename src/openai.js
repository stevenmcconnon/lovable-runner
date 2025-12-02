const fetch = global.fetch;
const { validateSiteQuality } = require('./site-schema');
const { SECTION_MANIFEST, SECTION_IDS } = require('./sections/registry');

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-5.1';
const OPENAI_URL = 'https://api.openai.com/v1/responses';

const buildSectionsInventory = () =>
  SECTION_MANIFEST.map((section) => {
    const required = section.requiredProps?.length ? `Required props: ${section.requiredProps.join(', ')}.` : '';
    return `- ${section.id}: ${section.description} ${required}`.trim();
  }).join('\n');

const buildPrompt = ({ sourceUrl, description, businessDetails }) => {
  const details = [];
  if (businessDetails?.businessName) details.push(`Business name: ${businessDetails.businessName}`);
  if (businessDetails?.businessType) details.push(`Business type: ${businessDetails.businessType}`);
  if (businessDetails?.address) details.push(`Address: ${businessDetails.address}`);
  if (businessDetails?.phone) details.push(`Phone: ${businessDetails.phone}`);
  if (businessDetails?.additionalDetails) details.push(`Notes: ${businessDetails.additionalDetails}`);

  return [
    'You are the creative director for AI-SiteMaker. Return ONLY JSON (no Markdown) describing a premium marketing site layout for our Vite + shadcn template.',
    'The JSON must follow the Site schema (meta, seo, theme, sections[]) and every section entry must include a props object with all copy, CTAs, lists, and imagePrompt text needed to render that block.',
    'Available sections and their behaviors:',
    buildSectionsInventory(),
    '',
    'Rules:',
    '- Include at least 8 sections covering hero, services/features, process, testimonials/social proof, FAQ, pricing, CTA, and stats/proof.',
    '- Each section needs 3+ sentences (>=80 words for hero/services) and vivid `imagePrompt` guidance where visual direction is relevant.',
    '- Copy must be rewritten from the reference site and business details (no lorem ipsum).',
    '- Keywords array in seo must contain 5+ phrases.',
    '- Respond with compact JSON only; no commentary.',
    sourceUrl ? `Reference site to outperform: ${sourceUrl}` : '',
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
    required: ['meta', 'seo', 'theme', 'sections'],
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

const generateSiteWithOpenAI = async ({ sourceUrl, description, businessDetails }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required');

  const prompt = buildPrompt({ sourceUrl, description, businessDetails });
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

module.exports = { generateSiteWithOpenAI };
