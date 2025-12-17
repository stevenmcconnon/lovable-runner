const { query } = require('./pg-client');
const { encryptSecret, decryptSecret } = require('./secret-box');

const mapIntegrationRow = async (row) => {
  if (!row) return null;
  const accessToken = row.encrypted_access_token
    ? await decryptSecret(row.encrypted_access_token)
    : null;
  const refreshToken = row.encrypted_refresh_token
    ? await decryptSecret(row.encrypted_refresh_token)
    : null;
  return {
    id: row.id,
    slug: row.slug,
    provider: row.provider,
    accountId: row.account_id || null,
    scopes: row.scopes || [],
    status: row.status || 'active',
    providerUserId: row.provider_user_id || null,
    accessToken,
    refreshToken,
    expiresAt: row.expires_at ? row.expires_at.toISOString?.() ?? row.expires_at : null,
    metadata: row.metadata || null,
    lastError: row.last_error || null,
    lastRefreshAt: row.last_refresh_at
      ? row.last_refresh_at.toISOString?.() ?? row.last_refresh_at
      : null,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
  };
};

const saveIntegrationToken = async ({
  slug,
  provider,
  accountId,
  scopes,
  accessToken,
  refreshToken,
  expiresAt,
  providerUserId,
  metadata,
}) => {
  if (!slug || !provider) {
    throw new Error('slug and provider are required for integration tokens');
  }
  if (!accessToken) {
    throw new Error('accessToken is required to store integration credentials');
  }
  const encryptedAccess = await encryptSecret(accessToken);
  const encryptedRefresh = refreshToken ? await encryptSecret(refreshToken) : null;
  const payload = [
    slug,
    provider,
    accountId || null,
    scopes && scopes.length ? scopes : null,
    providerUserId || null,
    encryptedAccess,
    encryptedRefresh,
    expiresAt || null,
    metadata ? JSON.stringify(metadata) : null,
  ];
  const statement = `
    INSERT INTO integration_tokens (
      slug,
      provider,
      account_id,
      scopes,
      provider_user_id,
      encrypted_access_token,
      encrypted_refresh_token,
      expires_at,
      metadata,
      status,
      last_refresh_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',NOW())
    ON CONFLICT (slug, provider)
    DO UPDATE SET
      account_id = COALESCE(EXCLUDED.account_id, integration_tokens.account_id),
      scopes = COALESCE(EXCLUDED.scopes, integration_tokens.scopes),
      provider_user_id = COALESCE(EXCLUDED.provider_user_id, integration_tokens.provider_user_id),
      encrypted_access_token = EXCLUDED.encrypted_access_token,
      encrypted_refresh_token = COALESCE(EXCLUDED.encrypted_refresh_token, integration_tokens.encrypted_refresh_token),
      expires_at = EXCLUDED.expires_at,
      metadata = COALESCE(EXCLUDED.metadata, integration_tokens.metadata),
      status = 'active',
      last_error = NULL,
      last_refresh_at = NOW(),
      updated_at = NOW()
    RETURNING *;
  `;
  const result = await query(statement, payload);
  return mapIntegrationRow(result.rows[0]);
};

const getIntegrationToken = async ({ slug, provider }) => {
  if (!slug || !provider) return null;
  const result = await query(
    `
    SELECT *
    FROM integration_tokens
    WHERE slug = $1 AND provider = $2
      AND status IN ('active', 'pending')
    LIMIT 1
  `,
    [slug, provider]
  );
  if (!result.rows?.length) return null;
  return mapIntegrationRow(result.rows[0]);
};

const markIntegrationTokenError = async ({ slug, provider, error }) => {
  await query(
    `
    UPDATE integration_tokens
    SET status = 'error',
        last_error = $3,
        updated_at = NOW()
    WHERE slug = $1 AND provider = $2
  `,
    [slug, provider, error || null]
  );
};

const deleteIntegrationToken = async ({ slug, provider }) => {
  if (!slug || !provider) return;
  await query(
    `
    DELETE FROM integration_tokens
    WHERE slug = $1 AND provider = $2
  `,
    [slug, provider]
  );
};

module.exports = {
  saveIntegrationToken,
  getIntegrationToken,
  deleteIntegrationToken,
  markIntegrationTokenError,
};
