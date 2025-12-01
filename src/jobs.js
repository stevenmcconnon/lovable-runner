const { runLaunch } = require('./launch');
const { recordLaunchStatus } = require('./launch-tracker');
const { DatabaseService } = require('./dist/services/database');

const db = new DatabaseService();

const buildReferenceUrl = (event) => {
  if (event.url) return event.url;
  if (event.referenceUrl) return event.referenceUrl;
  if (event.siteId && typeof event.siteId === 'string' && event.siteId.startsWith('http')) {
    return event.siteId;
  }
  return null;
};

const updateSiteGeneration = async (requestId, updates) => {
  try {
    await db.updateSiteGeneration(requestId, updates);
  } catch (error) {
    console.warn('Failed to update site generation status', error.message);
  }
};

const postSiteLaunchStage = async (requestId, status) => {
  await postSiteLaunchUpdate(requestId, 'stage', { status });
};

const handleEditRequestJob = async (event) => {
  const referenceUrl = buildReferenceUrl(event);
  const businessDetails = event.businessDetails || event.business || null;
  const description = event.description || '';
  const jobId = event.jobId || event.id;

  console.log('[runner] Starting edit job', { jobId, referenceUrl });
  try {
    const result = await runLaunch({
      url: referenceUrl,
      description,
      businessDetails,
      requestId: jobId,
    });
    const s3Key = result.prefix ? `${result.prefix}/` : '';
    const previewUrl = `${result.publicUrl}index.html`;
    console.log('[runner] Edit job completed', { jobId, s3Key, previewUrl });
    return {
      jobId,
      status: 'completed',
      ...result,
      s3Key,
      previewUrl,
    };
  } catch (error) {
    console.error('[runner] Edit job failed', { jobId, err: error });
    throw error;
  }
};

const handleSiteLaunchJob = async (event) => {
  const referenceUrl = buildReferenceUrl(event);
  const businessDetails = event.businessDetails || event.business || null;
  const description = event.description || '';
  const requestId = event.requestId;
  const testMode = Boolean(event.testMode);
  if (!requestId) {
    throw new Error('requestId is required for site launch jobs');
  }
  const reportStage = async (stage) => {
    await updateSiteGeneration(requestId, { status: stage });
    await recordLaunchStatus({ requestId, status: stage });
  };
  await reportStage('running');
  console.log('[runner] Site launch running', { requestId, referenceUrl });
  try {
    const result = await runLaunch({
      url: referenceUrl,
      description,
      businessDetails,
      requestId,
      testMode,
      onProgress: reportStage,
    });
    const payload = {
      bucket: result.bucket,
      prefix: result.prefix,
      slug: result.slug,
      publicUrl: result.publicUrl,
    };
    await updateSiteGeneration(requestId, {
      status: 'completed',
      bucket: payload.bucket,
      prefix: payload.prefix,
      slug: payload.slug,
      publicUrl: payload.publicUrl,
    });
    await recordLaunchStatus({ requestId, status: 'completed', result });
    console.log('[runner] Site launch completed', { requestId, bucket: payload.bucket, prefix: payload.prefix });
    return {
      requestId,
      status: 'completed',
      ...result,
    };
  } catch (error) {
    console.error('[runner] Site launch failed', { requestId, err: error });
    await updateSiteGeneration(requestId, {
      status: 'failed',
      errorMessage: error.message || 'Generation failed',
    });
    await recordLaunchStatus({ requestId, status: 'failed', error });
    throw error;
  }
};

module.exports = { handleEditRequestJob, handleSiteLaunchJob };
    await db.updateSiteGeneration(requestId, {
      status: 'completed',
      bucket: result.bucket,
      prefix: result.prefix,
      slug: result.slug,
      publicUrl: result.publicUrl,
    });
