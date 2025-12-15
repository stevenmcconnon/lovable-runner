const AWS = require('aws-sdk');
const { randomUUID } = require('crypto');

const TABLE_NAME =
  process.env.SITE_REVIEWS_TABLE ||
  process.env.REVIEWS_TABLE_NAME ||
  process.env.LOVABLE_REVIEWS_TABLE;

const getClient = () => {
  if (!TABLE_NAME) {
    throw new Error('SITE_REVIEWS_TABLE environment variable is not set.');
  }
  if (!AWS.config.region && process.env.AWS_REGION) {
    AWS.config.update({ region: process.env.AWS_REGION });
  }
  return new AWS.DynamoDB.DocumentClient();
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
  await client
    .put({
      TableName: TABLE_NAME,
      Item: item,
    })
    .promise();
  return item;
};

const listReviews = async ({ slug, status = 'approved', limit = 20 }) => {
  const client = getClient();
  const result = await client
    .query({
      TableName: TABLE_NAME,
      KeyConditionExpression: '#slug = :slug',
      ExpressionAttributeNames: { '#slug': 'slug' },
      ExpressionAttributeValues: { ':slug': slug },
      ScanIndexForward: false,
      Limit: limit,
    })
    .promise();
  const items = result.Items || [];
  return status ? items.filter((item) => item.status === status) : items;
};

const updateReviewStatus = async ({ slug, reviewId, status }) => {
  const client = getClient();
  await client
    .update({
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
    .promise();
};

module.exports = {
  saveReview,
  listReviews,
  updateReviewStatus,
};
