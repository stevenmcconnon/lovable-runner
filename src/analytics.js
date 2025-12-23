const crypto = require('node:crypto');
const { SendMessageCommand } = require('@aws-sdk/client-sqs');
const { sqsClient } = require('./aws-clients');
const { analyticsQuery, query } = require('./pg-client');

const EVENT_COLUMNS = {
  view: 'views',
  cta: 'cta_clicks',
  lead: 'lead_submissions',
  booking: 'booking_requests',
};

const clampDays = (value) => {
  const num = Number(value) || 30;
  if (Number.isNaN(num)) return 30;
  return Math.min(Math.max(Math.floor(num), 1), 365);
};

const normalizeReferrer = (value) => {
  if (!value || typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const host = url.hostname?.toLowerCase()?.replace(/^www\./, '');
    if (!host) return null;
    const path = url.pathname && url.pathname !== '/' ? url.pathname : '';
    return `${host}${path}`;
  } catch {
    return value.trim().slice(0, 200);
  }
};

const normalizePath = (value) => {
  if (!value || typeof value !== 'string') return null;
  return value.trim().slice(0, 200);
};

const hashVisitorId = (value) => {
  if (!value) return null;
  return crypto.createHash('sha1').update(String(value)).digest('hex');
};

const incrementMetric = async ({ slug, eventDate, column, accountId = ZERO_UUID }) => {
  const sql = `
    INSERT INTO site_metrics (account_id, slug, event_date, ${column})
    VALUES ($1, $2, $3::date, 1)
    ON CONFLICT (account_id, slug, event_date)
    DO UPDATE SET ${column} = site_metrics.${column} + 1, updated_at = NOW()
  `;
  await analyticsQuery(sql, [accountId, slug, eventDate]);
};

const tryIncrementUniqueVisitor = async ({ slug, eventDate, visitorHash, accountId = ZERO_UUID }) => {
  if (!visitorHash) return;
  const inserted = await analyticsQuery(
    `
    INSERT INTO site_metric_visitors (account_id, slug, event_date, visitor_hash)
    VALUES ($1,$2,$3::date,$4)
    ON CONFLICT DO NOTHING
  `,
    [accountId, slug, eventDate, visitorHash]
  );
  if (inserted.rowCount) {
    await analyticsQuery(
      `
      UPDATE site_metrics
      SET unique_visitors = unique_visitors + 1, updated_at = NOW()
      WHERE account_id = $1 AND slug = $2 AND event_date = $3::date
    `,
      [accountId, slug, eventDate]
    );
  }
};

const recordReferrer = async ({ slug, eventDate, referrer, accountId = ZERO_UUID }) => {
  if (!referrer) return;
  await analyticsQuery(
    `
    INSERT INTO site_metric_referrers (account_id, slug, event_date, referrer, count, last_seen)
    VALUES ($1,$2,$3::date,$4,1,NOW())
    ON CONFLICT (account_id, slug, event_date, referrer)
    DO UPDATE SET count = site_metric_referrers.count + 1, last_seen = NOW()
  `,
    [accountId, slug, eventDate, referrer]
  );
};

const ANALYTICS_QUEUE_URL = process.env.ANALYTICS_QUEUE_URL || process.env.SITE_ANALYTICS_QUEUE_URL || '';

const analyticsQueue = ANALYTICS_QUEUE_URL ? sqsClient : null;

const enqueueAnalyticsEvent = async (payload) => {
  if (!analyticsQueue || !ANALYTICS_QUEUE_URL) return false;
  await analyticsQueue.send(
    new SendMessageCommand({
      QueueUrl: ANALYTICS_QUEUE_URL,
      MessageBody: JSON.stringify({
        action: 'PROCESS_ANALYTICS_EVENT',
        payload,
      }),
    })
  );
  return true;
};

let warnedAboutDirectWrites = false;

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const accountCache = new Map();

const resolveAccountIdForSlug = async (slug) => {
  if (!slug) return ZERO_UUID;
  const cached = accountCache.get(slug);
  if (cached) return cached;
  try {
    const result = await query(
      `
      SELECT account_id
      FROM account_sites
      WHERE slug = $1
      LIMIT 1
    `,
      [slug]
    );
    const accountId = result.rows?.[0]?.account_id || ZERO_UUID;
    accountCache.set(slug, accountId);
    return accountId;
  } catch (error) {
    console.warn('[analytics] failed to resolve account for slug', { slug, err: error?.message });
    return ZERO_UUID;
  }
};

const ingestAnalyticsEvent = async ({ slug, type, metadata = {} }) => {
  if (!slug || !type) return;
  const normalizedType = type.toLowerCase();
  const column = EVENT_COLUMNS[normalizedType] || EVENT_COLUMNS.view;
  const eventDate = new Date().toISOString().slice(0, 10);
  const visitorHash = hashVisitorId(metadata.visitorId);
  const referrer = normalizeReferrer(metadata.referrer);
  const accountId = await resolveAccountIdForSlug(slug);

  await incrementMetric({ slug, eventDate, column, accountId });

  if (normalizedType === 'view') {
    await tryIncrementUniqueVisitor({ slug, eventDate, visitorHash, accountId });
  }
  if (referrer) {
    await recordReferrer({ slug, eventDate, referrer, accountId });
  }
};

