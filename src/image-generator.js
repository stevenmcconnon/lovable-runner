const path = require('node:path');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');

const fetch = global.fetch;

const DEFAULT_MODEL = process.env.GOOGLE_IMAGE_MODEL || 'gemini-3-pro-image-preview';
const DEFAULT_ASPECT_RATIO = process.env.GOOGLE_IMAGE_ASPECT_RATIO || '5:4';
const DEFAULT_IMAGE_SIZE = process.env.GOOGLE_IMAGE_SIZE || '2K';
const MAX_IMAGES = Number(process.env.GOOGLE_IMAGE_MAX || 8);

const normalizePrompt = (value) => (typeof value === 'string' ? value.trim() : '');

const slugifyFile = (input, fallback = 'image') =>
  (input || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || fallback;

const collectPrompts = (site) => {
  if (!site?.sections) return [];
  const prompts = [];
  site.sections.forEach((section, index) => {
    const prompt = normalizePrompt(section?.props?.imagePrompt);
    if (!prompt) return;
    prompts.push({
      sectionIndex: index,
      prompt,
      sectionId: section.id || `section-${index + 1}`,
    });
  });
  return prompts;
};

const callGoogleImageApi = async ({ prompt, apiKey, model }) => {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio: DEFAULT_ASPECT_RATIO,
          imageSize: DEFAULT_IMAGE_SIZE,
        },
      },
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    const err = new Error(payload?.error?.message || `Google image request failed: ${response.status}`);
    err.body = payload;
    throw err;
  }

  const candidate = payload?.candidates?.[0];
  const part = candidate?.content?.parts?.find((item) => item.inlineData?.data);
  if (!part?.inlineData?.data) {
    throw new Error('Google image response missing inlineData payload');
  }

  const buffer = Buffer.from(part.inlineData.data, 'base64');
  const mimeType = part.inlineData.mimeType || 'image/png';
  return { buffer, mimeType };
};

const deriveExtension = (mimeType = '') => {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  return 'png';
};

const ensureDir = async (dir) => {
  await fsp.mkdir(dir, { recursive: true });
};

const createImageRecord = (section, fileName) => ({
  src: `./generated/${fileName}`,
  alt: section?.props?.title || section?.props?.subtitle || section?.meta?.brandName || section?.id || 'Generated visual',
  generatedAt: new Date().toISOString(),
});

const enhanceSiteWithImages = async ({ site, projectDir, slug, requestId, enabled = true }) => {
  if (!enabled) return site;
  const apiKey = process.env.GOOGLE_IMAGE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[images] Skipping image generation (no Google API key configured)');
    return site;
  }

  const prompts = collectPrompts(site).slice(0, MAX_IMAGES);
  if (!prompts.length) return site;

  const siteClone = JSON.parse(JSON.stringify(site));
  const assetsDir = path.join(projectDir, 'public', 'generated');
  await ensureDir(assetsDir);

  for (const promptEntry of prompts) {
    const section = siteClone.sections[promptEntry.sectionIndex];
    if (!section) continue;
    try {
      console.log('[images] Generating image', { requestId, sectionId: section.id, slug });
      const { buffer, mimeType } = await callGoogleImageApi({
        prompt: promptEntry.prompt,
        apiKey,
        model: process.env.GOOGLE_IMAGE_MODEL || DEFAULT_MODEL,
      });
      const extension = deriveExtension(mimeType);
      const baseName = slugifyFile(`${section.id || 'section'}-${crypto.randomUUID().slice(0, 4)}`);
      const fileName = `${baseName}.${extension}`;
      await fsp.writeFile(path.join(assetsDir, fileName), buffer);
      section.props = {
        ...section.props,
        image: createImageRecord(section, fileName),
      };
    } catch (error) {
      console.warn('[images] Failed to generate image', {
        requestId,
        sectionId: section?.id,
        err: error?.message,
      });
    }
  }

  return siteClone;
};

module.exports = { enhanceSiteWithImages };
