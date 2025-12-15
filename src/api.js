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
    await submitContactMessage({
      slug: body.slug,
      sectionId: body.sectionId,
      contactEmailHint: body.contactEmail,
      fields: body.fields,
      sourceUrl: body.sourceUrl,
      remoteAddress,
      userAgent: event?.headers?.['user-agent'] || event?.headers?.['User-Agent'],
      intent: body.intent,
    });
    return json(200, { ok: true });
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
  'POST /analytics/events': async (event) => {
    const body = parseJsonBody(event);
    if (!body.slug || !body.type) {
      return json(400, { error: 'slug and type are required' });
    }
    await recordAnalyticsEvent({
      slug: body.slug,
      type: body.type,
      metadata: body.metadata || { path: body.path, referrer: body.referrer },
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
