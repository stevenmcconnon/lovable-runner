const fetch = global.fetch;

const OPENAI_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL =
  process.env.COLOR_AGENT_MODEL ||
  process.env.OPENAI_COLOR_MODEL ||
  process.env.OPENAI_MODEL ||
  'gpt-5.1-mini';

const extractOutputText = (payload) => {
  const content = payload?.output?.[0]?.content;
  if (Array.isArray(content)) {
    const chunk = content.find((entry) => entry.type === 'output_text');
    if (chunk?.text) return chunk.text;
  }
  if (Array.isArray(payload?.content)) {
    const chunk = payload.content.find((entry) => entry.type === 'output_text');
    if (chunk?.text) return chunk.text;
  }
  return '';
};

const buildSchemaFormat = () => ({
  type: 'json_schema',
  name: 'theme_palette',
  strict: false,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['theme'],
    properties: {
      theme: {
        type: 'object',
        additionalProperties: false,
        required: ['primaryColor', 'accentColor', 'textColor', 'backgroundStyle', 'vibe'],
        properties: {
          primaryColor: { type: 'string', minLength: 4 },
          accentColor: { type: 'string', minLength: 4 },
          textColor: { type: 'string', minLength: 4 },
          backgroundStyle: { type: 'string', enum: ['gradient', 'mesh', 'texture'] },
          vibe: { type: 'string', enum: ['luxury', 'tech', 'playful', 'earthy'] },
        },
      },
      notes: {
        type: 'string',
        description: 'One paragraph describing how the palette ties to the business and competitors.',
      },
    },
  },
});

const buildPrompt = ({ site, sourceUrl, sourceSummary, description, businessDetails }) => {
  const details = [];
  if (businessDetails?.businessName) details.push(`Business: ${businessDetails.businessName}`);
  if (businessDetails?.businessType) details.push(`Type: ${businessDetails.businessType}`);
  if (businessDetails?.address) details.push(`Location: ${businessDetails.address}`);
  if (businessDetails?.phone) details.push(`Phone: ${businessDetails.phone}`);
  if (businessDetails?.additionalDetails) details.push(`Notes: ${businessDetails.additionalDetails}`);

  const existingTheme = site?.theme
    ? `Existing theme: ${JSON.stringify(site.theme)}`
    : 'Existing theme: missing (provide fresh values).';

  const constraints = [
    'You are an elite brand color director. Rebuild the site palette so it feels sleek, modern, and high-end.',
    'Study the industry, customer prompt, and competitor site to pick colors that feel specific (e.g., lawn care -> sophisticated greens, pool resurfacing -> crisp aquas). Avoid reusing the same palette across businesses.',
    'Color system:',
    '- primaryColor: hero + buttons background, should represent the brand.',
    '- accentColor: hover states/badges, should complement the primary hue.',
    '- textColor: everyday paragraph text on the site cards — absolutely never pure white on a light background.',
    '- The base template uses luminous white glassmorphism surfaces, so textColor should stay in the deep navy/charcoal family unless the client explicitly demands a dark interface.',
    '- Always meet WCAG AA contrast for text vs. its background. If the palette skews light, use a deep navy/charcoal textColor. If it skews dark, use a pale textColor.',
    '- Match the backgroundStyle + vibe to the palette (mesh for organic/luxury, gradient for tech, texture for handcrafted).',
    '- Honor any color directions from the user description. When mimicking a competitor, borrow tonal inspiration but keep it original.',
    '',
    existingTheme,
    sourceUrl ? `Reference site: ${sourceUrl}` : '',
    sourceSummary ? `Reference summary: ${sourceSummary}` : '',
    description ? `User instructions: ${description}` : '',
    details.length ? `Business context:\n- ${details.join('\n- ')}` : '',
  ];

  return constraints.filter(Boolean).join('\n');
};

const HEX_COLOR_REGEX = /^#?[0-9a-fA-F]{6}$/;

const ensureHex = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  if (!HEX_COLOR_REGEX.test(normalized)) return null;
  return normalized;
};

const normalizeTheme = (rawTheme = {}, fallback = {}) => {
  const merged = {
    ...fallback,
    ...rawTheme,
  };
  if (merged.primaryColor) merged.primaryColor = ensureHex(merged.primaryColor);
  if (merged.accentColor) merged.accentColor = ensureHex(merged.accentColor);
  if (merged.textColor) merged.textColor = ensureHex(merged.textColor);
  return merged;
};

const refineThemePalette = async ({ site, sourceUrl, sourceSummary, description, businessDetails }) => {
  if (!site?.theme) return site;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[color-agent] Skipping palette refinement (OPENAI_API_KEY missing)');
    return site;
  }

  const prompt = buildPrompt({ site, sourceUrl, sourceSummary, description, businessDetails });
  const body = {
    model: DEFAULT_MODEL,
    temperature: 0.2,
    input: [
      {
        role: 'system',
        content:
          'You craft industry-specific website color palettes. Output compact JSON obeying the schema, and ensure every foreground/background pairing meets WCAG AA contrast.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    text: {
      format: buildSchemaFormat(),
    },
  };

  let parsed = null;
  try {
    const response = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) {
      const error = new Error(`Color agent request failed: ${response.status} ${response.statusText}`);
      error.body = payload;
      throw error;
    }
    const text = extractOutputText(payload);
    parsed = text ? JSON.parse(text) : null;
  } catch (error) {
    console.warn('[color-agent] Failed to refine palette (continuing with existing theme)', {
      err: error?.message,
    });
    return site;
  }

  if (!parsed?.theme) return site;
  const refinedTheme = normalizeTheme(parsed.theme, site.theme);
  const nextSite = {
    ...site,
    theme: {
      ...site.theme,
      ...refinedTheme,
    },
  };
  console.log('[color-agent] Palette updated', {
    brand: nextSite.meta?.brandName,
    theme: nextSite.theme,
  });
  return nextSite;
};

module.exports = { refineThemePalette };
