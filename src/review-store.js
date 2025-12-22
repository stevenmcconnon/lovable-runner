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

const saveReview = async ({ slug, authorName, rating, body, source, status, contact }) => {
  const client = getClient();
  const timestamp = new Date().toISOString();
  const item = {
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

const listReviews = async ({ slug, status = 'approved', limit = 20 }) => {
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
  return status ? items.filter((item) => item.status === status) : items;
};

const updateReviewStatus = async ({ slug, reviewId, status }) => {
  const client = getClient();
  await client.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { slug, reviewId },
      UpdateExpression: 'SET #status = :status, #updatedAt = :now',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':status': status,
        ':now': new Date().toISOString(),
      },
    })
  );
};

module.exports = {
  saveReview,
  listReviews,
  updateReviewStatus,
};
