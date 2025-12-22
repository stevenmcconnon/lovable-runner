const { analyticsQuery } = require('./pg-client');

const toDateString = (value) => {
  if (!value) return new Date().toISOString().slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
};

const rollupForDate = async (statDate) => {
  const target = toDateString(statDate);
  const result = await analyticsQuery(
    `
    WITH upserts AS (
      INSERT INTO site_metrics_daily (
        slug,
        stat_date,
        views,
        cta_clicks,
        lead_submissions,
        booking_requests,
        unique_visitors,
        created_at,
        updated_at
      )
      SELECT
        slug,
        event_date AS stat_date,
        COALESCE(SUM(views),0) AS views,
        COALESCE(SUM(cta_clicks),0) AS cta_clicks,
        COALESCE(SUM(lead_submissions),0) AS lead_submissions,
        COALESCE(SUM(booking_requests),0) AS booking_requests,
        COALESCE(SUM(unique_visitors),0) AS unique_visitors,
        NOW() AS created_at,
        NOW() AS updated_at
      FROM site_metrics
      WHERE event_date = $1::date
      GROUP BY slug, event_date
      ON CONFLICT (slug, stat_date)
      DO UPDATE SET
        views = EXCLUDED.views,
        cta_clicks = EXCLUDED.cta_clicks,
        lead_submissions = EXCLUDED.lead_submissions,
        booking_requests = EXCLUDED.booking_requests,
        unique_visitors = EXCLUDED.unique_visitors,
        updated_at = NOW()
      RETURNING slug
    )
    SELECT COUNT(*)::int AS processed FROM upserts;
  `,
    [target]
  );
  const processed = Number(result.rows?.[0]?.processed || 0);
  return { statDate: target, processed };
};

const rollupDateRange = async ({ startDate, endDate }) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) {
    throw new Error('Invalid start or end date for analytics rollup.');
  }
  if (start > end) {
    throw new Error('startDate must be on or before endDate.');
  }
  const results = [];
  for (
    let cursor = new Date(start);
    cursor <= end;
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
  ) {
    // eslint-disable-next-line no-await-in-loop
    const result = await rollupForDate(cursor);
    results.push(result);
  }
  return results;
};

const rollupPreviousDay = async () => {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return rollupForDate(yesterday);
};

module.exports = {
  rollupForDate,
  rollupDateRange,
  rollupPreviousDay,
};
