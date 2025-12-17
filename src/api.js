const { randomUUID } = require('crypto');
const { parseJsonBody, json } = require('./http');
const { runLaunch } = require('./launch');
const { runUpdate, approveUpdate, listUpdates } = require('./update');
const { getUserContext, requireRole } = require('./auth');
const {
  listSitesForUser,
  listHistoryEntries,
  restoreSiteFromHistory,
  getAllowedSlugsForUser,
} = require('./site-store');
const { listDomainsForUser, getDomainRecord, setPrimaryDomain } = require('./domain-store');
const { submitContactMessage } = require('./contact');
const { listLeads, sendLeadReply, markLeadStatus } = require('./leads');
const { listApprovedReviews, submitReview, setReviewStatus } = require('./reviews');
const { recordAnalyticsEvent, listAnalytics, buildAlerts } = require('./analytics');
const {
  listAppointments,
  getAppointment,
  updateAppointmentStatus,
  saveAppointmentSettings,
  getAppointmentSettings,
  patchAppointmentSettings,
  setOAuthState,
  clearOAuthState,
  setAppointmentCalendarEvent,
  buildICS,
} = require('./appointments');
const calendar = require('./calendar');
const { checkAvailability, registerDomain } = require('./domain-provisioning');
const { getPreferences, savePreferences } = require('./notification-preferences');
const {
  saveIntegrationToken,
  getIntegrationToken,
  deleteIntegrationToken,
} = require('./integration-store');
const { enforceRateLimit, RateLimitError } = require('./rate-limit');
const { recordAuditEvent } = require('./audit-log');

const buildHtmlResponse = (statusCode, message) => ({
  statusCode,
  headers: { 'Content-Type': 'text/html; charset=utf-8' },
  body: `<html><body><h1>${message}</h1><p>You can close this window.</p></body></html>`,
});

const decodeOAuthState = (stateParam) => {
  try {
    const decoded = Buffer.from(stateParam, 'base64url').toString('utf8');
    const payload = JSON.parse(decoded);
    if (!payload.slug || !payload.nonce) {
      throw new Error('Invalid state payload');
    }
    return payload;
  } catch (error) {
    throw new Error('Invalid state parameter');
  }
};

const migrateLegacyCalendarTokens = async ({ slug, settings }) => {
  if (!settings?.calendarProvider) return null;
  if (!settings.calendarToken) return null;
  try {
    await saveIntegrationToken({
      slug,
      provider: settings.calendarProvider,
      accessToken: settings.calendarToken,
      refreshToken: settings.calendarRefreshToken || null,
      expiresAt: settings.calendarExpiresAt || null,
      metadata: {
        accountEmail: settings.calendarAccountEmail || null,
        migratedAt: new Date().toISOString(),
      },
    });
    await patchAppointmentSettings({
      slug,
      updates: {
        calendarToken: null,
        calendarRefreshToken: null,
        calendarExpiresAt: null,
      },
    });
  } catch (error) {
    console.warn('[calendar] Failed to migrate legacy tokens', {
      slug,
      err: error.message,
    });
  }
};

const loadCalendarCredentials = async ({ slug, settings }) => {
  if (!settings?.calendarProvider) return null;
  let record = await getIntegrationToken({
    slug,
    provider: settings.calendarProvider,
  });
  if (!record && (settings.calendarToken || settings.calendarRefreshToken)) {
    await migrateLegacyCalendarTokens({ slug, settings });
    record = await getIntegrationToken({
      slug,
      provider: settings.calendarProvider,
    });
  }
  return record;
};

