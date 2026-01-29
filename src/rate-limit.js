const { query } = require('./pg-client');

class RateLimitError extends Error {
  constructor(message, meta = {}) {
    super(message || 'Too many requests. Please try again later.');
    this.name = 'RateLimitError';
    this.statusCode = 429;
    this.metadata = meta;
  }
}

const DEFAULT_WINDOW_MS = 60 * 1000;

const enforceRateLimit = async ({
  slug,
  action,
  identifier,
  limit,
  windowMs = DEFAULT_WINDOW_MS,
}) => {
  if (!action || !identifier || !limit) return;
  const windowSize = Number(windowMs) > 0 ? Number(windowMs) : DEFAULT_WINDOW_MS;
  const now = Date.now();
  const windowStartMs = Math.floor(now / windowSize) * windowSize;
  const windowEndMs = windowStartMs + windowSize;
  const windowStart = new Date(windowStartMs).toISOString();
  const windowEnd = new Date(windowEndMs).toISOString();

  // `rate_limit_counters.slug` is NOT NULL in prod.
  // For endpoints that aren't tied to a specific site slug, we bucket under "global".
  const finalSlug = slug && String(slug).trim() ? String(slug).trim() : 'global';

  const params = [
    finalSlug,
    action,
    identifier,
    windowStart,
    windowEnd,
  ];
  const result = await query(
    `
    INSERT INTO rate_limit_counters (slug, action, identifier, window_start, window_end, count)
    VALUES ($1,$2,$3,$4,$5,1)
    ON CONFLICT (slug, action, identifier, window_start)
    DO UPDATE SET count = rate_limit_counters.count + 1
    RETURNING count
  `,
    params
  );
  const count = Number(result.rows?.[0]?.count || 0);
  if (count > limit) {
    throw new RateLimitError('Too many requests. Please try again soon.', {
      slug: finalSlug,
      action,
      identifier,
      limit,
      windowMs: windowSize,
    });
  }
};

module.exports = {
  enforceRateLimit,
  RateLimitError,
};
