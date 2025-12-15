const fetch = global.fetch;

const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || process.env.UNSPLASH_TOKEN || '';
const UNSPLASH_BASE = 'https://api.unsplash.com/search/photos';
const UNSPLASH_HEADERS = {
  Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`,
  'Accept-Version': 'v1',
};

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

const fetchUnsplashPhotos = async ({ query, perPage = 12, page = 1 }) => {
  if (!UNSPLASH_ACCESS_KEY || !query) return [];
  const url = new URL(UNSPLASH_BASE);
  url.searchParams.set('query', query.slice(0, 256));
  url.searchParams.set('per_page', String(Math.max(1, Math.min(perPage, 30))));
  url.searchParams.set('page', String(Math.max(1, page)));
  url.searchParams.set('orientation', 'landscape');
  url.searchParams.set('content_filter', 'high');
  url.searchParams.set('order_by', 'relevant');
  const response = await fetch(url.toString(), { headers: UNSPLASH_HEADERS });
  if (!response.ok) {
    let errorText = '';
    try {
      errorText = await response.text();
    } catch (error) {
      errorText = '';
    }
    const message = errorText ? `${response.status} ${errorText}` : String(response.status);
    const err = new Error(`Unsplash request failed: ${message}`);
    err.status = response.status;
    throw err;
  }
  const json = await response.json();
  return Array.isArray(json?.results) ? json.results : [];
};

const pickUnsplashImages = async ({ query, count = 4, seedValue = '' }) => {
  try {
    const photos = await fetchUnsplashPhotos({ query, perPage: Math.max(count * 2, 8) });
    if (!photos.length) return [];
    const seed = hashStringToInt(seedValue || query);
    const shuffled = seededShuffle(photos, seed);
    return shuffled.slice(0, count).map((photo) => ({
      id: photo.id,
      photographer: photo.user?.name || 'Unsplash',
      src:
        photo.urls?.full ||
        photo.urls?.regular ||
        photo.urls?.small ||
        photo.urls?.thumb ||
        null,
      alt: photo.alt_description || photo.description || query,
      description: photo.description || null,
      tags: Array.isArray(photo.tags)
        ? photo.tags.map((tag) => tag?.title).filter(Boolean)
        : undefined,
      creditUrl: photo.links?.html,
    }));
  } catch (error) {
    if (error?.status === 403) {
      error.rateLimited = true;
      console.warn('[unsplash] Rate limit hit; halting further requests');
      throw error;
    }
    console.warn('[unsplash] Failed to fetch photos', error?.message || error);
    return [];
  }
};

module.exports = { pickUnsplashImages };
