const { parseJsonBody, json } = require('./http');
const { runLaunch } = require('./launch');
const { runUpdate, approveUpdate, listUpdates } = require('./update');
const { getUserContext, requireRole } = require('./auth');

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
  const routeKey = buildRouteKey(event);
  if (!routeKey || !ROUTES[routeKey]) {
    return json(404, { error: 'Not found' });
  }
  const user = getUserContext(event);
  try {
    return await ROUTES[routeKey](event, user);
  } catch (error) {
    const statusCode = error.statusCode || error.status || 500;
    return json(statusCode, { error: error.message || 'Request failed' });
  }
};

module.exports = { handleHttpEvent, isApiGatewayEvent };
