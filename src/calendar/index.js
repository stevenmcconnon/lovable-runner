const google = require('./google');
const outlook = require('./outlook');

const PROVIDERS = {
  google,
  outlook,
};

const buildConnectUrl = ({ provider, slug, state }) => {
  const mod = PROVIDERS[provider];
  if (!mod) {
    throw new Error(`Unsupported calendar provider: ${provider}`);
  }
  return mod.buildAuthUrl({ slug, state });
};

const exchangeCodeForTokens = async ({ provider, code }) => {
  const mod = PROVIDERS[provider];
  if (!mod) {
    throw new Error(`Unsupported calendar provider: ${provider}`);
  }
  const tokens = await mod.exchangeCodeForTokens({ code });
  if (provider === 'google') {
    const profile = mod.decodeIdToken(tokens.id_token);
    tokens.accountEmail = profile?.email || profile?.sub || null;
  } else if (provider === 'outlook') {
    const profile = await outlook.fetchProfile({
      accessToken: tokens.access_token,
    });
    tokens.accountEmail =
      profile?.mail || profile?.userPrincipalName || profile?.id || null;
  }
  return tokens;
};

const ensureAccessToken = async ({ provider, token, refreshToken, expiresAt }) => {
  const mod = PROVIDERS[provider];
  if (!mod) {
    throw new Error(`Unsupported calendar provider: ${provider}`);
  }
  return mod.ensureAccessToken({ token, refreshToken, expiresAt });
};

const syncAppointment = async ({
  provider,
  appointment,
  accessToken,
  slug,
  calendarEventId,
}) => {
  const mod = PROVIDERS[provider];
  if (!mod) {
    throw new Error(`Unsupported calendar provider: ${provider}`);
  }
  return mod.syncAppointment({
    appointment,
    accessToken,
    slug,
    calendarEventId,
  });
};

module.exports = {
  buildConnectUrl,
  exchangeCodeForTokens,
  ensureAccessToken,
  syncAppointment,
};
