const { PutCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { dynamoDocumentClient } = require('./aws-clients');
const { randomUUID } = require('crypto');

const TABLE_NAME =
  process.env.SITE_REVIEWS_TABLE ||
  process.env.REVIEWS_TABLE_NAME ||
  process.env.LOVABLE_REVIEWS_TABLE;

const getClient = () => {
  if (!TABLE_NAME) {
    throw new Error('SITE_REVIEWS_TABLE environment variable is not set.');
  }
  return dynamoDocumentClient;
};

const saveReview = async ({ slug, authorName, rating, body, source, status, contact, accountId }) => {
  const client = getClient();
  const timestamp = new Date().toISOString();
  const item = {
    accountId: accountId || null,
    slug,
    reviewId: `${timestamp}#${randomUUID()}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: status || 'pending',
    authorName,
    rating: typeof rating === 'number' ? rating : null,
    body,
    source: source || 'manual',
    contact,
  };
  await client.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
    })
  );
  return item;
};

const listReviews = async ({ slug, status = 'approved', limit = 20, accountId }) => {
  const client = getClient();
  const result = await client.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: '#slug = :slug',
      ExpressionAttributeNames: { '#slug': 'slug' },
      ExpressionAttributeValues: { ':slug': slug },
      ScanIndexForward: false,
      Limit: limit,
    })
  );
  const items = result.Items || [];
  const filtered = accountId
    ? items.filter((item) => !item.accountId || item.accountId === accountId)
    : items;
  return status ? filtered.filter((item) => item.status === status) : filtered;
};

const updateReviewStatus = async ({ slug, reviewId, status, accountId }) => {
  const client = getClient();
  const accountCondition = accountId
    ? 'attribute_not_exists(#accountId) OR #accountId = :accountId'
    : null;
  await client.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { slug, reviewId },
      UpdateExpression:
        'SET #status = :status, #updatedAt = :now' +
        (accountId ? ', #accountId = if_not_exists(#accountId, :accountId)' : ''),
      ConditionExpression: accountCondition || undefined,
      ExpressionAttributeNames: {
        '#status': 'status',
        '#updatedAt': 'updatedAt',
        ...(accountId ? { '#accountId': 'accountId' } : {}),
      },
      ExpressionAttributeValues: {
        ':status': status,
        ':now': new Date().toISOString(),
        ...(accountId ? { ':accountId': accountId } : {}),
      },
    })
  );
};

module.exports = {
  saveReview,
  listReviews,
  updateReviewStatus,
};
