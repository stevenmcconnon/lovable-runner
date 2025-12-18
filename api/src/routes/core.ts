import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DatabaseService } from '../services/database';
import { UserRole } from '../types';

const rootRequire = (relativePath: string): any => {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(path.join(process.cwd(), relativePath));
  } catch {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(path.join(__dirname, '..', '..', relativePath));
  }
};

const { runUpdate, approveUpdate, listUpdates } = rootRequire('src/update.js') as {
  runUpdate: (params: any) => Promise<any>;
  approveUpdate: (params: any) => Promise<any>;
  listUpdates: (params: { projectId?: string; limit?: number }) => Promise<any[]>;
};
const {
  listHistoryEntries,
  restoreSiteFromHistory,
} = rootRequire('src/site-store.js') as {
  listHistoryEntries: (params: { slug: string; limit?: number }) => Promise<any>;
  restoreSiteFromHistory: (params: { slug: string; historyId: string }) => Promise<any>;
};
const { submitContactMessage } = rootRequire('src/contact.js') as {
  submitContactMessage: (params: any) => Promise<any>;
};
const { listLeads, sendLeadReply, markLeadStatus } = rootRequire('src/leads.js') as {
  listLeads: (params: { slug: string; limit?: number; status?: string; cursor?: any }) => Promise<any>;
  sendLeadReply: (params: any) => Promise<any>;
  markLeadStatus: (params: any) => Promise<any>;
};
const { listApprovedReviews, submitReview, setReviewStatus } = rootRequire('src/reviews.js') as {
  listApprovedReviews: (params: { slug: string; limit?: number }) => Promise<any>;
  submitReview: (params: any) => Promise<any>;
  setReviewStatus: (params: any) => Promise<any>;
};
const { recordAnalyticsEvent, listAnalytics, buildAlerts } = rootRequire('src/analytics.js') as {
  recordAnalyticsEvent: (params: { slug: string; type: string; metadata?: Record<string, any> }) => Promise<void>;
  listAnalytics: (params: { slug: string; days?: number }) => Promise<any[]>;
  buildAlerts: (records: Array<Record<string, any>>) => string[];
};
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
} = rootRequire('src/appointments.js') as {
  listAppointments: (params: { slug: string; limit?: number; status?: string; cursor?: any }) => Promise<any>;
  getAppointment: (params: { slug: string; appointmentId: string }) => Promise<any>;
  updateAppointmentStatus: (params: any) => Promise<any>;
  saveAppointmentSettings: (params: any) => Promise<any>;
  getAppointmentSettings: (params: { slug: string }) => Promise<any>;
  patchAppointmentSettings: (params: { slug: string; updates: Record<string, unknown> }) => Promise<any>;
  setOAuthState: (params: { slug: string; provider: string; state: string; expiresAt: string }) => Promise<any>;
  clearOAuthState: (params: { slug: string }) => Promise<void>;
  setAppointmentCalendarEvent: (params: any) => Promise<void>;
  buildICS: (params: { slug: string; appointments: any[]; siteName?: string }) => string;
};
const calendar = rootRequire('src/calendar');
const { getPreferences, savePreferences } = rootRequire('src/notification-preferences.js') as {
  getPreferences: (params: { slug: string; recipient: string }) => Promise<any>;
  savePreferences: (params: any) => Promise<any>;
};
const {
  saveIntegrationToken,
  getIntegrationToken,
  deleteIntegrationToken,
} = rootRequire('src/integration-store.js') as {
  saveIntegrationToken: (params: any) => Promise<any>;
  getIntegrationToken: (params: { slug: string; provider: string }) => Promise<any>;
  deleteIntegrationToken: (params: { slug: string; provider: string }) => Promise<void>;
};
const { enforceRateLimit, RateLimitError } = rootRequire('src/rate-limit.js') as {
  enforceRateLimit: (params: {
    slug?: string | null;
    action: string;
    identifier: string;
    limit: number;
    windowMs?: number;
  }) => Promise<void>;
  RateLimitError: new (message?: string) => Error & { statusCode?: number };
};
const { recordAuditEvent } = rootRequire('src/audit-log.js') as {
  recordAuditEvent: (params: {
    slug?: string | null;
    accountId?: string | null;
    actorUserId?: string | null;
    actorEmail?: string | null;
    action: string;
    description?: string | null;
    metadata?: Record<string, any> | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  }) => Promise<void>;
};

