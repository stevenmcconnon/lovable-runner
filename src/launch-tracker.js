const AWS = require('aws-sdk');

const resolveStatusBucket = () =>
  process.env.LAUNCH_STATUS_BUCKET ||
  process.env.LOVABLE_DEPLOY_BUCKET ||
  process.env.DEPLOY_BUCKET ||
  process.env.TEMPLATE_UPLOAD_BUCKET ||
  null;

const s3 = new AWS.S3();

const recordLaunchStatus = async ({ requestId, status, result, error }) => {
  if (!requestId) return;
  const bucket = resolveStatusBucket();
  if (!bucket) return;
  const key = `site-builds/status/${requestId}.json`;
  const payload = {
    requestId,
    status,
    updatedAt: new Date().toISOString(),
    result: status === 'completed' ? result : undefined,
    error: status === 'failed' ? error?.message || String(error) : undefined,
  };
  try {
    await s3
      .putObject({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(payload, null, 2),
        ContentType: 'application/json',
      })
      .promise();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Failed to record launch status', err.message);
  }
};

module.exports = { recordLaunchStatus };
