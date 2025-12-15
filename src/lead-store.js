const AWS = require('aws-sdk');
const { randomUUID } = require('crypto');

const TABLE_NAME =
  process.env.LEAD_INBOX_TABLE ||
  process.env.LEAD_INBOX_TABLE_NAME ||
  process.env.LEADS_TABLE_NAME ||
  process.env.LOVABLE_LEADS_TABLE;

const getClient = () => {
  if (!TABLE_NAME) {
    throw new Error('LEAD_INBOX_TABLE environment variable is not set.');
  }
  if (!AWS.config.region && process.env.AWS_REGION) {
    AWS.config.update({ region: process.env.AWS_REGION });
  }
  return new AWS.DynamoDB.DocumentClient();
};

const buildLeadItem = ({
  slug,
  sectionId,
  targetEmail,
  replyTo,
  fields,
  sourceUrl,
  remoteAddress,
  userAgent,
  intent,
}) => {
  const timestamp = new Date().toISOString();
  return {
    slug,
    leadId: `${timestamp}#${randomUUID()}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: 'open',
    intent: intent || 'contact',
    sectionId: sectionId || null,
    targetEmail,
    replyTo,
    sourceUrl,
    remoteAddress,
    userAgent,
    fields,
    messages: [
      {
        messageId: randomUUID(),
        direction: 'inbound',
        channel: intent === 'booking' ? 'booking-request' : 'contact-form',
        body: fields
          .map((field) => `${field.label || field.name}: ${Array.isArray(field.value) ? field.value.join(', ') : field.value}`)
          .join('\n'),
        createdAt: timestamp,
      },
    ],
  };
};

const saveLeadSubmission = async (params) => {
  const client = getClient();
  const item = buildLeadItem(params);
  await client
    .put({
      TableName: TABLE_NAME,
      Item: item,
    })
    .promise();
  return item;
};

const listLeadsBySlug = async ({ slug, limit = 25, lastKey, status }) => {
  const client = getClient();
  const query = {
    TableName: TABLE_NAME,
    KeyConditionExpression: '#slug = :slug',
    ExpressionAttributeNames: {
      '#slug': 'slug',
    },
    ExpressionAttributeValues: {
      ':slug': slug,
    },
    ScanIndexForward: false,
    Limit: limit,
  };
  if (status) {
    query.FilterExpression = '#status = :status';
    query.ExpressionAttributeNames['#status'] = 'status';
    query.ExpressionAttributeValues[':status'] = status;
  }
  if (lastKey) {
    query.ExclusiveStartKey = lastKey;
  }
  const result = await client.query(query).promise();
  return {
    items: result.Items || [],
    nextToken: result.LastEvaluatedKey || null,
  };
};

const getLeadRecord = async ({ slug, leadId }) => {
  const client = getClient();
  const result = await client
    .get({
      TableName: TABLE_NAME,
      Key: { slug, leadId },
    })
    .promise();
  return result.Item || null;
};

const appendLeadMessage = async ({ slug, leadId, message }) => {
  const client = getClient();
  const timestamp = new Date().toISOString();
  const messageEntry = {
    messageId: message.messageId || randomUUID(),
    createdAt: timestamp,
    ...message,
  };
  await client
    .update({
      TableName: TABLE_NAME,
      Key: { slug, leadId },
      UpdateExpression:
        'SET #messages = list_append(if_not_exists(#messages, :emptyList), :message), #updatedAt = :now, #status = :status',
      ExpressionAttributeNames: {
        '#messages': 'messages',
        '#updatedAt': 'updatedAt',
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':message': [messageEntry],
        ':emptyList': [],
        ':now': timestamp,
        ':status': message.status || 'open',
      },
    })
    .promise();
  return messageEntry;
};

const updateLeadStatus = async ({ slug, leadId, status, followUpAt }) => {
  const client = getClient();
  const expressions = ['#updatedAt = :now'];
  const names = { '#updatedAt': 'updatedAt' };
  const values = { ':now': new Date().toISOString() };
  if (status) {
    expressions.push('#status = :status');
    names['#status'] = 'status';
    values[':status'] = status;
  }
  if (followUpAt !== undefined) {
    expressions.push('#followUpAt = :followUpAt');
    names['#followUpAt'] = 'followUpAt';
    values[':followUpAt'] = followUpAt || null;
  }
  await client
    .update({
      TableName: TABLE_NAME,
      Key: { slug, leadId },
      UpdateExpression: `SET ${expressions.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
    .promise();
};

module.exports = {
  saveLeadSubmission,
  listLeadsBySlug,
  getLeadRecord,
  appendLeadMessage,
  updateLeadStatus,
};
