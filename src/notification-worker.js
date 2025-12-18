const AWS = require('aws-sdk');
const crypto = require('node:crypto');
const { CONTACT_FROM_EMAIL } = require('./email-config');
const {
  claimNotificationJobs,
  markNotificationJobSent,
  markNotificationJobFailed,
} = require('./notification-jobs');
const { closePool } = require('./pg-client');
const { recordJobEvent } = require('./audit-log');
const MAX_ATTEMPTS = Number(process.env.NOTIFICATION_MAX_ATTEMPTS || 5);

const buildEmailParams = (job) => {
  const destination = {
    ToAddresses: [job.recipient],
  };
  const ccList = Array.isArray(job.cc) ? job.cc.filter(Boolean) : [];
  if (ccList.length) {
    destination.CcAddresses = ccList;
  }
  const body = {};
  if (job.bodyHtml) {
    body.Html = { Data: job.bodyHtml, Charset: 'UTF-8' };
  }
  if (job.bodyText || !job.bodyHtml) {
    body.Text = { Data: job.bodyText || job.bodyHtml || '', Charset: 'UTF-8' };
  }
  const message = {
    Subject: { Data: job.subject, Charset: 'UTF-8' },
    Body: body,
  };
  const params = {
    Source: CONTACT_FROM_EMAIL,
    Destination: destination,
    Message: message,
  };
  if (job.replyTo) {
    params.ReplyToAddresses = [job.replyTo];
  }
  return params;
};

const runNotificationBatch = async ({
  limit = Number(process.env.NOTIFICATION_BATCH_LIMIT || 25),
  dryRun = false,
  logger = console,
  autoClosePool = true,
} = {}) => {
  const ses = new AWS.SES();
  const jobs = await claimNotificationJobs({ limit });
  if (!jobs.length) {
    logger.log('[notifications] No jobs ready to send.');
    if (autoClosePool) {
      await closePool().catch(() => undefined);
    }
    return { claimed: 0, sent: 0, failed: 0 };
  }
  logger.log(`[notifications] Sending ${jobs.length} job(s)...`);
  let sent = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await recordNotificationJobEvent(job, 'CLAIMED', 'sending', logger);
      if (dryRun) {
        logger.log(`[notifications] [dry-run] Would send ${job.id} to ${job.recipient}`);
      } else {
        const params = buildEmailParams(job);
        // eslint-disable-next-line no-await-in-loop
        await ses.sendEmail(params).promise();
      }
      // eslint-disable-next-line no-await-in-loop
      await markNotificationJobSent(job.id);
      await recordNotificationJobEvent(job, 'SENT', 'sent', logger);
      sent += 1;
    } catch (error) {
      failed += 1;
      logger.error(`[notifications] Job ${job.id} failed: ${error.message}`);
      // eslint-disable-next-line no-await-in-loop
      await markNotificationJobFailed({
        jobId: job.id,
        attemptCount: job.attemptCount,
        error: error.message || 'Unknown error',
      });
      await recordNotificationJobEvent(job, 'FAILED', job.attemptCount + 1 >= MAX_ATTEMPTS ? 'failed' : 'retrying', logger, {
        error: error.message || 'Unknown error',
      });
    }
  }
  if (autoClosePool) {
    await closePool().catch(() => undefined);
  }
  return { claimed: jobs.length, sent, failed };
};

const hashRecipient = (email = '') =>
  crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

const recordNotificationJobEvent = async (job, action, status, logger, metadata = {}) => {
  try {
    await recordJobEvent({
      type: 'notification_job',
      slug: job.slug ?? null,
      jobId: job.id,
      action,
      status,
      metadata: {
        template: job.template,
        recipientHash: hashRecipient(job.recipient),
        ...metadata,
      },
    });
  } catch (error) {
    logger.warn('[notifications] Failed to record job event', {
      jobId: job.id,
      action,
      err: error?.message,
    });
  }
};

module.exports = {
  runNotificationBatch,
};
