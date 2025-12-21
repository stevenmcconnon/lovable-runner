const AWS = require('aws-sdk');
const { query } = require('./pg-client');

const MAX_ATTEMPTS = Number(process.env.NOTIFICATION_MAX_ATTEMPTS || 5);
const NOTIFICATION_QUEUE_URL =
  process.env.NOTIFICATION_JOB_QUEUE_URL || process.env.RUNNER_QUEUE_URL || '';
const notificationQueue =
  NOTIFICATION_QUEUE_URL && AWS.SQS
    ? new AWS.SQS({
        region: process.env.AWS_REGION,
      })
    : null;

const parseJsonValue = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      return null;
    }
  }
  return null;
};

const parseCcList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  const parsed = parseJsonValue(value);
  return Array.isArray(parsed) ? parsed : [];
};

const mapJobRow = (row = {}) => ({
  id: row.id,
  slug: row.slug,
  recipient: row.recipient,
  template: row.template,
  subject: row.subject,
  bodyText: row.body_text || null,
  bodyHtml: row.body_html || null,
  replyTo: row.reply_to || null,
  cc: parseCcList(row.cc),
  metadata: parseJsonValue(row.metadata),
  status: row.status,
  attemptCount: Number(row.attempt_count || 0),
  lastError: row.last_error || null,
});

const ensureArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  return [String(value).trim()].filter(Boolean);
};

const dispatchNotificationJob = async (jobId, delayMs = 0) => {
  if (!jobId || !notificationQueue || !NOTIFICATION_QUEUE_URL) return;
  const delaySeconds = delayMs > 0 ? Math.min(900, Math.max(0, Math.round(delayMs / 1000))) : 0;
  await notificationQueue
    .sendMessage({
      QueueUrl: NOTIFICATION_QUEUE_URL,
      MessageBody: JSON.stringify({
        action: 'RUN_NOTIFICATION_JOB',
        jobId,
      }),
      DelaySeconds: delaySeconds,
    })
    .promise();
};

const enqueueNotificationJob = async ({
  slug,
  recipient,
  template,
  subject,
  bodyText,
  bodyHtml,
  replyTo,
  cc,
  metadata,
  dedupeKey,
}) => {
  if (!slug || !recipient || !template || !subject) {
    throw new Error('slug, recipient, template, and subject are required for notification jobs.');
  }
  const ccList = ensureArray(cc);
  const payload = metadata ? JSON.stringify(metadata) : null;
  const dedupe = dedupeKey ? String(dedupeKey) : null;
  const params = [
    slug,
    recipient.toLowerCase().trim(),
    template,
    subject,
    bodyText || null,
    bodyHtml || null,
    replyTo || null,
    ccList.length ? JSON.stringify(ccList) : null,
    payload,
    dedupe,
  ];
  const statement = `
    INSERT INTO notification_jobs (
      slug,
      recipient,
      template,
      subject,
      body_text,
      body_html,
      reply_to,
      cc,
      metadata,
      dedupe_key,
      status,
      next_attempt_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',NOW())
    ON CONFLICT (dedupe_key)
    DO UPDATE SET
      subject = EXCLUDED.subject,
      body_text = EXCLUDED.body_text,
      body_html = EXCLUDED.body_html,
      reply_to = EXCLUDED.reply_to,
      cc = EXCLUDED.cc,
      metadata = EXCLUDED.metadata,
      status = 'pending',
      attempt_count = 0,
      last_error = NULL,
      next_attempt_at = NOW(),
      updated_at = NOW()
    RETURNING *;
  `;
  const result = await query(statement, params);
  const job = mapJobRow(result.rows[0]);
  await dispatchNotificationJob(job.id);
  return job;
};

const claimNotificationJobs = async ({ limit = 10 } = {}) => {
  const statement = `
    WITH due_jobs AS (
      SELECT id
      FROM notification_jobs
      WHERE status IN ('pending', 'retrying')
        AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
      ORDER BY next_attempt_at ASC NULLS FIRST, created_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE notification_jobs j
    SET status = 'sending',
        attempt_count = j.attempt_count + 1,
        updated_at = NOW()
    FROM due_jobs
    WHERE j.id = due_jobs.id
    RETURNING j.*;
  `;
  const result = await query(statement, [limit]);
  return (result.rows || []).map(mapJobRow);
};

const markNotificationJobSent = async (jobId) => {
  await query(
    `
    UPDATE notification_jobs
    SET status = 'sent',
        sent_at = NOW(),
        last_error = NULL,
        updated_at = NOW()
    WHERE id = $1
  `,
    [jobId]
  );
};

const computeNextAttempt = (attempts) => {
  const backoffMinutes = Math.min(60, Math.pow(2, Math.min(attempts, 5)));
  const next = new Date(Date.now() + backoffMinutes * 60 * 1000);
  return next.toISOString();
};

const markNotificationJobFailed = async ({ jobId, attemptCount, error }) => {
  const maxAttempts = MAX_ATTEMPTS > 0 ? MAX_ATTEMPTS : 5;
  const exhausted = attemptCount >= maxAttempts;
  const nextAttempt = exhausted ? null : computeNextAttempt(attemptCount);
  await query(
    `
    UPDATE notification_jobs
    SET status = $2,
        last_error = $3,
        next_attempt_at = $4,
        updated_at = NOW()
    WHERE id = $1
  `,
    [jobId, exhausted ? 'failed' : 'retrying', error ? error.slice(0, 500) : null, nextAttempt]
  );
  if (!exhausted && nextAttempt) {
    const delayMs = Math.max(0, Date.parse(nextAttempt) - Date.now());
    await dispatchNotificationJob(jobId, delayMs);
  }
};

const claimNotificationJobById = async (jobId) => {
  const statement = `
    UPDATE notification_jobs
    SET status = 'sending',
        attempt_count = notification_jobs.attempt_count + 1,
        updated_at = NOW()
    WHERE id = $1
      AND status IN ('pending', 'retrying')
      AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
    RETURNING *;
  `;
  const result = await query(statement, [jobId]);
  return result.rows && result.rows[0] ? mapJobRow(result.rows[0]) : null;
};

module.exports = {
  enqueueNotificationJob,
  claimNotificationJobs,
  claimNotificationJobById,
  markNotificationJobSent,
  markNotificationJobFailed,
};