const recordAnalyticsEvent = async ({ slug, type, metadata = {} }) => {
  if (analyticsQueue && ANALYTICS_QUEUE_URL) {
    try {
      await enqueueAnalyticsEvent({ slug, type, metadata });
      return;
    } catch (error) {
      console.warn('[analytics] Failed to enqueue event, falling back to direct write', {
        err: error?.message,
      });
    }
  }
  if (!warnedAboutDirectWrites && !analyticsQueue) {
    warnedAboutDirectWrites = true;
    console.warn(
      '[analytics] ANALYTICS_QUEUE_URL is not configured; writing events directly to the database.'
    );
  }
  await ingestAnalyticsEvent({ slug, type, metadata });
};

const fetchDailyMetrics = async ({ slug, days, accountId }) =>
  analyticsQuery(
    `
    SELECT
      stat_date,
      views,
      cta_clicks,
      lead_submissions,
      booking_requests,
      unique_visitors
    FROM site_metrics_daily
    WHERE slug = $1
      AND stat_date >= (CURRENT_DATE - ($2 || ' days')::interval)
      AND account_id = $3
    ORDER BY stat_date DESC
    LIMIT $2
  `,
    [slug, days, accountId]
  );

const fetchFallbackMetrics = async ({ slug, days, accountId }) =>
  analyticsQuery(
    `
    SELECT
      event_date,
      views,
      cta_clicks,
      lead_submissions,
      booking_requests,
      unique_visitors
    FROM site_metrics
    WHERE slug = $1
      AND event_date >= (CURRENT_DATE - ($2 || ' days')::interval)
      AND account_id = $3
    ORDER BY event_date DESC
    LIMIT $2
  `,
    [slug, days, accountId]
  );

const listAnalytics = async ({ slug, days = 30, accountId }) => {
  if (!slug) throw new Error('slug is required');
  const windowDays = clampDays(days);
  const resolvedAccountId = accountId || (await resolveAccountIdForSlug(slug));
  let { rows } = await fetchDailyMetrics({
    slug,
    days: windowDays,
    accountId: resolvedAccountId,
  });
  if (!rows.length) {
    const fallback = await fetchFallbackMetrics({
      slug,
      days: windowDays,
      accountId: resolvedAccountId,
    });
    rows = (fallback.rows || []).map((row) => ({
      stat_date: row.event_date,
      ...row,
    }));
  }
  const referrersResult = await analyticsQuery(
    `
    SELECT event_date, referrer, count
    FROM site_metric_referrers
    WHERE slug = $1
      AND event_date >= (CURRENT_DATE - ($2 || ' days')::interval)
      AND account_id = $3
    ORDER BY event_date DESC, count DESC
  `,
    [slug, windowDays, resolvedAccountId]
  );

  const referrerMap = new Map();
  referrersResult.rows.forEach((row) => {
    const key = row.event_date.toISOString().slice(0, 10);
    const existing = referrerMap.get(key) || [];
    if (existing.length < 5) {
      existing.push({ referrer: row.referrer, count: Number(row.count || 0) });
      referrerMap.set(key, existing);
    }
  });

  return rows.map((row) => {
    const statDateSource = row.stat_date || row.event_date;
    const statDate =
      statDateSource instanceof Date
        ? statDateSource.toISOString().slice(0, 10)
        : new Date(statDateSource).toISOString().slice(0, 10);
    return {
      slug,
      statDate,
      pageViewCount: Number(row.views || 0),
      ctaCount: Number(row.cta_clicks || 0),
      leadCount: Number(row.lead_submissions || 0),
      bookingCount: Number(row.booking_requests || 0),
      uniqueVisitors: Number(row.unique_visitors || 0),
      topReferrers: referrerMap.get(statDate) || [],
    };
  });
};

const buildAlerts = (records = []) => {
  if (!records.length) return ['No analytics data yet.'];
  const totals = records.reduce(
    (acc, record) => {
      acc.views += record.pageViewCount || 0;
      acc.leads += record.leadCount || 0;
      acc.bookings += record.bookingCount || 0;
      return acc;
    },
    { views: 0, leads: 0, bookings: 0 }
  );
  const alerts = [];
  if (totals.views === 0) {
    alerts.push('Your site has not received any visits yet.');
  }
  if (totals.leads === 0 && records.length >= 7) {
    alerts.push('No leads captured in the last week.');
  }
  if (totals.leads > 0 && totals.views > 0) {
    const conversion = (totals.leads / totals.views) * 100;
    if (conversion < 1) {
      alerts.push('Lead conversion is under 1%. Consider improving CTAs.');
    }
  }
  if (totals.bookings === 0 && records.length >= 7) {
    alerts.push('No booking requests captured recently.');
  }
  return alerts.length ? alerts : ['Traffic and leads look healthy.'];
};

module.exports = {
  recordAnalyticsEvent,
  ingestAnalyticsEvent,
  listAnalytics,
  buildAlerts,
  normalizePath,
};