const buildAccessContext = (request: FastifyRequest) => ({
  accountId: request.auth?.profile?.accountId ?? null,
  id: request.auth?.profile?.id ?? null,
  sub: request.auth?.sub ?? request.auth?.profile?.cognitoSub ?? null,
  email: request.auth?.profile?.email ?? request.auth?.email ?? null,
  profile: request.auth?.profile ?? null,
  groups: request.auth?.roles ?? [],
});

const allowedSlugsCacheKey = Symbol('allowedSlugs');

const loadAllowedSlugs = async (request: FastifyRequest, db: DatabaseService): Promise<string[]> => {
  const cached = (request as any)[allowedSlugsCacheKey];
  if (cached) return cached;
  const accountId = request.auth?.profile?.accountId;
  if (!accountId) {
    (request as any)[allowedSlugsCacheKey] = [];
    return [];
  }
  const slugs = await db.listAccountSlugs(accountId);
  (request as any)[allowedSlugsCacheKey] = slugs;
  return slugs;
};

const ensureAnySiteAccess = async (
  request: FastifyRequest,
  reply: FastifyReply,
  db: DatabaseService
): Promise<string[] | null> => {
  const slugs = await loadAllowedSlugs(request, db);
  if (!slugs.length) {
    reply.code(403).send({ error: 'No sites assigned to this account yet.' });
    return null;
  }
  return slugs;
};

const ensureSlugAccess = async (
  request: FastifyRequest,
  reply: FastifyReply,
  db: DatabaseService,
  slug?: string | null
): Promise<string | null> => {
  if (!slug) {
    reply.code(400).send({ error: 'slug is required' });
    return null;
  }
  const slugs = await ensureAnySiteAccess(request, reply, db);
  if (!slugs) return null;
  if (!slugs.includes(slug)) {
    reply.code(403).send({ error: 'You do not have access to this site.' });
    return null;
  }
  return slug;
};

const resolveSlugOrDefault = async (
  request: FastifyRequest,
  reply: FastifyReply,
  db: DatabaseService,
  slug?: string | null
): Promise<string | null> => {
  const slugs = await ensureAnySiteAccess(request, reply, db);
  if (!slugs) return null;
  if (slug) {
    if (!slugs.includes(slug)) {
      reply.code(403).send({ error: 'You do not have access to this site.' });
      return null;
    }
    return slug;
  }
  return slugs[0];
};

const decodeOauthState = (value: string) => {
  try {
    const payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object' || !payload.slug || !payload.nonce) {
      throw new Error('Invalid state payload');
    }
    return payload as { slug: string; nonce: string };
  } catch (error) {
    throw new Error('Invalid state parameter');
  }
};

const migrateLegacyCalendarTokens = async ({ slug, settings }: { slug: string; settings: any }) => {
  if (!settings?.calendarProvider) return;
  if (!settings.calendarToken) return;
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
};

