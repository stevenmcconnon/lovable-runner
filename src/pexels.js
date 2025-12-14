const fetch = global.fetch;

const PEXELS_API_KEY = process.env.PEXELS_API_KEY || process.env.PEXELS_TOKEN || '';
const PEXELS_BASE = 'https://api.pexels.com/v1/search';

const seededShuffle = (array, seed) => {
  const result = [...array];
  let s = seed || 1;
  for (let i = result.length - 1; i > 0; i -= 1) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

const hashStringToInt = (value = '') => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
};

const fetchPexelsPhotos = async ({ query, perPage = 12, page = 1 }) => {
  if (!PEXELS_API_KEY || !query) return [];
  const url = new URL(PEXELS_BASE);
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', String(Math.max(1, Math.min(perPage, 30))));
  url.searchParams.set('page', String(Math.max(1, page)));
  const response = await fetch(url.toString(), {
    headers: { Authorization: PEXELS_API_KEY },
  });
  if (!response.ok) {
    const err = new Error(`Pexels request failed: ${response.status}`);
    err.status = response.status;
    throw err;
  }
  const json = await response.json();
  return Array.isArray(json?.photos) ? json.photos : [];
};

const pickPexelsImages = async ({ query, count = 4, seedValue = '' }) => {
  try {
    const photos = await fetchPexelsPhotos({ query, perPage: Math.max(count * 2, 8) });
    if (!photos.length) return [];
    const seed = hashStringToInt(seedValue || query);
    const shuffled = seededShuffle(photos, seed);
    return shuffled.slice(0, count).map((photo) => ({
      id: photo.id,
      photographer: photo.photographer,
      src:
        photo.src?.large2x ||
        photo.src?.large ||
        photo.src?.medium ||
        photo.src?.original ||
        null,
      alt: photo.alt || query,
      creditUrl: photo.url,
    }));
  } catch (error) {
    console.warn('[pexels] Failed to fetch photos', error?.message || error);
    return [];
  }
};

module.exports = { pickPexelsImages };
