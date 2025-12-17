const { query } = require('./pg-client');

const sanitizeText = (value) => {
  if (value === undefined || value === null) return null;
  return String(value).slice(0, 500);
};

const recordAuditEvent = async ({
  slug,
  accountId,
  actorUserId,
  actorEmail,
  action,
  description,
  metadata,
  ipAddress,
  userAgent,
}) => {
  if (!action) return;
  try {
    await query(
      `
      INSERT INTO site_audit_logs (
        slug,
        account_id,
        actor_user_id,
        actor_email,
        action,
        description,
        metadata,
        ip_address,
        user_agent
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `,
      [
        slug || null,
        accountId || null,
        actorUserId || null,
        actorEmail || null,
        action,
        sanitizeText(description),
        metadata || null,
        ipAddress || null,
        sanitizeText(userAgent),
      ]
    );
  } catch (error) {
    console.warn('[audit-log] Failed to record event', {
      slug,
      action,
      err: error.message,
    });
  }
};

module.exports = {
  recordAuditEvent,
};
