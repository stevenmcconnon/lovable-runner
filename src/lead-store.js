const { PutCommand, QueryCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { dynamoDocumentClient } = require('./aws-clients');
const { randomUUID } = require('crypto');

const TABLE_NAME =
  process.env.LEAD_INBOX_TABLE ||
  process.env.LEAD_INBOX_TABLE_NAME ||
  process.env.LEADS_TABLE_NAME ||
  process.env.LOVABLE_LEADS_TABLE;

const ttlDays = (() => {
  const parsed = Number(process.env.LEAD_TTL_DAYS || 180);
  if (!Number.isFinite(parsed) || parsed <= 0) return 180;
  return Math.min(Math.floor(parsed), 730);
})();

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
  const ttl = Math.floor(Date.now() / 1000) + ttlDays * 24 * 60 * 60;
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
    ttl,
  };
};

const saveLeadSubmission = async (params) => {
  const client = getClient();
  const item = buildLeadItem(params);
  await client.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
      ConditionExpression: 'attribute_not_exists(#leadId)',
      ExpressionAttributeNames: {
        '#leadId': 'leadId',
      },
    })
  );
  return item;
};

const listLeadsBySlug = async ({ slug, limit = 25, lastKey, status, accountId }) => {
  const client = getClient();
  const usingAccountIndex = Boolean(accountId);
  const query = usingAccountIndex
    ? {
        TableName: TABLE_NAME,
        IndexName: 'account-createdAt',
        KeyConditionExpression: '#accountId = :accountId',
        ExpressionAttributeNames: {
          '#accountId': 'accountId',
        },
        ExpressionAttributeValues: {
          ':accountId': accountId,
        },
        ScanIndexForward: false,
        Limit: limit,
      }
    : {
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
  const updateParams = {
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
  };
  if (accountId) {
    updateParams.ConditionExpression = 'attribute_not_exists(#accountId) OR #accountId = :accountId';
  }
  await client.send(new UpdateCommand(updateParams));
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
  const params = {
    TableName: TABLE_NAME,
    Key: { slug, leadId },
    UpdateExpression: `SET ${expressions.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
  if (accountId) {
    params.ConditionExpression = 'attribute_not_exists(#accountId) OR #accountId = :accountId';
  }
  await client.send(new UpdateCommand(params));
};

module.exports = {
  saveLeadSubmission,
  listLeadsBySlug,
  getLeadRecord,
  appendLeadMessage,
  updateLeadStatus,
};
