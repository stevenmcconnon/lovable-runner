const CONTACT_FROM_EMAIL =
  process.env.CONTACT_FROM_EMAIL ||
  process.env.FALLBACK_FROM_EMAIL ||
  'formsubmissions@ai-sitemaker.com';

module.exports = { CONTACT_FROM_EMAIL };
