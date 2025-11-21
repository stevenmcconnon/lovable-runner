const { runLaunch } = require('./src/launch');
const { parseJsonBody, json } = require('./src/http');
const { handleHttpEvent, isApiGatewayEvent } = require('./src/api');

const handleLegacyLaunch = async (event = {}) => {
  const body = parseJsonBody(event);
  const result = await runLaunch({
    url: body.url,
    token: body.token,
    base: body.base,
    createPath: body.createPath,
    workspace: body.workspace,
    waitSeconds: body.wait,
    attempts: body.attempts,
    bucket: body.bucket || process.env.LOVABLE_DEPLOY_BUCKET,
    prefix: body.prefix || process.env.LOVABLE_DEPLOY_PREFIX,
    slug: body.slug,
    profile: body.profile,
    skipInstall: body.skipInstall,
    placeholderLimit: body.placeholderLimit || process.env.LOVABLE_PLACEHOLDER_LIMIT,
  });
  return json(200, result);
};

exports.handler = async (event) => {
  try {
    if (isApiGatewayEvent(event)) {
      return await handleHttpEvent(event);
    }
    return await handleLegacyLaunch(event);
  } catch (error) {
    return json(error.statusCode || 400, { error: error.message || 'Launch failed' });
  }
};
