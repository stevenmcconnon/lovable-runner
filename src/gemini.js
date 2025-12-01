const DEFAULT_MODEL =
  process.env.GEMINI_MODEL ||
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent';

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          contents: { type: 'string' },
          encoding: { type: 'string', enum: ['utf8', 'base64'] },
          contentType: { type: 'string' },
        },
        required: ['path', 'contents'],
      },
    },
    meta: {
      type: 'object',
      properties: {
        entry: { type: 'string' },
      },
    },
  },
  required: ['files'],
};

const guessContentType = (filePath = '') => {
  const extension = filePath.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'html':
      return 'text/html';
    case 'css':
      return 'text/css';
    case 'js':
      return 'application/javascript';
    case 'json':
      return 'application/json';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'text/plain';
  }
};

const normalizeFiles = (files = []) =>
  files
    .map((file) => {
      if (!file || typeof file.path !== 'string' || file.contents === undefined || file.contents === null) {
        return null;
      }
      return {
        path: file.path,
        contents: file.contents,
        encoding: file.encoding ?? 'utf8',
        contentType: file.contentType ?? guessContentType(file.path),
      };
    })
    .filter(Boolean);

const buildPrompt = ({ sourceUrl, description, businessDetails }) => {
  const details = [];
  if (businessDetails?.businessName) details.push(`Business name: ${businessDetails.businessName}`);
  if (businessDetails?.businessType) details.push(`Business type: ${businessDetails.businessType}`);
  if (businessDetails?.address) details.push(`Address: ${businessDetails.address}`);
  if (businessDetails?.phone) details.push(`Phone: ${businessDetails.phone}`);
  if (businessDetails?.additionalDetails) details.push(`Notes: ${businessDetails.additionalDetails}`);

  const overview = [
    'You are an elite conversion-focused web designer + front-end engineer.',
    'Produce a complete Vite + React + TypeScript project that mirrors Lovable exports so it can be opened, edited, and rebuilt locally.',
    'The repository must contain BOTH the editable project (package.json, src/, tailwind config, etc.) AND the compiled production build (dist/ folder) so we can deploy immediately without running npm install.',
    '',
    'Layout/visual requirements:',
    '- Impactful hero, services/solutions, testimonials or proof, process, about/team, CTA/footer; add blog or FAQ if relevant.',
    '- Use modern typography, layered gradients, tasteful shadowing, and micro-interactions.',
    '- Copy must be polished, benefit-driven, drawn from the provided business data (no lorem ipsum).',
    '- Generate at least two unique hero/section imagery assets (abstract gradients, mockups, or AI-inspired collages) as PNG/JPEG files; store originals under src/assets and include compiled copies in dist/assets.',
    sourceUrl
      ? `Source URL to study: ${sourceUrl}. Extract the best information but rewrite with clearer messaging, better UX, and modern visuals.`
      : '',
    description ? `Extra guidance: ${description}` : '',
    details.length ? `Business details to incorporate:\n- ${details.join('\n- ')}` : '',
    '',
    'Project structure requirements:',
    '- package.json with scripts: dev, build, preview. Use Vite + React + TypeScript + Tailwind (include postcss.config.js, tailwind.config.ts, tsconfig.*). Include package-lock.json.',
    '- src/ directory: main.tsx bootstrapping React, App.tsx defining page layout, App.css (or equivalent) containing Tailwind base + custom CSS, components/ directory for reusable blocks, assets/ for images/icons.',
    '- public/ directory with favicon.ico, placeholder.svg, robots.txt.',
    '- dist/ directory containing the result of `npm run build` (index.html plus hashed assets folder). Ensure dist/index.html references the hashed JS/CSS generated inside dist/assets.',
    '- README.md documenting how to run the project.',
    '- Each binary asset (PNG/JPG/SVG) must be base64-encoded in the JSON response with encoding=\"base64\" and placed in BOTH src/assets (original) and dist/assets (compiled) paths.',
    '- CSS should live in App.css (and compiled counterpart in dist). Do not inline CSS into HTML except for minimal resets.',
    '- Use relative imports throughout (e.g., ./assets/hero.png).',
    '',
    'Return ONLY JSON using this schema (a single JSON object). Every file in the repo and dist build must have an entry:',
    '{',
    '  "files": [',
    '    { "path": "package.json", "contents": "{...}", "encoding": "utf8", "contentType": "application/json" },',
    '    { "path": "src/App.tsx", "contents": "import ...", "encoding": "utf8", "contentType": "text/plain" },',
    '    { "path": "src/assets/hero.jpg", "contents": "<base64>", "encoding": "base64", "contentType": "image/jpeg" },',
    '    { "path": "dist/index.html", "contents": "<!doctype html>...", "encoding": "utf8", "contentType": "text/html" },',
    '    { "path": "dist/assets/index-XYZ.js", "contents": "...", "encoding": "utf8", "contentType": "application/javascript" }',
    '  ],',
    '  "meta": { "entry": "index.html" }',
    '}',
    '',
    'Rules:',
    '- JSON only; no markdown fences, layout arrays, or commentary.',
    '- Include every file referenced in package.json, src imports, and dist output so the repo is self-contained.',
    '- Fonts may use Google Fonts via <link>; everything else must be local.',
    '- Keep binary assets as base64 strings with encoding="base64"; text uses encoding="utf8".',
    '- Use relative paths matching the file tree (e.g., src/components/Button.tsx, dist/assets/index-XYZ.css).',
    '- Deviations from the schema will cause the request to be rejected.',
  ];

  return overview.filter(Boolean).join('\n');
};

const extractJson = (text) => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    /* fallthrough */
  }
  // Try to pull JSON out of code fences if present
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

const generateSiteWithGemini = async ({ sourceUrl, description, businessDetails }) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is required');
  const prompt = buildPrompt({ sourceUrl, description, businessDetails });
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.7,
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
  const normalizedFiles = normalizeFiles(json?.files);
  if (!normalizedFiles.length) {
    const error = new Error('Gemini response did not include files');
    error.body = text;
    throw error;
  }
  return { files: normalizedFiles, meta: json?.meta || {}, rawText: text };
};

module.exports = { generateSiteWithGemini };
