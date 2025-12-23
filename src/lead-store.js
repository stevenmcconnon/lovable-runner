const { PutCommand, QueryCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { dynamoDocumentClient } = require('./aws-clients');
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
  return dynamoDocumentClient;
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
  accountId,
}) => {
  const timestamp = new Date().toISOString();
  return {
    accountId: accountId || null,
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
  await client.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
    })
  );
  return item;
};

const listLeadsBySlug = async ({ slug, limit = 25, lastKey, status, accountId }) => {
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
  const accountFilter = accountId
    ? '(#accountId = :accountId OR attribute_not_exists(#accountId))'
    : null;
  if (accountFilter) {
    query.FilterExpression = query.FilterExpression
      ? `${query.FilterExpression} AND ${accountFilter}`
      : accountFilter;
    query.ExpressionAttributeNames['#accountId'] = 'accountId';
    query.ExpressionAttributeValues[':accountId'] = accountId;
  }
  if (lastKey) {
    query.ExclusiveStartKey = lastKey;
  }
  const result = await client.send(new QueryCommand(query));
  return {
    items: result.Items || [],
    nextToken: result.LastEvaluatedKey || null,
  };
};

const getLeadRecord = async ({ slug, leadId, accountId }) => {
  const client = getClient();
  const result = await client.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { slug, leadId },
    })
  );
  const item = result.Item || null;
  if (!item) return null;
  if (accountId && item.accountId && item.accountId !== accountId) return null;
  return item;
};

const appendLeadMessage = async ({ slug, leadId, message, accountId }) => {
  const client = getClient();
  const timestamp = new Date().toISOString();
  const messageEntry = {
    messageId: message.messageId || randomUUID(),
    createdAt: timestamp,
    ...message,
  };
  await client.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { slug, leadId },
      UpdateExpression:
        'SET #messages = list_append(if_not_exists(#messages, :emptyList), :message), #updatedAt = :now, #status = :status'
        + (accountId ? ', #accountId = if_not_exists(#accountId, :accountId)' : ''),
      ExpressionAttributeNames: {
        '#messages': 'messages',
        '#updatedAt': 'updatedAt',
        '#status': 'status',
        ...(accountId ? { '#accountId': 'accountId' } : {}),
      },
      ExpressionAttributeValues: {
        ':message': [messageEntry],
        ':emptyList': [],
        ':now': timestamp,
        ':status': message.status || 'open',
        ...(accountId ? { ':accountId': accountId } : {}),
      },
    })
  );
  return messageEntry;
};

const updateLeadStatus = async ({ slug, leadId, status, followUpAt, accountId }) => {
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
  if (accountId) {
    expressions.push('#accountId = if_not_exists(#accountId, :accountId)');
    names['#accountId'] = 'accountId';
    values[':accountId'] = accountId;
  }
  await client.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { slug, leadId },
      UpdateExpression: `SET ${expressions.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  );
};

module.exports = {
  saveLeadSubmission,
  listLeadsBySlug,
  getLeadRecord,
  appendLeadMessage,
  updateLeadStatus,
};