const loadCalendarCredentials = async ({ slug, settings }: { slug: string; settings: any }) => {
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

const syncAppointmentWithProvider = async ({ slug, appointmentId }: { slug: string; appointmentId: string }) => {
  const appointment = await getAppointment({ slug, appointmentId });
  if (!appointment) return;
  const settings = await getAppointmentSettings({ slug });
  if (!settings?.calendarProvider) return;
  if (!['google', 'outlook'].includes(settings.calendarProvider)) return;
  const credentials = await loadCalendarCredentials({ slug, settings });
  if (!credentials?.accessToken) {
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

const respondWithHtml = (reply: FastifyReply, statusCode: number, message: string) =>
  reply
    .type('text/html; charset=utf-8')
    .code(statusCode)
    .send(`<html><body><h1>${message}</h1><p>You can close this window.</p></body></html>`);

const ensureRolesPreHandler = (
  app: FastifyInstance,
  roles: UserRole[]
): ((request: FastifyRequest, reply: FastifyReply) => Promise<void>) => {
  return async (request, reply) => {
    await app.requireRoles(request, reply, roles);
  };
};

const getClientIp = (request: FastifyRequest) =>
  (request.headers['x-forwarded-for'] as string | undefined)?.split(',')?.[0]?.trim() ||
  (request.ip as string | undefined) ||
  null;

const getUserAgent = (request: FastifyRequest) =>
  (request.headers['user-agent'] as string | undefined) ||
  (request.headers['User-Agent'] as string | undefined) ||
  null;

export const registerCoreRoutes = (app: FastifyInstance, deps: { db: DatabaseService }) => {
  const { db } = deps;
  app.post(
    '/update',
    {
      preHandler: [app.authenticateUser, ensureRolesPreHandler(app, ['admin', 'super-admin'])],
    },
    async (request, reply) => {
      const body = request.body as Record<string, any>;
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
      requestedBy: buildAccessContext(request),
      });
      reply.send(result);
    }
  );

  app.post(
    '/approve-update',
    {
      preHandler: [app.authenticateUser, ensureRolesPreHandler(app, ['admin', 'super-admin'])],
    },
    async (request, reply) => {
      const body = request.body as Record<string, any>;
      const result = await approveUpdate({
        projectId: body.projectId,
        draftId: body.draftId,
        bucket: body.bucket,
        livePrefix: body.livePrefix || body.prefix,
      approvedBy: buildAccessContext(request),
      });
      reply.send(result);
    }
  );

  app.get('/updates', async (request, reply) => {
    const projectId =
      (request.query as Record<string, any>)?.projectId ||
      (request.query as Record<string, any>)?.project_id;
    const limitRaw = (request.query as Record<string, any>)?.limit;
    const limit = limitRaw ? Number(limitRaw) : undefined;
    const drafts = await listUpdates({ projectId, limit });
    reply.send({ items: drafts });
  });

  app.get('/sites/history', async (request, reply) => {
    const { slug, limit } = request.query as { slug?: string; limit?: string };
    if (!slug) {
      reply.code(400).send({ error: 'slug is required' });
      return;
    }
    const result = await listHistoryEntries({ slug, limit: limit ? Number(limit) : undefined });
    reply.send({ slug, entries: result });
  });

  app.post('/sites/restore', async (request, reply) => {
    const body = request.body as { slug?: string; historyId?: string };
    if (!body.slug || !body.historyId) {
      reply.code(400).send({ error: 'slug and historyId are required' });
      return;
    }
    const restored = await restoreSiteFromHistory({ slug: body.slug, historyId: body.historyId });
    reply.send(restored);
  });

  app.post('/contact', async (request, reply) => {
    const body = request.body as any;
    const remoteAddress = getClientIp(request);
    const userAgent = getUserAgent(request);
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
      if (error instanceof RateLimitError || (error as any)?.statusCode === 429) {
        reply.code(429).send({ error: 'Too many submissions. Please wait a moment.' });
        return;
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
    reply.send({ ok: true });
  });

  app.get(
    '/appointments',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      const query = request.query as Record<string, any>;
      const slug = await resolveSlugOrDefault(request, reply, db, query.slug);
      if (!slug) return;
      const limit = query.limit ? Number(query.limit) : undefined;
      const status = query.status;
      const cursorToken = query.cursor;
      let cursor;
      if (cursorToken && typeof cursorToken === 'string') {
        try {
          cursor = JSON.parse(Buffer.from(cursorToken, 'base64').toString('utf8'));
        } catch (error) {
          reply.code(400).send({ error: 'cursor token is invalid' });
          return;
        }
      }
      const result = await listAppointments({ slug, status, limit, cursor });
      const nextCursor = result.nextCursor
        ? Buffer.from(JSON.stringify(result.nextCursor)).toString('base64')
        : null;
      reply.send({ slug, items: result.items, nextCursor });
    }
  );

  app.post(
    '/appointments/status',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      const body = request.body as any;
      const slug = await ensureSlugAccess(request, reply, db, body.slug);
      if (!slug) return;
      const result = await updateAppointmentStatus({
        slug,
        appointmentId: body.appointmentId,
        status: body.status,
        confirmedStart: body.confirmedStart,
        confirmedEnd: body.confirmedEnd,
        metadata: body.metadata,
      });
      if (body.status && typeof body.status === 'string' && body.status.toLowerCase() === 'confirmed') {
        try {
          await syncAppointmentWithProvider({
            slug,
            appointmentId: body.appointmentId,
          });
        } catch (error) {
          request.log.warn(
            { err: error, slug: body.slug, appointmentId: body.appointmentId },
            '[appointments] failed to sync provider'
          );
        }
      }
      reply.send(result);
    }
  );

  app.get(
    '/appointments/settings',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      const query = request.query as Record<string, any>;
      const slug = await resolveSlugOrDefault(request, reply, db, query.slug);
      if (!slug) return;
      const settings = await getAppointmentSettings({ slug });
      reply.send(settings);
    }
  );

  app.post(
    '/appointments/settings',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      const body = request.body as any;
      const slug = await ensureSlugAccess(request, reply, db, body.slug);
      if (!slug) return;
      const previous = await getAppointmentSettings({ slug });
      const settings = await saveAppointmentSettings({
        slug,
        availability: body.availability,
        timezone: body.timezone,
        calendarProvider: body.calendarProvider,
      });
      if (
        body.calendarProvider !== undefined &&
        previous?.calendarProvider &&
        (!body.calendarProvider || body.calendarProvider !== previous.calendarProvider)
      ) {
        try {
          await deleteIntegrationToken({
            slug,
            provider: previous.calendarProvider,
          });
        } catch (error) {
          request.log.warn({ err: error, slug }, '[appointments] failed to remove integration token');
        }
      }
      reply.send(settings);
    }
  );

  app.get('/appointments/ics', async (request, reply) => {
    const { slug, token } = request.query as { slug?: string; token?: string };
    if (!slug || !token) {
      reply.code(400).send({ error: 'slug and token are required' });
      return;
    }
    const settings = await getAppointmentSettings({ slug });
    if (!settings?.calendarIcsToken || settings.calendarIcsToken !== token) {
      reply.code(403).send({ error: 'Invalid calendar token' });
      return;
    }
    const result = await listAppointments({ slug, limit: 200 });
    const calendarBody = buildICS({
      slug,
      appointments: result.items || [],
      siteName: slug,
    });
    reply
      .header('Content-Type', 'text/calendar; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(calendarBody);
  });

  app.post(
    '/appointments/calendar/connect',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      const body = request.body as any;
      const provider = String(body.provider || '').toLowerCase();
      const slug = await resolveSlugOrDefault(request, reply, db, body.slug);
      if (!slug) return;
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
        await saveAppointmentSettings({ slug, calendarProvider: 'apple-ics' });
        reply.send({
          provider: 'apple',
          icsUrl,
          instructions: 'Subscribe to this ICS feed in Apple Calendar to mirror appointments.',
        });
        return;
      }
      if (!['google', 'outlook'].includes(provider)) {
        reply.code(400).send({ error: 'Unsupported provider' });
        return;
      }
      const nonce = randomUUID();
      const statePayload = Buffer.from(JSON.stringify({ slug, nonce }), 'utf8').toString('base64url');
      await setOAuthState({
        slug,
        provider,
        state: nonce,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });
      const url = calendar.buildConnectUrl({ provider, slug, state: statePayload });
      reply.send({ provider, url });
    }
  );

  app.get(
    '/leads',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      const query = request.query as Record<string, any>;
      const slug = await resolveSlugOrDefault(request, reply, db, query.slug);
      if (!slug) return;
      const limit = query.limit ? Number(query.limit) : undefined;
      const status = query.status;
      const cursorToken = query.cursor;
      let cursor;
      if (cursorToken && typeof cursorToken === 'string') {
        try {
          cursor = JSON.parse(Buffer.from(cursorToken, 'base64').toString('utf8'));
        } catch (error) {
          reply.code(400).send({ error: 'cursor token is invalid' });
          return;
        }
      }
      const result = await listLeads({ slug, limit, status, cursor });
      const nextCursor = result.nextToken
        ? Buffer.from(JSON.stringify(result.nextToken)).toString('base64')
        : null;
      reply.send({ slug, items: result.items, nextCursor });
    }
  );

  app.post(
    '/leads/reply',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      const body = request.body as any;
      const slug = await ensureSlugAccess(request, reply, db, body.slug);
      if (!slug) return;
      const result = await sendLeadReply({
        slug,
        leadId: body.leadId,
        message: body.message,
        subject: body.subject,
        sender: { targetEmail: body.targetEmailHint },
      });
      reply.send(result);
    }
  );

  app.post(
    '/leads/status',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      const body = request.body as any;
      const slug = await ensureSlugAccess(request, reply, db, body.slug);
      if (!slug) return;
      const result = await markLeadStatus({
        slug,
        leadId: body.leadId,
        status: body.status,
        followUpAt: body.followUpAt,
      });
      reply.send(result);
    }
  );

  app.get('/reviews', async (request, reply) => {
    const { slug, limit } = request.query as { slug?: string; limit?: string };
    if (!slug) {
      reply.code(400).send({ error: 'slug is required' });
      return;
    }
    const items = await listApprovedReviews({ slug, limit: limit ? Number(limit) : undefined });
    reply.send({ slug, items });
  });

  app.post('/reviews', async (request, reply) => {
    const body = request.body as any;
    const record = await submitReview({
      slug: body.slug,
      authorName: body.authorName,
      rating: body.rating,
      body: body.body,
      contactEmail: body.contactEmail,
      source: body.source,
    });
    reply.send({ review: record });
  });

  app.post(
    '/reviews/status',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      const body = request.body as any;
      const slug = await ensureSlugAccess(request, reply, db, body.slug);
      if (!slug) return;
      const result = await setReviewStatus({
        slug,
        reviewId: body.reviewId,
        status: body.status,
      });
      reply.send(result);
    }
  );

  app.get(
    '/notifications/preferences',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      const { slug, recipient } = request.query as { slug?: string; recipient?: string };
      if (!recipient) {
        reply.code(400).send({ error: 'slug and recipient are required' });
        return;
      }
      const resolvedSlug = await resolveSlugOrDefault(request, reply, db, slug);
      if (!resolvedSlug) return;
      const prefs = await getPreferences({ slug: resolvedSlug, recipient });
      reply.send(prefs);
    }
  );

  app.post('/notifications/preferences', async (request, reply) => {
    const body = request.body as any;
    if (!body.slug || !body.recipient) {
      reply.code(400).send({ error: 'slug and recipient are required' });
      return;
    }
    const prefs = await savePreferences({
      slug: body.slug,
      recipient: body.recipient,
      preferences: body.preferences,
      unsubscribeAll: body.unsubscribeAll,
    });
    reply.send(prefs);
  });

  app.post('/analytics/events', async (request, reply) => {
    const body = request.body as any;
    if (!body.slug || !body.type) {
      reply.code(400).send({ error: 'slug and type are required' });
      return;
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
    reply.send({ ok: true });
  });

  app.get(
    '/analytics',
    { preHandler: app.authenticateUser },
    async (request, reply) => {
      const { slug, days } = request.query as { slug?: string; days?: string };
      const resolvedSlug = await resolveSlugOrDefault(request, reply, db, slug);
      if (!resolvedSlug) return;
      const records = await listAnalytics({ slug: resolvedSlug, days: days ? Number(days) : undefined });
      const alerts = buildAlerts(records);
      reply.send({ slug: resolvedSlug, records, alerts });
    }
  );

  app.get('/oauth/calendar/google/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string };
    if (!query.code || !query.state) {
      respondWithHtml(reply, 400, 'Missing authorization parameters.');
      return;
    }
    try {
      const payload = decodeOauthState(query.state);
      const slug = payload.slug;
      const settings = await getAppointmentSettings({ slug });
      if (!settings?.oauthState || settings.oauthState !== payload.nonce) {
        respondWithHtml(reply, 400, 'State mismatch. Please restart the connection flow.');
        return;
      }
      if (settings.oauthStateExpiresAt) {
        const expiresAt = new Date(settings.oauthStateExpiresAt).getTime();
        if (Date.now() > expiresAt) {
          await clearOAuthState({ slug });
          respondWithHtml(reply, 400, 'Authorization state expired. Please try again.');
          return;
        }
      }
      if (settings.oauthStateProvider && settings.oauthStateProvider !== 'google') {
        respondWithHtml(reply, 400, 'Mismatched provider state.');
        return;
      }
      const tokens = await calendar.exchangeCodeForTokens({ provider: 'google', code: query.code });
      const expiresAtIso = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : settings.calendarExpiresAt || null;
      await saveIntegrationToken({
        slug,
        provider: 'google',
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
        calendarProvider: 'google',
        calendarAccountEmail: tokens.accountEmail || settings.calendarAccountEmail || null,
      });
      await clearOAuthState({ slug });
      respondWithHtml(reply, 200, 'Calendar connected!');
    } catch (error) {
      request.log.error({ err: error }, '[calendar callback] failed');
      respondWithHtml(reply, 500, 'Calendar connection failed.');
    }
  });

  app.get('/oauth/calendar/outlook/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string };
    if (!query.code || !query.state) {
      respondWithHtml(reply, 400, 'Missing authorization parameters.');
      return;
    }
    try {
      const payload = decodeOauthState(query.state);
      const slug = payload.slug;
      const settings = await getAppointmentSettings({ slug });
      if (!settings?.oauthState || settings.oauthState !== payload.nonce) {
        respondWithHtml(reply, 400, 'State mismatch. Please restart the connection flow.');
        return;
      }
      if (settings.oauthStateExpiresAt) {
        const expiresAt = new Date(settings.oauthStateExpiresAt).getTime();
        if (Date.now() > expiresAt) {
          await clearOAuthState({ slug });
          respondWithHtml(reply, 400, 'Authorization state expired. Please try again.');
          return;
        }
      }
      if (settings.oauthStateProvider && settings.oauthStateProvider !== 'outlook') {
        respondWithHtml(reply, 400, 'Mismatched provider state.');
        return;
      }
      const tokens = await calendar.exchangeCodeForTokens({ provider: 'outlook', code: query.code });
      const expiresAtIso = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : settings.calendarExpiresAt || null;
      await saveIntegrationToken({
        slug,
        provider: 'outlook',
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
        calendarProvider: 'outlook',
        calendarAccountEmail: tokens.accountEmail || settings.calendarAccountEmail || null,
      });
      await clearOAuthState({ slug });
      respondWithHtml(reply, 200, 'Calendar connected!');
    } catch (error) {
      request.log.error({ err: error }, '[calendar callback] failed');
      respondWithHtml(reply, 500, 'Calendar connection failed.');
    }
  });
};
