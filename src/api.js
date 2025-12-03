const { parseJsonBody, json } = require('./http');
const { runLaunch } = require('./launch');
const { runUpdate, approveUpdate, listUpdates } = require('./update');
const { getUserContext, requireRole } = require('./auth');
const { listSitesForUser } = require('./site-store');
const { listDomainsForUser, getDomainRecord, setPrimaryDomain } = require('./domain-store');

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
