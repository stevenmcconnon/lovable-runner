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

const markEditJobRunning = async ({ jobId, editRequestId }) => {
  try {
    await db.updateJob(jobId, {
      status: 'running',
      errorMessage: null,
    });
    if (editRequestId) {
      await db.updateEditRequestStatus(editRequestId, 'in_progress', jobId);
    }
  } catch (err) {
    console.warn('[runner] Failed to mark edit job running', { jobId, err: err?.message });
  }
};

const markEditJobCompleted = async ({ jobId, editRequestId, s3Key, previewUrl, lovableProjectId }) => {
  try {
    await db.updateJob(jobId, {
      status: 'completed',
      s3Key,
      previewUrl,
      lovableProjectId,
    });
    if (editRequestId) {
      await db.updateEditRequestStatus(editRequestId, 'completed', jobId);
    }
  } catch (err) {
    console.warn('[runner] Failed to mark edit job completed', { jobId, err: err?.message });
  }
};

const markEditJobFailed = async ({ jobId, editRequestId, errorMessage }) => {
  try {
    await db.updateJob(jobId, {
      status: 'failed',
      errorMessage,
    });
    if (editRequestId) {
      await db.updateEditRequestStatus(editRequestId, 'rejected', jobId);
    }
  } catch (err) {
    console.warn('[runner] Failed to mark edit job failed', { jobId, err: err?.message });
  }
};

const handleEditRequestJob = async (event) => {
  const referenceUrl = buildReferenceUrl(event);
  const businessDetails = event.businessDetails || event.business || null;
    const description = event.description || '';
    const jobId = event.jobId || event.id;
    await markEditJobRunning({ jobId, editRequestId: event.editRequestId });

    console.log('[runner] Starting edit job', { jobId, referenceUrl });
    try {
    const result = await runLaunch({
      url: referenceUrl,
      description,
      businessDetails,
      requestId: jobId,
    });
    const s3Key = result.prefix ? `${result.prefix}/` : '';
    const previewUrl = result.contentUrl;
    await markEditJobCompleted({
      jobId,
      editRequestId: event.editRequestId,
      s3Key,
      previewUrl,
      lovableProjectId: result.lovableProjectId || null,
    });
    console.log('[runner] Edit job completed', { jobId, s3Key, previewUrl });
    return {
      jobId,
      status: 'completed',
      ...result,
      s3Key,
      previewUrl,
    };
  } catch (error) {
    await markEditJobFailed({
      jobId,
      editRequestId: event.editRequestId,
      errorMessage: error?.message || 'Generation failed',
    });
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
      publicUrl: result.contentUrl,
      templateUrl: result.templateUrl,
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
