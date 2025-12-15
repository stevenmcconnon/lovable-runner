const AWS = require('aws-sdk');
const { randomUUID } = require('crypto');
const { CONTACT_FROM_EMAIL } = require('./email-config');
const {
  saveLeadSubmission,
  listLeadsBySlug,
  getLeadRecord,
  appendLeadMessage,
  updateLeadStatus,
} = require('./lead-store');
const { recordAnalyticsEvent } = require('./analytics');

const ses = new AWS.SES();

const captureLeadSubmission = async (payload) => {
  try {
    const record = await saveLeadSubmission(payload);
    await recordAnalyticsEvent({
      slug: payload.slug,
      type: payload.intent === 'booking' ? 'booking' : 'lead',
    });
    return record;
  } catch (error) {
    console.warn('[leads] Failed to persist incoming submission', error?.message);
    return null;
  }
};

const ensureReplyAuthorization = (lead, { targetEmail }) => {
  if (!lead) {
    const error = new Error('Lead not found');
    error.statusCode = 404;
    throw error;
  }
  if (!lead.replyTo) {
    const error = new Error('This lead did not include a reply-to email.');
    error.statusCode = 400;
    throw error;
  }
  if (targetEmail && lead.targetEmail && targetEmail !== lead.targetEmail) {
    const error = new Error('You are not allowed to respond to this lead.');
    error.statusCode = 403;
    throw error;
  }
};

const sendLeadReply = async ({ slug, leadId, message, subject, sender }) => {
  const lead = await getLeadRecord({ slug, leadId });
  ensureReplyAuthorization(lead, sender || {});
  const now = new Date().toISOString();
  const ownerEmail = lead.targetEmail;
  const replyBody = [
    message,
    '',
    '----',
    'Original request:',
    lead.fields
      .map(
        (field) =>
          `${field.label || field.name || 'Field'}: ${
            Array.isArray(field.value) ? field.value.join(', ') : field.value
          }`
      )
      .join('\n'),
  ].join('\n');

  await ses
    .sendEmail({
      Source: CONTACT_FROM_EMAIL,
      Destination: {
        ToAddresses: [lead.replyTo],
        CcAddresses: ownerEmail ? [ownerEmail] : undefined,
      },
      ReplyToAddresses: ownerEmail ? [ownerEmail] : undefined,
      Message: {
        Subject: {
          Data: subject || `Re: ${lead.intent === 'booking' ? 'Booking' : 'Website'} inquiry`,
          Charset: 'UTF-8',
        },
        Body: {
          Text: { Data: replyBody, Charset: 'UTF-8' },
        },
      },
    })
    .promise();

  await appendLeadMessage({
    slug,
    leadId,
    message: {
      messageId: randomUUID(),
      direction: 'outbound',
      channel: 'email',
      body: message,
      status: 'responded',
    },
  });

  await updateLeadStatus({
    slug,
    leadId,
    status: 'responded',
    followUpAt: null,
  });

  console.log('[leads] reply sent', { slug, leadId, replyTo: lead.replyTo, ownerEmail });
  return { ok: true };
};

const listLeads = async ({ slug, limit, status, cursor }) => {
  if (!slug) {
    throw new Error('slug is required');
  }
  return listLeadsBySlug({ slug, limit, status, lastKey: cursor || undefined });
};

const markLeadStatus = async ({ slug, leadId, status, followUpAt }) => {
  if (!slug || !leadId) {
    const error = new Error('slug and leadId are required');
    error.statusCode = 400;
    throw error;
  }
  await updateLeadStatus({ slug, leadId, status, followUpAt });
  return { slug, leadId, status, followUpAt };
};

module.exports = {
  captureLeadSubmission,
  listLeads,
  sendLeadReply,
  markLeadStatus,
};
