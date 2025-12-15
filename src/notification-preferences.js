const AWS = require('aws-sdk');

const TABLE_NAME =
  process.env.NOTIFICATION_PREFS_TABLE ||
  process.env.SITE_NOTIFICATION_PREFS_TABLE ||
  process.env.LOVABLE_NOTIFICATION_PREFS_TABLE;

const getClient = () => {
  if (!TABLE_NAME) {
    throw new Error('NOTIFICATION_PREFS_TABLE environment variable is not set.');
  }
  if (!AWS.config.region && process.env.AWS_REGION) {
    AWS.config.update({ region: process.env.AWS_REGION });
  }
  return new AWS.DynamoDB.DocumentClient();
};

const defaultPreferences = () => ({
  contact: true,
  booking: true,
  newsletter: false,
  productUpdates: true,
});

const normalizePrefs = (prefs = {}) => {
  const defaults = defaultPreferences();
  return Object.keys(defaults).reduce((acc, key) => {
    acc[key] =
      prefs[key] === undefined ? defaults[key] : Boolean(prefs[key]);
    return acc;
  }, {});
};

const getPreferences = async ({ slug, recipient }) => {
  if (!slug || !recipient) {
    throw new Error('slug and recipient are required');
  }
  const docClient = getClient();
  const result = await docClient
    .get({
      TableName: TABLE_NAME,
      Key: { slug, recipient },
    })
    .promise();
  if (!result.Item) {
    return {
      slug,
      recipient,
      preferences: defaultPreferences(),
    };
  }
  return {
    slug,
    recipient,
    preferences: normalizePrefs(result.Item.preferences || {}),
    updatedAt: result.Item.updatedAt,
  };
};

const savePreferences = async ({ slug, recipient, preferences, unsubscribeAll }) => {
  if (!slug || !recipient) {
    throw new Error('slug and recipient are required');
  }
  const docClient = getClient();
  const normalized = unsubscribeAll
    ? Object.keys(defaultPreferences()).reduce((acc, key) => {
        acc[key] = false;
        return acc;
      }, {})
    : normalizePrefs(preferences);
  const timestamp = new Date().toISOString();
  await docClient
    .put({
      TableName: TABLE_NAME,
      Item: {
        slug,
        recipient,
        preferences: normalized,
        updatedAt: timestamp,
      },
    })
    .promise();
  return { slug, recipient, preferences: normalized, updatedAt: timestamp };
};

module.exports = {
  getPreferences,
  savePreferences,
  defaultPreferences,
};