const syncAppointmentWithProvider = async ({ slug, appointmentId }) => {
  const appointment = await getAppointment({ slug, appointmentId });
  if (!appointment) return;
  const settings = await getAppointmentSettings({ slug });
  if (!settings?.calendarProvider) return;
  if (!['google', 'outlook'].includes(settings.calendarProvider)) return;
  const credentials = await loadCalendarCredentials({ slug, settings });
  if (!credentials?.accessToken) {
    console.warn('[calendar] Missing credentials for provider', {
      slug,
      provider: settings.calendarProvider,
    });
    return;
  }
  const expiresAt = credentials.expiresAt ? Date.parse(credentials.expiresAt) : null;
  const access = await calendar.ensureAccessToken({
    provider: settings.calendarProvider,
    token: credentials.accessToken,
    refreshToken: credentials.refreshToken,
    expiresAt,
  });
  if (!access?.accessToken) {
    throw new Error('Unable to obtain calendar access token');
  }
  await saveIntegrationToken({
    slug,
    provider: settings.calendarProvider,
    accessToken: access.accessToken,
    refreshToken: access.refreshToken || credentials.refreshToken || null,
    expiresAt: access.expiresAt ? new Date(access.expiresAt).toISOString() : credentials.expiresAt,
    metadata: credentials.metadata || { accountEmail: settings.calendarAccountEmail || null },
    providerUserId: credentials.providerUserId || null,
    scopes: credentials.scopes || null,
  });
  const result = await calendar.syncAppointment({
    provider: settings.calendarProvider,
    appointment: {
      ...appointment,
      timezone: settings.timezone || 'UTC',
    },
    accessToken: access.accessToken,
    slug,
    calendarEventId: appointment.calendarEventId,
  });
  await setAppointmentCalendarEvent({
    slug,
    appointmentId: appointment.appointmentId,
    provider: settings.calendarProvider,
    eventId: result.eventId || null,
    eventLink: result.htmlLink || result.webLink || null,
  });
};

const handleCalendarCallback = async (provider, event) => {
  const query = event?.queryStringParameters || {};
  const code = query.code;
  const stateParam = query.state;
  if (!code || !stateParam) {
    return buildHtmlResponse(400, 'Missing authorization parameters.');
  }
  let payload;
  try {
    payload = decodeOAuthState(stateParam);
  } catch (error) {
    return buildHtmlResponse(400, error.message);
  }
  const slug = payload.slug;
  try {
    const settings = await getAppointmentSettings({ slug });
    if (!settings?.oauthState || settings.oauthState !== payload.nonce) {
      return buildHtmlResponse(400, 'State mismatch. Please restart the connection flow.');
    }
    if (settings.oauthStateExpiresAt) {
      const expiresAt = new Date(settings.oauthStateExpiresAt).getTime();
      if (Date.now() > expiresAt) {
        await clearOAuthState({ slug });
        return buildHtmlResponse(400, 'Authorization state expired. Please try again.');
      }
    }
    if (
      settings.oauthStateProvider &&
      settings.oauthStateProvider !== provider
    ) {
      return buildHtmlResponse(400, 'Mismatched provider state.');
    }
    const tokens = await calendar.exchangeCodeForTokens({ provider, code });
    const expiresAtIso = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : settings.calendarExpiresAt || null;
    await saveIntegrationToken({
      slug,
      provider,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || settings.calendarRefreshToken || null,
      expiresAt: expiresAtIso,
      metadata: {
        accountEmail: tokens.accountEmail || settings.calendarAccountEmail || null,
      },
      providerUserId: tokens.accountEmail || null,
    });
    await saveAppointmentSettings({
      slug,
      calendarProvider: provider,
      calendarAccountEmail: tokens.accountEmail || settings.calendarAccountEmail || null,
    });
    await clearOAuthState({ slug });
    return buildHtmlResponse(200, 'Calendar connected!');
  } catch (error) {
    console.error('[calendar callback] failed', { provider, error: error.message });
    return buildHtmlResponse(500, 'Calendar connection failed.');
  }
};

