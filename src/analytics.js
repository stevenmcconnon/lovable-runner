const crypto = require('node:crypto');
const { SendMessageCommand } = require('@aws-sdk/client-sqs');
const { sqsClient } = require('./aws-clients');
const { analyticsQuery } = require('./pg-client');

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

const incrementMetric = async ({ slug, eventDate, column }) => {
  const sql = `
    INSERT INTO site_metrics (slug, event_date, ${column})
    VALUES ($1, $2::date, 1)
    ON CONFLICT (slug, event_date)
    DO UPDATE SET ${column} = site_metrics.${column} + 1, updated_at = NOW()
  `;
  await analyticsQuery(sql, [slug, eventDate]);
};

const tryIncrementUniqueVisitor = async ({ slug, eventDate, visitorHash }) => {
  if (!visitorHash) return;
  const inserted = await analyticsQuery(
    `
    INSERT INTO site_metric_visitors (slug, event_date, visitor_hash)
    VALUES ($1,$2::date,$3)
    ON CONFLICT DO NOTHING
  `,
    [slug, eventDate, visitorHash]
  );
  if (inserted.rowCount) {
    await analyticsQuery(
      `
      UPDATE site_metrics
      SET unique_visitors = unique_visitors + 1, updated_at = NOW()
      WHERE slug = $1 AND event_date = $2::date
    `,
      [slug, eventDate]
    );
  }
};

const recordReferrer = async ({ slug, eventDate, referrer }) => {
  if (!referrer) return;
  await analyticsQuery(
    `
    INSERT INTO site_metric_referrers (slug, event_date, referrer, count, last_seen)
    VALUES ($1,$2::date,$3,1,NOW())
    ON CONFLICT (slug, event_date, referrer)
    DO UPDATE SET count = site_metric_referrers.count + 1, last_seen = NOW()
  `,
    [slug, eventDate, referrer]
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

const ingestAnalyticsEvent = async ({ slug, type, metadata = {} }) => {
  if (!slug || !type) return;
  const normalizedType = type.toLowerCase();
  const column = EVENT_COLUMNS[normalizedType] || EVENT_COLUMNS.view;
  const eventDate = new Date().toISOString().slice(0, 10);
  const visitorHash = hashVisitorId(metadata.visitorId);
  const referrer = normalizeReferrer(metadata.referrer);

  await incrementMetric({ slug, eventDate, column });

  if (normalizedType === 'view') {
    await tryIncrementUniqueVisitor({ slug, eventDate, visitorHash });
  }
  if (referrer) {
    await recordReferrer({ slug, eventDate, referrer });
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
  await ingestAnalyticsEvent({ slug, type, metadata });
};

const fetchDailyMetrics = async ({ slug, days }) =>
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
    ORDER BY stat_date DESC
    LIMIT $3
  `,
    [slug, days, days]
  );

const fetchFallbackMetrics = async ({ slug, days }) =>
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
    ORDER BY event_date DESC
    LIMIT $3
  `,
    [slug, days, days]
  );

const listAnalytics = async ({ slug, days = 30 }) => {
  if (!slug) throw new Error('slug is required');
  const windowDays = clampDays(days);
  let { rows } = await fetchDailyMetrics({ slug, days: windowDays });
  if (!rows.length) {
    const fallback = await fetchFallbackMetrics({ slug, days: windowDays });
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
    ORDER BY event_date DESC, count DESC
  `,
    [slug, windowDays]
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
