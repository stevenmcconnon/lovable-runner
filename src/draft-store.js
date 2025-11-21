const AWS = require('aws-sdk');

const TABLE_NAME =
  process.env.LOVABLE_DRAFTS_TABLE ||
  process.env.DRAFTS_TABLE_NAME ||
  process.env.DYNAMODB_DRAFTS_TABLE;

const getDocumentClient = () => {
  if (!TABLE_NAME) {
    throw new Error('LOVABLE_DRAFTS_TABLE environment variable is not set.');
  }
  if (!AWS.config.region && process.env.AWS_REGION) {
    AWS.config.update({ region: process.env.AWS_REGION });
  }
  return new AWS.DynamoDB.DocumentClient();
};

const putDraftRecord = async (item) => {
  const docClient = getDocumentClient();
  await docClient
    .put({
      TableName: TABLE_NAME,
      Item: item,
    })
    .promise();
  return item;
};

const updateDraftStatus = async ({ projectId, draftId, status, message, metadata }) => {
  const docClient = getDocumentClient();
  const updateExpressions = [];
  const expressionAttributeNames = {};
  const expressionAttributeValues = {};

  if (status) {
    updateExpressions.push('#status = :status');
    expressionAttributeNames['#status'] = 'status';
    expressionAttributeValues[':status'] = status;
  }

  if (message !== undefined) {
    updateExpressions.push('#message = :message');
    expressionAttributeNames['#message'] = 'message';
    expressionAttributeValues[':message'] = message;
  }

  if (metadata !== undefined) {
    updateExpressions.push('#metadata = :metadata');
    expressionAttributeNames['#metadata'] = 'metadata';
    expressionAttributeValues[':metadata'] = metadata;
  }

  if (!updateExpressions.length) return;

  await docClient
    .update({
      TableName: TABLE_NAME,
      Key: { projectId, draftId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    })
    .promise();
};

const getDraftRecord = async ({ projectId, draftId }) => {
  const docClient = getDocumentClient();
  const result = await docClient
    .get({
      TableName: TABLE_NAME,
      Key: { projectId, draftId },
    })
    .promise();
  return result.Item || null;
};

const listDraftsForProject = async ({ projectId, limit = 20 }) => {
  const docClient = getDocumentClient();
  const result = await docClient
    .query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'projectId = :projectId',
      ExpressionAttributeValues: {
        ':projectId': projectId,
      },
      ScanIndexForward: false,
      Limit: limit,
    })
    .promise();
  return result.Items || [];
};

module.exports = {
  putDraftRecord,
  updateDraftStatus,
  getDraftRecord,
  listDraftsForProject,
};