const ROUTES = {
  'POST /launch': async (event, user) => {
    const body = parseJsonBody(event);
    const result = await runLaunch({
      url: body.url,
      prefix: body.prefix || process.env.LOVABLE_DEPLOY_PREFIX,
      slug: body.slug,
      description: body.description,
      businessDetails: body.businessDetails || body.business,
    });
    return json(200, result);
  },
  'POST /update': async (event, user) => {
    requireRole(user, ['admin', 'super-admin']);
    const body = parseJsonBody(event);
    const result = await runUpdate({
      projectId: body.projectId,
      url: body.url,
      instructions: body.instructions,
      token: body.token,
      base: body.base,
      createPath: body.createPath,
      workspace: body.workspace,
      waitSeconds: body.wait,
      attempts: body.attempts,
      bucket: body.bucket,
      prefix: body.prefix,
      profile: body.profile,
      skipInstall: body.skipInstall,
      placeholderLimit: body.placeholderLimit,
      requestedBy: user,
    });
    return json(200, result);
  },
  'POST /approve-update': async (event, user) => {
    requireRole(user, ['admin', 'super-admin']);
    const body = parseJsonBody(event);
    const result = await approveUpdate({
      projectId: body.projectId,
      draftId: body.draftId,
      bucket: body.bucket,
      livePrefix: body.livePrefix || body.prefix,
      approvedBy: user,
    });
    return json(200, result);
  },
  'GET /updates': async (event) => {
    const projectId =
      event?.queryStringParameters?.projectId ||
      event?.queryStringParameters?.project_id;
    const limit = event?.queryStringParameters?.limit
      ? Number(event.queryStringParameters.limit)
      : undefined;
    const drafts = await listUpdates({ projectId, limit });
    return json(200, { items: drafts });
  },
  'GET /sites': async (event, user) => {
    const limit = event?.queryStringParameters?.limit
      ? Number(event.queryStringParameters.limit)
      : undefined;
    const items = await listSitesForUser({ user, limit });
    return json(200, { items });
  },
  'GET /domains': async (event, user) => {
    const items = await listDomainsForUser({ user });
    return json(200, { items });
  },
  'POST /domains/check': async (event, user) => {
    requireRole(user, ['admin', 'super-admin', 'user']);
    const body = parseJsonBody(event);
    const result = await checkAvailability({ domain: body.domain });
    return json(200, result);
  },
  'POST /domains/register': async (event, user) => {
    requireRole(user, ['admin', 'super-admin']);
    const body = parseJsonBody(event);
    const allowedSlugs = getAllowedSlugsForUser(user);
    if (body.slug && !allowedSlugs?.includes(body.slug)) {
      return json(403, { error: 'You do not have access to this site.' });
    }
    const profile = user?.profile || null;
    try {
      await enforceRateLimit({
        slug: body.slug || null,
        action: 'domain:register',
        identifier:
          profile?.accountId ||
          profile?.id ||
          profile?.email ||
          'unknown-account',
        limit: Number(process.env.DOMAIN_REGISTER_HOURLY_LIMIT || 3),
        windowMs: 60 * 60 * 1000,
      });
    } catch (error) {
      if (error instanceof RateLimitError) {
        return json(429, {
          error: 'Domain registration limit reached. Please try again later.',
        });
      }
      throw error;
    }
    const result = await registerDomain({
      domain: body.domain,
      contact: body.contact,
      slug: body.slug,
      years: body.years || body.termYears,
    });
    await recordAuditEvent({
      slug: body.slug || null,
      accountId: profile?.accountId || null,
      actorUserId: profile?.id || null,
      actorEmail: profile?.email || null,
      action: 'domain.register',
      description: `Registered domain ${result?.domain || body.domain}`,
      metadata: result || { domain: body.domain },
      ipAddress:
        event?.requestContext?.http?.sourceIp ||
        event?.requestContext?.identity?.sourceIp ||
        null,
      userAgent: event?.headers?.['user-agent'] || event?.headers?.['User-Agent'] || null,
    });
    return json(200, result);
  },
  'GET /sites/history': async (event) => {
    const slug = event?.queryStringParameters?.slug;
    const limit = event?.queryStringParameters?.limit
      ? Number(event.queryStringParameters.limit)
      : undefined;
    if (!slug) {
      return json(400, { error: 'slug is required' });
    }
    const entries = await listHistoryEntries({ slug, limit });
    return json(200, { slug, entries });
  },
  'POST /sites/restore': async (event) => {
    const body = parseJsonBody(event);
    if (!body.slug || !body.historyId) {
      return json(400, { error: 'slug and historyId are required' });
    }
    const result = await restoreSiteFromHistory({
      slug: body.slug,
      historyId: body.historyId,
    });
    return json(200, result);
  },
  'POST /contact': async (event) => {
    const body = parseJsonBody(event);
    const remoteAddress =
      event?.requestContext?.http?.sourceIp ||
      event?.requestContext?.identity?.sourceIp ||
      null;
    const userAgent = event?.headers?.['user-agent'] || event?.headers?.['User-Agent'] || null;
    try {
      await enforceRateLimit({
        slug: body.slug || null,
        action: 'contact:ip',
        identifier: remoteAddress || 'unknown',
        limit: Number(process.env.CONTACT_RATE_LIMIT_PER_IP || 5),
        windowMs: 5 * 60 * 1000,
      });
      await enforceRateLimit({
        slug: body.slug || null,
        action: 'contact:slug',
        identifier: body.slug || 'global',
        limit: Number(process.env.CONTACT_RATE_LIMIT_PER_SITE || 60),
        windowMs: 60 * 1000,
      });
    } catch (error) {
      if (error instanceof RateLimitError) {
        return json(429, { error: 'Too many submissions. Please wait a moment.' });
      }
      throw error;
    }
    await submitContactMessage({
      slug: body.slug,
      sectionId: body.sectionId,
      contactEmailHint: body.contactEmail,
      fields: body.fields,
      sourceUrl: body.sourceUrl,
      remoteAddress,
      userAgent,
      intent: body.intent,
    });
    await recordAuditEvent({
      slug: body.slug || null,
      action: 'contact.submission',
      description: `Contact submission (${body.intent || 'contact'})`,
      metadata: {
        sectionId: body.sectionId || null,
        sourceUrl: body.sourceUrl || null,
      },
      ipAddress: remoteAddress,
      userAgent,
    });
    return json(200, { ok: true });
  },
  'GET /appointments': async (event, user) => {
    requireRole(user, ['admin', 'super-admin', 'user']);
    const allowedSlugs = getAllowedSlugsForUser(user);
    if (!allowedSlugs?.length) {
      return json(403, { error: 'No sites assigned to this account yet.' });
    }
    const slug = event?.queryStringParameters?.slug || allowedSlugs[0];
    if (!allowedSlugs.includes(slug)) {
      return json(403, { error: 'You do not have access to this site.' });
    }
    const status = event?.queryStringParameters?.status;
    const limit = event?.queryStringParameters?.limit
      ? Number(event.queryStringParameters.limit)
      : undefined;
    const cursorToken = event?.queryStringParameters?.cursor;
    let cursor;
    if (cursorToken) {
      try {
        cursor = JSON.parse(Buffer.from(cursorToken, 'base64').toString('utf8'));
      } catch (error) {
        return json(400, { error: 'cursor token is invalid' });
      }
    }
    const result = await listAppointments({ slug, status, limit, cursor });
    const nextCursor = result.nextCursor
      ? Buffer.from(JSON.stringify(result.nextCursor)).toString('base64')
      : null;
    return json(200, { slug, items: result.items, nextCursor });
  },
  'POST /appointments/status': async (event, user) => {
    requireRole(user, ['admin', 'super-admin', 'user']);
    const body = parseJsonBody(event);
    const allowedSlugs = getAllowedSlugsForUser(user);
    if (!allowedSlugs?.includes(body.slug)) {
      return json(403, { error: 'You do not have access to this site.' });
    }
    const result = await updateAppointmentStatus({
      slug: body.slug,
      appointmentId: body.appointmentId,
      status: body.status,
      confirmedStart: body.confirmedStart,
      confirmedEnd: body.confirmedEnd,
      metadata: body.metadata,
    });
    if (body.status && body.status.toLowerCase() === 'confirmed') {
      try {
        await syncAppointmentWithProvider({
          slug: body.slug,
          appointmentId: body.appointmentId,
        });
      } catch (error) {
        console.warn('[calendar] failed to sync appointment', {
          slug: body.slug,
          appointmentId: body.appointmentId,
          err: error.message,
        });
      }
    }
    return json(200, result);
  },
  'GET /appointments/settings': async (event, user) => {
    requireRole(user, ['admin', 'super-admin', 'user']);
    const allowedSlugs = getAllowedSlugsForUser(user);
    if (!allowedSlugs?.length) {
      return json(403, { error: 'No sites assigned yet.' });
    }
    const slug = event?.queryStringParameters?.slug || allowedSlugs[0];
    if (!allowedSlugs.includes(slug)) {
      return json(403, { error: 'You do not have access to this site.' });
    }
    const settings = await getAppointmentSettings({ slug });
    return json(200, settings);
  },
  'POST /appointments/settings': async (event, user) => {
    requireRole(user, ['admin', 'super-admin', 'user']);
    const body = parseJsonBody(event);
    const allowedSlugs = getAllowedSlugsForUser(user);
    if (!allowedSlugs?.includes(body.slug)) {
      return json(403, { error: 'You do not have access to this site.' });
    }
    const previousSettings = await getAppointmentSettings({ slug: body.slug });
    const settings = await saveAppointmentSettings({
      slug: body.slug,
      availability: body.availability,
      timezone: body.timezone,
      calendarProvider: body.calendarProvider,
    });
    if (
      body.calendarProvider !== undefined &&
      previousSettings?.calendarProvider &&
      (!body.calendarProvider ||
        body.calendarProvider !== previousSettings.calendarProvider)
    ) {
      try {
        await deleteIntegrationToken({
          slug: body.slug,
          provider: previousSettings.calendarProvider,
        });
      } catch (error) {
        console.warn('[calendar] failed to delete integration token', {
          slug: body.slug,
          err: error.message,
        });
      }
    }
    return json(200, settings);
  },
  'GET /appointments/ics': async (event) => {
    const slug = event?.queryStringParameters?.slug;
    const token = event?.queryStringParameters?.token;
    if (!slug || !token) {
      return json(400, { error: 'slug and token are required' });
    }
    const settings = await getAppointmentSettings({ slug });
    if (!settings?.calendarIcsToken || settings.calendarIcsToken !== token) {
      return json(403, { error: 'Invalid calendar token' });
    }
    const result = await listAppointments({ slug, limit: 200 });
    const calendarBody = buildICS({
      slug,
      appointments: result.items || [],
      siteName: slug,
    });
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
      body: calendarBody,
    };
  },
  'POST /appointments/calendar/connect': async (event, user) => {
    requireRole(user, ['admin', 'super-admin', 'user']);
    const body = parseJsonBody(event);
    const provider = (body.provider || '').toLowerCase();
    const allowedSlugs = getAllowedSlugsForUser(user);
    if (!allowedSlugs?.length) {
      return json(403, { error: 'No sites assigned yet.' });
    }
    const slug = body.slug || allowedSlugs[0];
    if (!allowedSlugs.includes(slug)) {
      return json(403, { error: 'You do not have access to this site.' });
    }
    if (provider === 'apple') {
      const settings = await getAppointmentSettings({ slug });
      let token = settings.calendarIcsToken;
      if (!token) {
        token = randomUUID();
        await saveAppointmentSettings({ slug, calendarIcsToken: token });
      }
      const apiBase =
        process.env.RUNNER_API_BASE ||
        `https://${process.env.ApiCustomDomainName || 'api.ai-sitemaker.com'}`;
      const icsUrl = `${apiBase.replace(/\/+$/, '')}/appointments/ics?slug=${slug}&token=${token}`;
      await saveAppointmentSettings({
        slug,
        calendarProvider: 'apple-ics',
      });
      return json(200, {
        provider: 'apple',
        icsUrl,
        instructions: 'Subscribe to this ICS feed in Apple Calendar to mirror appointments.',
      });
    }
    if (!['google', 'outlook'].includes(provider)) {
      return json(400, { error: 'Unsupported provider' });
    }
    const nonce = randomUUID();
    const statePayload = Buffer.from(
      JSON.stringify({ slug, nonce }),
      'utf8'
    ).toString('base64url');
    await setOAuthState({
      slug,
      provider,
      state: nonce,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    const url = calendar.buildConnectUrl({ provider, slug, state: statePayload });
    return json(200, { provider, url });
  },
  'GET /leads': async (event, user) => {
    requireRole(user, ['admin', 'super-admin', 'user']);
    const allowedSlugs = getAllowedSlugsForUser(user);
    if (!allowedSlugs?.length) {
      return json(403, { error: 'No sites assigned to this account yet.' });
    }
    const slugParam = event?.queryStringParameters?.slug;
    const slug = slugParam || allowedSlugs[0];
    if (!allowedSlugs.includes(slug)) {
      return json(403, { error: 'You do not have access to this site.' });
    }
    const limit = event?.queryStringParameters?.limit
      ? Number(event.queryStringParameters.limit)
      : undefined;
    const status = event?.queryStringParameters?.status || undefined;
    const cursorToken = event?.queryStringParameters?.cursor;
    let cursor;
    if (cursorToken && typeof cursorToken === 'string') {
      try {
        cursor = JSON.parse(Buffer.from(cursorToken, 'base64').toString('utf8'));
      } catch (error) {
        return json(400, { error: 'cursor token is invalid' });
      }
    }
    const result = await listLeads({ slug, limit, status, cursor });
    const nextCursor = result.nextToken
      ? Buffer.from(JSON.stringify(result.nextToken)).toString('base64')
      : null;
    return json(200, { slug, items: result.items, nextCursor });
  },
  'POST /leads/reply': async (event, user) => {
    requireRole(user, ['admin', 'super-admin', 'user']);
    const body = parseJsonBody(event);
    const allowedSlugs = getAllowedSlugsForUser(user);
    if (!allowedSlugs?.includes(body.slug)) {
      return json(403, { error: 'You do not have access to this site.' });
    }
    const result = await sendLeadReply({
      slug: body.slug,
      leadId: body.leadId,
      message: body.message,
      subject: body.subject,
      sender: { targetEmail: body.targetEmailHint },
    });
    return json(200, result);
  },
  'POST /leads/status': async (event, user) => {
    requireRole(user, ['admin', 'super-admin', 'user']);
    const body = parseJsonBody(event);
    const allowedSlugs = getAllowedSlugsForUser(user);
    if (!allowedSlugs?.includes(body.slug)) {
      return json(403, { error: 'You do not have access to this site.' });
    }
    const result = await markLeadStatus({
      slug: body.slug,
      leadId: body.leadId,
      status: body.status,
      followUpAt: body.followUpAt,
    });
    return json(200, result);
  },
  'GET /reviews': async (event) => {
    const slug = event?.queryStringParameters?.slug;
    const limit = event?.queryStringParameters?.limit
      ? Number(event.queryStringParameters.limit)
      : undefined;
    if (!slug) {
      return json(400, { error: 'slug is required' });
    }
    const items = await listApprovedReviews({ slug, limit });
    return json(200, { slug, items });
  },
  'POST /reviews': async (event) => {
    const body = parseJsonBody(event);
    const record = await submitReview({
      slug: body.slug,
      authorName: body.authorName,
      rating: body.rating,
      body: body.body,
      contactEmail: body.contactEmail,
      source: body.source,
    });
    return json(200, { review: record });
  },
  'POST /reviews/status': async (event, user) => {
    requireRole(user, ['admin', 'super-admin', 'user']);
    const body = parseJsonBody(event);
    const allowedSlugs = getAllowedSlugsForUser(user);
    if (!allowedSlugs?.includes(body.slug)) {
      return json(403, { error: 'You do not have access to this site.' });
    }
    const result = await setReviewStatus({
      slug: body.slug,
      reviewId: body.reviewId,
      status: body.status,
    });
    return json(200, result);
  },
  'GET /notifications/preferences': async (event, user) => {
    requireRole(user, ['admin', 'super-admin', 'user']);
    const allowedSlugs = getAllowedSlugsForUser(user);
    const slug = event?.queryStringParameters?.slug || allowedSlugs?.[0];
    const recipient = event?.queryStringParameters?.recipient;
    if (!slug || !recipient) {
      return json(400, { error: 'slug and recipient are required' });
    }
    if (!allowedSlugs?.includes(slug)) {
      return json(403, { error: 'You do not have access to this site.' });
    }
    const prefs = await getPreferences({ slug, recipient });
    return json(200, prefs);
  },
  'POST /notifications/preferences': async (event) => {
    const body = parseJsonBody(event);
    if (!body.slug || !body.recipient) {
      return json(400, { error: 'slug and recipient are required' });
    }
    const prefs = await savePreferences({
      slug: body.slug,
      recipient: body.recipient,
      preferences: body.preferences,
      unsubscribeAll: body.unsubscribeAll,
    });
    return json(200, prefs);
  },
  'POST /analytics/events': async (event) => {
    const body = parseJsonBody(event);
    if (!body.slug || !body.type) {
      return json(400, { error: 'slug and type are required' });
    }
    const metadataPayload =
      body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
    await recordAnalyticsEvent({
      slug: body.slug,
      type: body.type,
      metadata: {
        path: metadataPayload.path || body.path || null,
        referrer: metadataPayload.referrer || body.referrer || null,
        visitorId: metadataPayload.visitorId || body.visitorId || body.sessionId || null,
      },
    });
    return json(200, { ok: true });
  },
  'GET /analytics': async (event, user) => {
    requireRole(user, ['admin', 'super-admin', 'user']);
    const allowedSlugs = getAllowedSlugsForUser(user);
    if (!allowedSlugs?.length) {
      return json(403, { error: 'No sites assigned yet.' });
    }
    const slug = event?.queryStringParameters?.slug || allowedSlugs[0];
    if (!allowedSlugs.includes(slug)) {
      return json(403, { error: 'You do not have access to this site.' });
    }
    const days = event?.queryStringParameters?.days
      ? Number(event.queryStringParameters.days)
      : undefined;
    const records = await listAnalytics({ slug, days });
    const alerts = buildAlerts(records);
    return json(200, { slug, records, alerts });
  },
  'GET /oauth/calendar/google/callback': async (event) =>
    handleCalendarCallback('google', event),
  'GET /oauth/calendar/outlook/callback': async (event) =>
    handleCalendarCallback('outlook', event),
};

const buildRouteKey = (event) => {
  const method = event?.requestContext?.http?.method;
  const path = event?.requestContext?.http?.path;
  if (!method || !path) return null;
  const normalizedPath = path.replace(/\/+$/, '').toLowerCase() || '/';
  return `${method.toUpperCase()} ${normalizedPath}`;
};

const isApiGatewayEvent = (event) =>
  Boolean(event?.requestContext?.http?.method && event?.requestContext?.http?.path);

const handleHttpEvent = async (event) => {
  const user = getUserContext(event);
  const method = event?.requestContext?.http?.method || '';
  const path = event?.requestContext?.http?.path || '';
  const routeKey = buildRouteKey(event);

  try {
    if (routeKey && ROUTES[routeKey]) {
      return await ROUTES[routeKey](event, user);
    }

    if (method === 'GET' && /^\/domains\/[^/]+$/i.test(path)) {
      const [, , domainValue] = path.split('/');
      const domain = decodeURIComponent(domainValue || '');
      const record = await getDomainRecord({ user, domain });
      if (!record) {
        return json(404, { error: 'Domain not found' });
      }
      return json(200, { domain: record, dns: record.dnsSettings || null });
    }

    if (method === 'POST' && /^\/sites\/[^/]+\/domains\/[^/]+\/primary$/i.test(path)) {
      const [, , slugValue, , domainValue] = path.split('/');
      const slug = decodeURIComponent(slugValue || '');
      const domain = decodeURIComponent(domainValue || '');
      const record = await setPrimaryDomain({ slug, domain, user });
      return json(200, { domain: record, dns: record.dnsSettings || null });
    }

    return json(404, { error: 'Not found' });
  } catch (error) {
    const statusCode = error.statusCode || error.status || 500;
    return json(statusCode, { error: error.message || 'Request failed' });
  }
};

module.exports = { handleHttpEvent, isApiGatewayEvent };
