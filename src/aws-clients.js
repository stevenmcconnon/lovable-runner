const { S3Client } = require('@aws-sdk/client-s3');
const { SQSClient } = require('@aws-sdk/client-sqs');
const { SESClient } = require('@aws-sdk/client-ses');
const { KMSClient } = require('@aws-sdk/client-kms');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const region = process.env.AWS_REGION;
const clientConfig = region ? { region } : {};

const dynamoDocumentClient = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig), {
  marshallOptions: { removeUndefinedValues: true },
});

module.exports = {
  region,
  clientConfig,
  s3Client: new S3Client(clientConfig),
  sqsClient: new SQSClient(clientConfig),
  sesClient: new SESClient(clientConfig),
  kmsClient: new KMSClient(clientConfig),
  dynamoDocumentClient,
};
