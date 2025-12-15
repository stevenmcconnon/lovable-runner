const AWS = require('aws-sdk');

const TABLE_NAME =
  process.env.SITE_ANALYTICS_TABLE ||
  process.env.ANALYTICS_TABLE_NAME ||
  process.env.LOVABLE_ANALYTICS_TABLE;

const getClient = () => {
  if (!TABLE_NAME) {
    throw new Error('SITE_ANALYTICS_TABLE environment variable is not set.');
  }
  if (!AWS.config.region && process.env.AWS_REGION) {
    AWS.config.update({ region: process.env.AWS_REGION });
  }
  return new AWS.DynamoDB.DocumentClient();
};

const recordAnalyticsEvent = async ({ slug, type, metadata }) => {
  if (!slug || !type) return;
  try {
    const client = getClient();
    const dateKey = new Date().toISOString().slice(0, 10);
    const fieldName =
      type === 'booking'
        ? 'bookingCount'
        : type === 'lead'
        ? 'leadCount'
        : 'pageViewCount';
    await client
      .update({
        TableName: TABLE_NAME,
        Key: { slug, statDate: dateKey },
        UpdateExpression:
          'ADD #metric :inc SET #updatedAt = :now, #lastType = :type, #metadata = list_append(if_not_exists(#metadata, :empty), :meta)',
        ExpressionAttributeNames: {
          '#metric': fieldName,
          '#updatedAt': 'updatedAt',
          '#lastType': 'lastEventType',
          '#metadata': 'metadata',
        },
        ExpressionAttributeValues: {
          ':inc': 1,
          ':now': new Date().toISOString(),
          ':type': type,
          ':empty': [],
          ':meta': metadata ? [metadata] : [],
        },
      })
      .promise();
  } catch (error) {
    console.warn('[analytics] Failed to record event', error.message);
  }
};

const listAnalytics = async ({ slug, days = 30 }) => {
  if (!slug) throw new Error('slug is required');
  const client = getClient();
  const result = await client
    .query({
      TableName: TABLE_NAME,
      KeyConditionExpression: '#slug = :slug',
      ExpressionAttributeNames: { '#slug': 'slug' },
      ExpressionAttributeValues: { ':slug': slug },
      ScanIndexForward: false,
      Limit: days,
    })
    .promise();
  return result.Items || [];
};

const buildAlerts = (records) => {
  if (!records?.length) return ['No analytics data yet.'];
  const alerts = [];
  const totalLeads = records.reduce((sum, r) => sum + (r.leadCount || 0), 0);
  const totalViews = records.reduce((sum, r) => sum + (r.pageViewCount || 0), 0);
  if (totalViews === 0) {
    alerts.push('Your site has not received any visits yet.');
  }
  if (totalLeads === 0 && records.length >= 7) {
    alerts.push('No leads captured in the last week.');
  }
  if (totalLeads > 0 && totalViews > 0) {
    const conversion = (totalLeads / totalViews) * 100;
    if (conversion < 1) {
      alerts.push('Lead conversion is under 1%. Consider improving CTAs.');
    }
  }
  return alerts.length ? alerts : ['Traffic and leads look healthy.'];
};

module.exports = {
  recordAnalyticsEvent,
  listAnalytics,
  buildAlerts,
};
