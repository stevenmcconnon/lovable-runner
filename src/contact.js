const { loadSiteConfig } = require('./site-store');
const { captureLeadSubmission } = require('./leads');
const { createAppointment } = require('./appointments');
const { getPreferences } = require('./notification-preferences');
const { enqueueNotificationJob } = require('./notification-jobs');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const escapeHtml = (value = '') =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const collectSections = (site = {}) => {
  const sections = Array.isArray(site.sections) ? [...site.sections] : [];
  if (Array.isArray(site.pages)) {
    site.pages.forEach((page) => {
      if (Array.isArray(page.sections)) {
        sections.push(...page.sections);
      }
    });
  }
  return sections;
};

const extractContactEmail = ({ site, sectionId, contactEmailHint }) => {
  if (!site) return null;
  const sections = collectSections(site);
  const byId = sectionId
    ? sections.find(
        (section) =>
          section.componentId === 'contact-form' && section.id && section.id === sectionId
      )
    : null;
  const candidateEmail =
    byId?.props?.contactEmail ||
    sections.find((section) => section.componentId === 'contact-form' && section.props?.contactEmail)
      ?.props?.contactEmail ||
    contactEmailHint ||
    site.meta?.email;
  if (candidateEmail && EMAIL_REGEX.test(candidateEmail.trim())) {
    return candidateEmail.trim();
  }
  return null;
};

const formatFieldValue = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean).join(', ');
  }
  return String(value || '').trim();
};

const determineReplyTo = (fields = []) => {
  const entry = fields.find(
    (field) =>
      (field.type && field.type.toLowerCase() === 'email') ||
      (field.label && field.label.toLowerCase().includes('email'))
  );
  if (entry) {
    const value = Array.isArray(entry.value) ? entry.value[0] : entry.value;
    if (value && EMAIL_REGEX.test(String(value).trim())) {
      return String(value).trim();
    }
  }
  return null;
};

const buildEmailBodies = ({ brandName, slug, fields, sourceUrl }) => {
  const lines = fields.map((field) => {
    const label = field.label || field.name || 'Field';
    const value = formatFieldValue(field.value);
    return `${label}: ${value || '(blank)'}`;
  });
  const intro = [
    `New website inquiry for ${brandName || slug}`,
    `Source: ${sourceUrl || 'unknown'}`,
    '',
  ];
  const textBody = intro.concat(lines).join('\n');
  const htmlRows = fields
    .map(
      (field) =>
        `<tr><td style="padding:4px 0;font-weight:600;">${escapeHtml(field.label || field.name || 'Field')}</td><td style="padding:4px 0;">${escapeHtml(formatFieldValue(field.value) || '(blank)')}</td></tr>`
    )
    .join('');
  const htmlBody = `
    <div style="font-family:Inter,system-ui,sans-serif;font-size:14px;line-height:1.5;color:#111827;">
      <p style="margin:0 0 12px;">You have a new website inquiry for <strong>${escapeHtml(
        brandName || slug || 'your site'
      )}</strong>.</p>
      <p style="margin:0 0 12px;">Source: ${escapeHtml(sourceUrl || 'unknown')}</p>
      <table style="width:100%;border-collapse:collapse;">${htmlRows}</table>
    </div>
  `;
  return { textBody, htmlBody };
};

const shouldSendNotification = async ({ slug, targetEmail, intent }) => {
  try {
    const prefs = await getPreferences({
      slug,
      recipient: targetEmail,
    });
    if (!prefs?.preferences) return true;
    if (intent === 'booking') {
      return Boolean(prefs.preferences.booking);
    }
    return Boolean(prefs.preferences.contact);
  } catch (error) {
    console.warn('[contact] Failed to load notification preferences', error.message);
    return true;
  }
};

const submitContactMessage = async ({
  slug,
  sectionId,
  fields,
  contactEmailHint,
  sourceUrl,
  remoteAddress,
  userAgent,
  intent,
}) => {
  if (!slug) {
    const error = new Error('Missing slug');
    error.statusCode = 400;
    throw error;
  }
  const config = await loadSiteConfig(slug);
  if (!config?.site) {
    const error = new Error('Site not found');
    error.statusCode = 404;
    throw error;
  }
  const targetEmail = extractContactEmail({
    site: config.site,
    sectionId,
    contactEmailHint,
  });
  if (!targetEmail) {
    const error = new Error('Contact email is not configured for this site yet.');
    error.statusCode = 400;
    throw error;
  }
  const normalizedFields = Array.isArray(fields)
    ? fields
        .slice(0, 20)
        .map((field) => ({
          label: field.label ? String(field.label).slice(0, 120) : undefined,
          name: field.name ? String(field.name).slice(0, 120) : undefined,
          type: field.type || 'text',
          value: field.value,
        }))
    : [];
  if (!normalizedFields.length) {
    const error = new Error('No form fields were provided.');
    error.statusCode = 400;
    throw error;
  }
  const { textBody, htmlBody } = buildEmailBodies({
    brandName: config.site.meta?.brandName || slug,
    slug,
    fields: normalizedFields,
    sourceUrl,
  });
  const replyTo = determineReplyTo(normalizedFields);
  const subject =
    intent === 'booking'
      ? `[${config.site.meta?.brandName || slug}] Booking request`
      : `[${config.site.meta?.brandName || slug}] New website inquiry`;

  const shouldDeliver = await shouldSendNotification({
    slug,
    targetEmail,
    intent,
  });

  if (shouldDeliver) {
    const job = await enqueueNotificationJob({
      slug,
      recipient: targetEmail,
      template: intent === 'booking' ? 'booking-request' : 'contact-lead',
      subject,
      bodyText: textBody,
      bodyHtml: htmlBody,
      replyTo: replyTo || null,
      cc: replyTo ? [replyTo] : undefined,
      metadata: {
        slug,
        sectionId,
        sourceUrl: sourceUrl || null,
        remoteAddress: remoteAddress || null,
        userAgent: userAgent || null,
        intent: intent || 'contact',
      },
    });
    console.log('[contact] Notification queued', { slug, targetEmail, jobId: job?.id });
  } else {
    console.log('[contact] Notification suppressed by user preferences', {
      slug,
      targetEmail,
      intent,
    });
  }

  captureLeadSubmission({
    slug,
    sectionId,
    targetEmail,
    replyTo,
    fields: normalizedFields,
    sourceUrl,
    remoteAddress,
    userAgent,
    intent: intent || 'contact',
  }).catch((err) => console.warn('[contact] failed to store lead', err?.message));

  if (intent === 'booking') {
    createAppointment({
      slug,
      sectionId,
      submittedBy: replyTo,
      fields: normalizedFields,
      sourceUrl,
    }).catch((error) =>
      console.warn('[contact] failed to store appointment', error?.message)
    );
  }

  console.log('[contact] Submission delivered', {
    slug,
    targetEmail,
    replyTo,
    remoteAddress,
    ua: userAgent,
  });

  return { ok: true };
};

module.exports = { submitContactMessage };
